// PRD 027 Req 5: the remote MCP endpoint — `POST /api/mcp`, streamable HTTP
// in its STATELESS form: one JSON-RPC 2.0 message per request, a JSON body
// back (never a required SSE stream, never a session id). `claude mcp add
// --transport http <origin>/api/mcp --header "Authorization: Bearer <token>"`
// connects with no local server install.
//
// Built as a small in-repo JSON-RPC handler rather than on the SDK: the
// endpoint needs five methods over plain `node:http`, and a dependency that
// must be plain-ESM importable under `node server/index.ts` buys nothing the
// ~150 lines below do not.
//
// PRD 027 Req 4: ONE auth path. Every request — `initialize` included —
// presents an agent token and is resolved by `resolveAgentToken`; the
// workspace is the token's, never a parameter, and every blob path a tool
// touches passes `checkAgentTokenScope` before storage is reached. This
// module adds no token lookup, no hash and no scope rule of its own, and it
// never logs — nothing in it writes to stdout or stderr, so a header or a
// token cannot reach a log line.
//
// PRD 027 Req 6: the five FILE tools, over the same functions the
// `/api/workspaces/<id>/files*` and `upload` routes call
// (server/workspaceFiles.ts) — never a second storage path.
//
// PRD 027 Req 7 (issue #367): the nine SESSION tools, each dispatched through
// the one app-wide session broker (server/agentBridge.ts) to the tab
// registered for the token's workspace — so a control tool can only ever
// reach that workspace's controlled tab (Req 4), and with no tab opted in
// every session tool answers `no_controlled_session` as data (never a 500)
// while the file tools are unaffected.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Buffer } from 'node:buffer';
// The version the server reports in `initialize` — the package's own, so a
// release bump never leaves serverInfo stale.
import pkg from '../package.json' with { type: 'json' };
import { randomUUID } from 'node:crypto';
import {
  BRIDGE_TOOL_NAMES,
  decodeToolRequest,
  SMART_FORMAT_OPS,
  type BridgeErrorCode,
  type BridgeToolName,
  type EditorStateSnapshot,
} from '../src/lib/agentBridgeProtocol.ts';
import type { SessionBroker } from './agentBridge.ts';
import {
  AGENT_TOKEN_SCOPE_ERROR,
  AGENT_TOKEN_UNAUTHORIZED_ERROR,
  checkAgentTokenScope,
  resolveAgentToken,
  type ResolvedAgentToken,
} from './agentTokens.ts';
import { cleanRelativePath, readBody, sendJson } from './http.ts';
import type { StorageProvider } from './providers/types.ts';
import { loadManifest, manifestBlob } from './workspaces.ts';
import {
  blobExists,
  filesPrefix,
  listWorkspaceFiles,
  readWorkspaceFile,
  saveWorkspaceFile,
  uploadWorkspaceFile,
} from './workspaceFiles.ts';

export const MCP_PATH = '/api/mcp';

/** The protocol revisions this server speaks, newest first. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
const SERVER_INFO = { name: 'marky-mark', version: pkg.version } as const;

// JSON-RPC 2.0 error codes the endpoint answers with.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

/**
 * PRD 027 Req 6: a tool error — a `tools/call` RESULT with `isError: true`
 * whose text is JSON `{error: {code, message, path?, …}}`. Never a JSON-RPC
 * protocol error, never a 500: the agent reads the stable `code` and acts.
 */
export type ToolErrorCode =
  | 'not_found'
  | 'already_exists'
  | 'conflict'
  | 'invalid_path'
  | 'invalid_params'
  | 'unsupported_type'
  | 'too_large'
  | 'corrupt_manifest'
  | typeof AGENT_TOKEN_SCOPE_ERROR.code
  // PRD 027 Req 7 (issue #367): a session tool's failure carries the bridge
  // error's own code — `no_controlled_session`, `stale_revision` (with the
  // fresh `state`), `timeout`, `tool_failed`.
  | BridgeErrorCode;

interface ToolError {
  error: {
    code: ToolErrorCode;
    message: string;
    path?: string;
    etag?: string;
    content?: string;
    /** PRD 027 Req 8: a `stale_revision` refusal carries the fresh snapshot. */
    state?: EditorStateSnapshot;
  };
}

type ToolFailure = { ok: false; error: ToolError['error'] };
type ToolOutcome = { ok: true; result: unknown } | ToolFailure;

const toolError = (
  code: ToolErrorCode,
  message: string,
  extra: Omit<ToolError['error'], 'code' | 'message'> = {},
): ToolFailure => ({ ok: false, error: { code, message, ...extra } });

/**
 * The JSON-Schema subset the tool schemas use. The file tools are flat
 * string objects; the session tools (issue #367) add numbers, enums and the
 * `scroll` target's `oneOf` of closed objects.
 */
export interface JsonSchema {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  enum?: readonly string[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: false;
  oneOf?: readonly JsonSchema[];
  minimum?: number;
}

/** A JSON-Schema object with no workspace property — the token carries it. */
interface ToolSchema {
  type: 'object';
  properties: Record<string, JsonSchema>;
  required: string[];
  additionalProperties: false;
}

interface ToolSpec {
  name: string;
  description: string;
  inputSchema: ToolSchema;
}

const PATH_PROP = { type: 'string', description: 'File path relative to the files root, e.g. notes/todo.md.' } as const;

// PRD 027 Req 7+8 (issue #367): the session tools' shared schema pieces —
// each mirrors the corresponding `BridgeToolRequest` member (minus `id`) in
// src/lib/agentBridgeProtocol.ts, whose decoder is what validates a call.
const REVISION_PROP = {
  type: 'string',
  description: 'The buffer revision from the last get_editor_state; the call fails with stale_revision if the buffer changed since.',
} as const;
const OFFSET = (description: string): JsonSchema => ({ type: 'integer', minimum: 0, description });
const SCROLL_TARGET: JsonSchema = {
  type: 'object',
  description: 'Where to scroll: by lines or pages (negative amounts scroll up), or to a line or a heading.',
  oneOf: [
    {
      type: 'object',
      properties: {
        by: { type: 'string', enum: ['lines', 'pages'] },
        amount: { type: 'number', description: 'How many lines or pages; negative scrolls up.' },
      },
      required: ['by', 'amount'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { to: { type: 'string', enum: ['line'] }, line: { type: 'number', description: '1-based line.' } },
      required: ['to', 'line'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { to: { type: 'string', enum: ['heading'] }, heading: { type: 'string', description: 'Heading text.' } },
      required: ['to', 'heading'],
      additionalProperties: false,
    },
  ],
};
const STATE_NOTE = ' Answers the editor state after the call (path, content, dirty, cursor, selection, scroll, revision).';
const SESSION_NOTE = ' Needs a tab that opted in to agent control; otherwise fails with no_controlled_session.';

/**
 * PRD 027 Req 7 (issue #367): the nine session tools, in `BRIDGE_TOOL_NAMES`
 * order. A closed object each; the four mutating tools require `revision`
 * (Req 8); no tool names a workspace (Req 5).
 */
const SESSION_TOOLS: readonly (ToolSpec & { name: BridgeToolName })[] = [
  {
    name: 'get_editor_state',
    description: 'The controlled tab\'s editor state: open file path, full buffer (unsaved edits included), dirty flag, cursor, selection, scroll and the buffer revision.' + SESSION_NOTE,
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'open_file',
    description: 'Open a workspace file in the controlled tab.' + STATE_NOTE + SESSION_NOTE,
    inputSchema: { type: 'object', properties: { path: PATH_PROP }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'scroll',
    description: 'Scroll the controlled tab by lines or pages, or to a line or heading.' + STATE_NOTE + SESSION_NOTE,
    inputSchema: { type: 'object', properties: { target: SCROLL_TARGET }, required: ['target'], additionalProperties: false },
  },
  {
    name: 'set_selection',
    description: 'Select a range of the buffer (offsets from get_editor_state) without stealing focus.' + STATE_NOTE + SESSION_NOTE,
    inputSchema: {
      type: 'object',
      properties: { from: OFFSET('Start offset (0-based).'), to: OFFSET('End offset (0-based, exclusive).') },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'replace_selection',
    description: 'Replace the current selection with text, as one undo step.' + STATE_NOTE + SESSION_NOTE,
    inputSchema: {
      type: 'object',
      properties: { revision: REVISION_PROP, text: { type: 'string', description: 'The replacement text.' } },
      required: ['revision', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'insert_text',
    description: 'Insert text at the cursor, as one undo step.' + STATE_NOTE + SESSION_NOTE,
    inputSchema: {
      type: 'object',
      properties: { revision: REVISION_PROP, text: { type: 'string', description: 'The text to insert.' } },
      required: ['revision', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'replace_range',
    description: 'Replace an explicit offset range with text, as one undo step.' + STATE_NOTE + SESSION_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        revision: REVISION_PROP,
        from: OFFSET('Start offset (0-based).'),
        to: OFFSET('End offset (0-based, exclusive).'),
        text: { type: 'string', description: 'The replacement text.' },
      },
      required: ['revision', 'from', 'to', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'apply_format',
    description: 'Apply one of the editor\'s formatting operations to the current selection, as one undo step.' + STATE_NOTE + SESSION_NOTE,
    inputSchema: {
      type: 'object',
      properties: { revision: REVISION_PROP, op: { type: 'string', enum: SMART_FORMAT_OPS, description: 'The formatting operation.' } },
      required: ['revision', 'op'],
      additionalProperties: false,
    },
  },
  {
    name: 'save',
    description: 'Save the controlled tab\'s buffer through the app\'s own save path.' + STATE_NOTE + SESSION_NOTE,
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
];

/**
 * PRD 027 Req 6: exactly the five file tools, followed (PRD 027 Req 7, issue
 * #367) by the nine session tools — fourteen in all. Every schema is a
 * closed object with an explicit `required` list, and none has a workspace
 * property (Req 5: the token identifies the workspace).
 */
export const MCP_TOOLS: readonly ToolSpec[] = [
  {
    name: 'get_workspace',
    description: "The token's workspace: id, name, created and modified timestamps.",
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'list_files',
    description: 'List every file in the workspace: path, size, lastModified and etag per row.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'read_file',
    description: 'Read one file as UTF-8 text with its etag (needed by write_file).',
    inputSchema: { type: 'object', properties: { path: PATH_PROP }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'create_file',
    description:
      'Create a file that does not exist yet (fails if the path is taken). Give exactly one of ' +
      '`content` (UTF-8 text) or `contentBase64` (binary, e.g. an image; the upload allowlist and size cap apply).',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        content: { type: 'string', description: 'UTF-8 text content.' },
        contentBase64: { type: 'string', description: 'Base64-encoded binary content.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description:
      'Replace the content of an EXISTING file. `etag` is the etag from read_file/create_file; a stale etag ' +
      'merges three-way when `base` (the text you read) is given, otherwise fails with `conflict`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        content: { type: 'string', description: 'The full new UTF-8 text.' },
        etag: { type: 'string', description: 'The etag returned when the file was read or created.' },
        base: { type: 'string', description: 'Optional: the text the edit started from, enabling a merge on a stale etag.' },
      },
      required: ['path', 'content', 'etag'],
      additionalProperties: false,
    },
  },
  ...SESSION_TOOLS,
];

/** The token's workspace plus the storage seam every tool runs against. */
interface ToolContext {
  storage: StorageProvider;
  resolved: ResolvedAgentToken;
  /** PRD 027 Req 7 (issue #367): the one broker the session tools dispatch through. */
  broker: SessionBroker;
}

const isSessionTool = (name: string): name is BridgeToolName => (BRIDGE_TOOL_NAMES as readonly string[]).includes(name);

/**
 * Validate `arguments` against a tool's closed schema: an object, only the
 * declared string properties, every required one present. Answers the
 * offending detail so the agent can fix its call.
 */
function checkArguments(spec: ToolSpec, args: unknown): Record<string, string> | string {
  if (args === undefined) return spec.inputSchema.required.length === 0 ? {} : 'arguments are required';
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return 'arguments must be an object';
  const record = args as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(key in spec.inputSchema.properties)) return `unknown argument "${key}"`;
    if (typeof record[key] !== 'string') return `argument "${key}" must be a string`;
  }
  for (const key of spec.inputSchema.required) {
    if (!(key in record)) return `argument "${key}" is required`;
  }
  return record as Record<string, string>;
}

/**
 * PRD 027 Req 4: resolve a tool's file path to the blob it names — the scope
 * check runs on the RAW joined path first (so `..` is refused as out of
 * scope, exactly like a path under another workspace), then the route
 * layer's own path rule. Answers the clean relative path or a tool error.
 */
function scopedFilePath(ctx: ToolContext, rawPath: string): { ok: true; path: string } | ToolFailure {
  const { workspaceId } = ctx.resolved;
  const scope = checkAgentTokenScope(ctx.resolved, workspaceId, filesPrefix(workspaceId) + rawPath);
  if (!scope.ok) return toolError(scope.error.code, scope.error.message, { path: rawPath });
  const filePath = cleanRelativePath(rawPath);
  if (!filePath) return toolError('invalid_path', 'invalid file path', { path: rawPath });
  return { ok: true, path: filePath };
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Strict base64: canonical alphabet and padding, or null. */
function decodeBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0 || !BASE64_RE.test(text)) return null;
  return new Uint8Array(Buffer.from(text, 'base64'));
}

/**
 * PRD 027 Req 7 (issue #367): one session tool — a closed check of the
 * argument keys against the schema, the protocol module's own decoder for
 * the values (with a server-minted id the broker replaces), then ONE
 * dispatch to the token's workspace. Every failure is data: the bridge
 * error's code and message, plus the fresh `state` on `stale_revision`.
 */
async function callSessionTool(ctx: ToolContext, spec: ToolSpec, name: BridgeToolName, rawArgs: unknown): Promise<ToolOutcome> {
  const args = rawArgs === undefined ? {} : rawArgs;
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return toolError('invalid_params', 'arguments must be an object');
  const record = args as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(key in spec.inputSchema.properties)) return toolError('invalid_params', `unknown argument "${key}"`);
  }
  for (const key of spec.inputSchema.required) {
    if (!(key in record)) return toolError('invalid_params', `argument "${key}" is required`);
  }
  const decoded = decodeToolRequest({ ...record, id: randomUUID(), tool: name });
  if (typeof decoded === 'string') return toolError('invalid_params', decoded);
  const { id: _minted, ...call } = decoded;
  // PRD 027 Req 4: the token's workspace, never a parameter — the broker
  // holds at most that workspace's one controlled tab.
  const result = await ctx.broker.dispatch(ctx.resolved.workspaceId, call);
  if (result.ok) {
    const { ok: _ok, id: _id, state, ...extra } = result;
    return { ok: true, result: { state, ...extra } };
  }
  const { error } = result;
  return error.code === 'stale_revision'
    ? toolError(error.code, error.message, { state: error.state })
    : toolError(error.code, error.message);
}

async function callTool(ctx: ToolContext, name: string, rawArgs: unknown): Promise<ToolOutcome | null> {
  const spec = MCP_TOOLS.find((t) => t.name === name);
  if (!spec) return null;
  if (isSessionTool(name)) return callSessionTool(ctx, spec, name, rawArgs);
  const args = checkArguments(spec, rawArgs);
  if (typeof args === 'string') return toolError('invalid_params', args);
  const { storage, resolved } = ctx;
  const id = resolved.workspaceId;

  if (name === 'get_workspace') {
    // PRD 027 Req 6: name and basic metadata, from the manifest the routes read.
    const scope = checkAgentTokenScope(resolved, id, manifestBlob(id));
    if (!scope.ok) return toolError(scope.error.code, scope.error.message);
    const manifest = await loadManifest(storage, id);
    if (manifest === null) return toolError('not_found', 'no such workspace');
    if (typeof manifest === 'string') return toolError('corrupt_manifest', `corrupt workspace manifest: ${manifest}`);
    return { ok: true, result: { id, name: manifest.name, created: manifest.created, modified: manifest.modified } };
  }

  if (name === 'list_files') {
    const scope = checkAgentTokenScope(resolved, id, filesPrefix(id));
    if (!scope.ok) return toolError(scope.error.code, scope.error.message);
    return { ok: true, result: { files: await listWorkspaceFiles(storage, id) } };
  }

  const scoped = scopedFilePath(ctx, args.path);
  if (!scoped.ok) return scoped;
  const filePath = scoped.path;

  if (name === 'read_file') {
    const file = await readWorkspaceFile(storage, id, filePath);
    return file ? { ok: true, result: file } : toolError('not_found', 'not found', { path: filePath });
  }

  if (name === 'create_file') {
    const hasText = 'content' in args;
    const hasBinary = 'contentBase64' in args;
    if (hasText === hasBinary) {
      return toolError('invalid_params', 'give exactly one of "content" or "contentBase64"', { path: filePath });
    }
    if (hasBinary) {
      // PRD 027 Req 6: binary lands exactly as the upload route stores it —
      // allowlist, size cap, 409-on-existing, media type from the extension.
      const bytes = decodeBase64(args.contentBase64);
      if (!bytes) return toolError('invalid_params', '"contentBase64" is not valid base64', { path: filePath });
      const outcome = await uploadWorkspaceFile(storage, id, filePath, bytes);
      if (!outcome.ok) return toolError(outcome.reason, outcome.error, { path: filePath });
      return { ok: true, result: { path: filePath, etag: outcome.etag, size: outcome.size } };
    }
    // PRD 027 Req 6: create_file fails on an existing path and stores nothing.
    if (await blobExists(storage, filesPrefix(id) + filePath)) {
      return toolError('already_exists', 'a file already exists there', { path: filePath });
    }
    const saved = await saveWorkspaceFile(storage, id, filePath, args.content);
    if (!saved.ok) return toolError('conflict', saved.error, { path: filePath });
    return { ok: true, result: { path: filePath, etag: saved.etag, size: Buffer.byteLength(args.content) } };
  }

  // write_file — PRD 027 Req 6: an EXISTING file only, conditional on the
  // read etag, with the PRD 016 merge on a stale one (workspaceFiles.ts).
  if (!(await blobExists(storage, filesPrefix(id) + filePath))) {
    return toolError('not_found', 'not found — use create_file for a new file', { path: filePath });
  }
  const saved = await saveWorkspaceFile(storage, id, filePath, args.content, args.etag, args.base);
  if (!saved.ok) {
    // The current head rides along so the agent can re-read and retry
    // without a second round trip; the stored content is untouched.
    const head = await readWorkspaceFile(storage, id, filePath);
    return toolError('conflict', saved.error, { path: filePath, ...(head ? { etag: head.etag, content: head.content } : {}) });
  }
  return {
    ok: true,
    result: saved.merged
      ? { path: filePath, etag: saved.etag, merged: true, content: saved.content }
      : { path: filePath, etag: saved.etag },
  };
}

/** A `tools/call` result: the JSON as text, mirrored as structuredContent. */
function toolResult(outcome: ToolOutcome): unknown {
  const payload = outcome.ok ? outcome.result : { error: outcome.error };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(outcome.ok ? {} : { isError: true }),
  };
}

type RpcAnswer = { result: unknown } | { error: { code: number; message: string } };

/** Dispatch one JSON-RPC method. */
async function dispatch(ctx: ToolContext, request: JsonRpcRequest): Promise<RpcAnswer> {
  const params = (request.params ?? {}) as Record<string, unknown>;
  switch (request.method) {
    case 'initialize': {
      // The client's revision is echoed when the server speaks it; otherwise
      // the newest one the server supports, as the MCP spec directs.
      const asked = params.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.find((v) => v === asked) ?? PROTOCOL_VERSIONS[0];
      return { result: { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO } };
    }
    case 'ping':
      return { result: {} };
    case 'tools/list':
      return { result: { tools: MCP_TOOLS } };
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string') return { error: { code: INVALID_PARAMS, message: 'tools/call needs a string "name"' } };
      const outcome = await callTool(ctx, name, params.arguments);
      if (!outcome) return { error: { code: INVALID_PARAMS, message: `unknown tool "${name}"` } };
      return { result: toolResult(outcome) };
    }
    default:
      return { error: { code: METHOD_NOT_FOUND, message: `method not found: ${request.method}` } };
  }
}

function sendRpc(res: ServerResponse, status: number, id: JsonRpcId, answer: RpcAnswer): void {
  sendJson(res, status, { jsonrpc: '2.0', id, ...answer });
}

/**
 * PRD 027 Req 5: the endpoint. `createApp` calls this ONLY when the agent
 * bridge is on; with the flag off the route answers the ordinary 404 before
 * this module runs. Method first (GET/DELETE are 405 — there is no stream
 * and no session to end), then the token, then the one message.
 */
export async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  storage: StorageProvider,
  // PRD 027 Req 7 (issue #367): the app's one session broker — shared with
  // the WebSocket upgrade route, so a dispatch reaches the tab that route
  // registered for the token's workspace.
  broker: SessionBroker,
): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'method not allowed' }));
    return;
  }
  // PRD 027 Req 4: the one auth path — resolve, or refuse with the stable
  // error. Missing, malformed, unknown and revoked all read the same.
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  const resolved = token ? await resolveAgentToken(storage, token) : null;
  if (!resolved) {
    res.writeHead(401, { 'WWW-Authenticate': 'Bearer', 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: AGENT_TOKEN_UNAUTHORIZED_ERROR }));
    return;
  }
  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    sendRpc(res, 413, null, { error: { code: INVALID_REQUEST, message: 'request body too large' } });
    return;
  }
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    sendRpc(res, 400, null, { error: { code: PARSE_ERROR, message: 'parse error: body is not JSON' } });
    return;
  }
  // One message per request: the 2025-06-18 revision dropped batching, and
  // a stateless server has no stream to answer a batch on.
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    sendRpc(res, 400, null, { error: { code: INVALID_REQUEST, message: 'expected one JSON-RPC 2.0 message' } });
    return;
  }
  const request = message as Partial<JsonRpcRequest>;
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    sendRpc(res, 400, request.id ?? null, {
      error: { code: INVALID_REQUEST, message: 'expected {jsonrpc: "2.0", method, id?, params?}' },
    });
    return;
  }
  // A notification (no id) — `notifications/initialized` and friends — is
  // accepted with no body: there is nothing to answer.
  if (request.id === undefined || request.id === null) {
    res.writeHead(202);
    res.end();
    return;
  }
  const answer = await dispatch({ storage, resolved, broker }, request as JsonRpcRequest);
  sendRpc(res, 200, request.id, answer);
}
