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
// (server/workspaceFiles.ts) — never a second storage path. Session tools
// and the broker (server/agentBridge.ts) are NOT mounted here (issue #367).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Buffer } from 'node:buffer';
// The version the server reports in `initialize` — the package's own, so a
// release bump never leaves serverInfo stale.
import pkg from '../package.json' with { type: 'json' };
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
  | typeof AGENT_TOKEN_SCOPE_ERROR.code;

interface ToolError {
  error: { code: ToolErrorCode; message: string; path?: string; etag?: string; content?: string };
}

type ToolFailure = { ok: false; error: ToolError['error'] };
type ToolOutcome = { ok: true; result: unknown } | ToolFailure;

const toolError = (
  code: ToolErrorCode,
  message: string,
  extra: Omit<ToolError['error'], 'code' | 'message'> = {},
): ToolFailure => ({ ok: false, error: { code, message, ...extra } });

/** A JSON-Schema object with no workspace property — the token carries it. */
interface ToolSchema {
  type: 'object';
  properties: Record<string, { type: 'string'; description: string }>;
  required: string[];
  additionalProperties: false;
}

interface ToolSpec {
  name: string;
  description: string;
  inputSchema: ToolSchema;
}

const PATH_PROP = { type: 'string', description: 'File path relative to the files root, e.g. notes/todo.md.' } as const;

/**
 * PRD 027 Req 6: exactly the five file tools. Every schema is a closed
 * object with an explicit `required` list, and none has a workspace
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
];

/** The token's workspace plus the storage seam every tool runs against. */
interface ToolContext {
  storage: StorageProvider;
  resolved: ResolvedAgentToken;
}

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

async function callTool(ctx: ToolContext, name: string, rawArgs: unknown): Promise<ToolOutcome | null> {
  const spec = MCP_TOOLS.find((t) => t.name === name);
  if (!spec) return null;
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
export async function handleMcp(req: IncomingMessage, res: ServerResponse, storage: StorageProvider): Promise<void> {
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
  const answer = await dispatch({ storage, resolved }, request as JsonRpcRequest);
  sendRpc(res, 200, request.id, answer);
}
