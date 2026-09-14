// PRD 027 Req 14 (issue #363): the server↔controlled-tab message contract of
// the agent bridge — tool requests, results, state snapshots — in ONE shared,
// pure module. Both halves of the bridge import it: the hosted server
// (`server/agentBridge.ts`, under plain-node type-stripping, hence the
// explicit `.ts` extensions and the type-only editor import) and the client
// (issue #366). Nothing here performs I/O or knows a transport: WebSocket,
// HTTP and auth (issues #365/#367) each evolve without touching this file.

import type { SmartFormatOp } from '@marky-mark/editor';

/**
 * PRD 027 Req 14 (issue #363): every envelope carries this number; a decoder
 * refuses any other value so a tab and a server from different builds fail
 * loudly rather than half-understand each other.
 */
export const BRIDGE_PROTOCOL_VERSION = 1;

// PRD 027 Req 7 (issue #363): the tool inventory — exactly the nine session
// tools, as a readonly array (for iteration) and the union it derives.
export const BRIDGE_TOOL_NAMES = [
  'get_editor_state',
  'open_file',
  'scroll',
  'set_selection',
  'replace_selection',
  'insert_text',
  'replace_range',
  'apply_format',
  'save',
] as const;

export type BridgeToolName = (typeof BRIDGE_TOOL_NAMES)[number];

/**
 * PRD 027 Req 8 (issue #363): the tools that mutate the buffer. Each of their
 * requests carries the revision of the state the agent last read, so a user
 * keystroke in between makes the call fail with `stale_revision` instead of
 * silently clobbering the user's typing.
 */
export const MUTATING_TOOLS = ['replace_selection', 'insert_text', 'replace_range', 'apply_format'] as const;

export type MutatingToolName = (typeof MUTATING_TOOLS)[number];

/** PRD 027 Req 8 (issue #363): does this tool require a `revision`? */
export function isMutatingTool(tool: BridgeToolName): tool is MutatingToolName {
  return (MUTATING_TOOLS as readonly string[]).includes(tool);
}

// PRD 027 Req 7 (issue #363): the editor state snapshot `get_editor_state`
// returns and every result rides along. Coordinates are the editor package's
// CANONICAL ones — `EditStateReport.canonHead` / `headLine` / `selFrom` /
// `selTo` / `selText` and `EditorSyncHandle.topLine()`, the canonical-line
// coordinates the editor package documents on those handles — so the
// client (issue #366) fills the snapshot straight from the public handles.
export interface EditorStateSnapshot {
  /** Workspace-relative path of the open file, or `null` when none is open. */
  path: string | null;
  /** The full buffer, unsaved edits included. */
  content: string;
  dirty: boolean;
  cursor: {
    /** 0-based canonical text offset (`EditStateReport.canonHead`). */
    offset: number;
    /** 1-based canonical line (`EditStateReport.headLine`). */
    line: number;
  };
  selection: {
    /** Ordered canonical offsets (`EditStateReport.selFrom` / `selTo`). */
    from: number;
    to: number;
    /** The selected text (`EditStateReport.selText`). */
    text: string;
  };
  scroll: {
    /** 1-based canonical line at the top of the viewport (`EditorSyncHandle.topLine()`). */
    topLine: number;
    /** 1-based count of lines in the buffer. */
    totalLines: number;
  };
  /**
   * PRD 027 Req 8: the buffer revision. Opaque to the agent; a mutating
   * request must present the one it last read.
   */
  revision: string;
}

// PRD 027 Req 7 (issue #363): one request per session tool, discriminated on
// `tool`, each carrying a correlation `id` the result echoes back. The four
// mutating tools carry the required `revision` (Req 8) in their TYPE — a
// request without one cannot be constructed, and the decoder refuses one.
export type ScrollTarget =
  | { by: 'lines'; amount: number }
  | { by: 'pages'; amount: number }
  | { to: 'line'; line: number }
  | { to: 'heading'; heading: string };

export type BridgeToolRequest =
  | { id: string; tool: 'get_editor_state' }
  | { id: string; tool: 'open_file'; path: string }
  | { id: string; tool: 'scroll'; target: ScrollTarget }
  | { id: string; tool: 'set_selection'; from: number; to: number }
  | { id: string; tool: 'replace_selection'; revision: string; text: string }
  | { id: string; tool: 'insert_text'; revision: string; text: string }
  | { id: string; tool: 'replace_range'; revision: string; from: number; to: number; text: string }
  | { id: string; tool: 'apply_format'; revision: string; op: SmartFormatOp }
  | { id: string; tool: 'save' };

/** The request member for one tool name (what a client handler switches on). */
export type BridgeToolRequestFor<T extends BridgeToolName> = Extract<BridgeToolRequest, { tool: T }>;

// PRD 027 Req 7+8 (issue #363): errors, discriminated on `code`. The two the
// PRD names get the shapes it prescribes: `no_controlled_session` carries the
// fixed sentence, `stale_revision` carries the fresh state so the agent
// re-reads and retries without a second round trip.
export const NO_CONTROLLED_SESSION_MESSAGE = 'no controlled session';

export type BridgeError =
  | { code: 'no_controlled_session'; message: typeof NO_CONTROLLED_SESSION_MESSAGE }
  | { code: 'stale_revision'; message: string; state: EditorStateSnapshot }
  | { code: 'timeout'; message: string }
  | { code: 'invalid_request'; message: string }
  | { code: 'tool_failed'; message: string };

export type BridgeErrorCode = BridgeError['code'];

/** PRD 027 Req 7 (issue #363): the one `no_controlled_session` error value. */
export function noControlledSessionError(): Extract<BridgeError, { code: 'no_controlled_session' }> {
  return { code: 'no_controlled_session', message: NO_CONTROLLED_SESSION_MESSAGE };
}

// PRD 027 Req 7+8 (issue #363): a result echoes the request `id`. A success
// carries the post-call snapshot — so a mutating call hands back the new
// revision — plus any tool-specific fields; a failure carries one error.
export type BridgeToolResult =
  | { ok: true; id: string; state: EditorStateSnapshot; [extra: string]: unknown }
  | { ok: false; id: string; error: BridgeError };

// PRD 027 Req 14 (issue #363): the wire envelopes. Server → tab carries a
// tool request or the takeover notice (Req 10); tab → server carries a result
// or an unsolicited state push. Every envelope carries the protocol version.
export type ServerToTabMessage =
  | { v: typeof BRIDGE_PROTOCOL_VERSION; kind: 'tool_request'; request: BridgeToolRequest }
  /** PRD 027 Req 10: another tab took control; this one's toggle turns off. */
  | { v: typeof BRIDGE_PROTOCOL_VERSION; kind: 'session_replaced' };

export type TabToServerMessage =
  | { v: typeof BRIDGE_PROTOCOL_VERSION; kind: 'tool_result'; result: BridgeToolResult }
  | { v: typeof BRIDGE_PROTOCOL_VERSION; kind: 'state'; state: EditorStateSnapshot };

export type BridgeMessage = ServerToTabMessage | TabToServerMessage;

/** Why a wire text was refused; `decodeBridgeMessage` returns this instead of throwing. */
export interface BridgeDecodeFailure {
  ok: false;
  reason: string;
}

export type BridgeDecodeResult = { ok: true; message: BridgeMessage } | BridgeDecodeFailure;

/** PRD 027 Req 14 (issue #363): an envelope as the wire text (JSON). */
export function encodeBridgeMessage(message: BridgeMessage): string {
  return JSON.stringify(message);
}

/**
 * PRD 027 Req 14 (issue #363): the wire text back into a typed envelope,
 * validated rather than trusted (the `sanitizeAuxRequest` precedent). It
 * never throws: non-JSON text, a wrong `v`, a missing or unknown `kind`, an
 * unknown `tool`, a mutating request without a string `revision`, or a wrong
 * field type all come back as `{ ok: false, reason }`.
 */
export function decodeBridgeMessage(text: string): BridgeDecodeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse('not JSON');
  }
  if (!isRecord(raw)) return refuse('not an object');
  if (raw.v !== BRIDGE_PROTOCOL_VERSION) return refuse(`unsupported protocol version ${String(raw.v)}`);
  const v = BRIDGE_PROTOCOL_VERSION;
  switch (raw.kind) {
    case 'tool_request': {
      const request = decodeToolRequest(raw.request);
      return typeof request === 'string' ? refuse(request) : { ok: true, message: { v, kind: 'tool_request', request } };
    }
    case 'session_replaced':
      return { ok: true, message: { v, kind: 'session_replaced' } };
    case 'tool_result': {
      const result = decodeToolResult(raw.result);
      return typeof result === 'string' ? refuse(result) : { ok: true, message: { v, kind: 'tool_result', result } };
    }
    case 'state': {
      const state = decodeSnapshot(raw.state);
      return state === null ? refuse('malformed state') : { ok: true, message: { v, kind: 'state', state } };
    }
    case undefined:
      return refuse('missing kind');
    default:
      return refuse(`unknown kind ${String(raw.kind)}`);
  }
}

/**
 * PRD 027 Req 7 (issue #363): one request off the wire, or the reason it was
 * refused. Exported for the server's MCP layer (issue #365), which builds
 * requests from tool-call arguments it does not trust either.
 */
export function decodeToolRequest(raw: unknown): BridgeToolRequest | string {
  if (!isRecord(raw)) return 'request is not an object';
  const { id, tool } = raw;
  if (typeof id !== 'string' || !id) return 'request id is not a string';
  if (!isToolName(tool)) return `unknown tool ${String(tool)}`;
  return REQUEST_DECODERS[tool](id, raw);
}

type RequestDecoder<T extends BridgeToolName> = (id: string, raw: Record<string, unknown>) => BridgeToolRequestFor<T> | string;

/**
 * PRD 027 Req 8 (issue #363): a mutating tool's decoder runs only once the
 * request carries a string `revision`; any other request is refused here, so
 * the four decoders below receive the revision already checked.
 */
function withRevision<T extends MutatingToolName>(
  tool: T,
  decode: (id: string, raw: Record<string, unknown>, revision: string) => BridgeToolRequestFor<T> | string,
): RequestDecoder<T> {
  return (id, raw) => (typeof raw.revision === 'string' ? decode(id, raw, raw.revision) : `${tool} requires a string revision`);
}

// PRD 027 Req 7 (issue #363): one decoder per tool, keyed by the union — a
// tool added to `BRIDGE_TOOL_NAMES` without a decoder here fails the
// typecheck (the `FAILURE_KINDS` precedent in `auxProtocol.ts`).
const REQUEST_DECODERS: { [T in BridgeToolName]: RequestDecoder<T> } = {
  get_editor_state: (id) => ({ id, tool: 'get_editor_state' }),
  open_file: (id, raw) =>
    typeof raw.path === 'string' ? { id, tool: 'open_file', path: raw.path } : 'open_file path is not a string',
  scroll: (id, raw) => {
    const target = decodeScrollTarget(raw.target);
    return target === null ? 'scroll target is malformed' : { id, tool: 'scroll', target };
  },
  set_selection: (id, raw) =>
    isOffset(raw.from) && isOffset(raw.to)
      ? { id, tool: 'set_selection', from: raw.from, to: raw.to }
      : 'set_selection from/to are not offsets',
  replace_selection: withRevision('replace_selection', (id, raw, revision) =>
    typeof raw.text === 'string'
      ? { id, tool: 'replace_selection', revision, text: raw.text }
      : 'replace_selection text is not a string'),
  insert_text: withRevision('insert_text', (id, raw, revision) =>
    typeof raw.text === 'string'
      ? { id, tool: 'insert_text', revision, text: raw.text }
      : 'insert_text text is not a string'),
  replace_range: withRevision('replace_range', (id, raw, revision) =>
    isOffset(raw.from) && isOffset(raw.to) && typeof raw.text === 'string'
      ? { id, tool: 'replace_range', revision, from: raw.from, to: raw.to, text: raw.text }
      : 'replace_range from/to/text are malformed'),
  apply_format: withRevision('apply_format', (id, raw, revision) =>
    isFormatOp(raw.op)
      ? { id, tool: 'apply_format', revision, op: raw.op }
      : `apply_format op ${String(raw.op)} is not a SmartFormatOp`),
  save: (id) => ({ id, tool: 'save' }),
};

/**
 * PRD 027 Req 7 (issue #363): the editor's `SmartFormatOp` set as values. The
 * type is imported (never re-declared); this list is what the decoder checks
 * an untrusted `op` against, and `satisfies` keeps it in step with the union.
 */
export const SMART_FORMAT_OPS = [
  'bold', 'italic', 'strike', 'code', 'link',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'bullet', 'numbered', 'task',
  'quote', 'code-block', 'hr',
] as const satisfies readonly SmartFormatOp[];

function isFormatOp(value: unknown): value is SmartFormatOp {
  return typeof value === 'string' && (SMART_FORMAT_OPS as readonly string[]).includes(value);
}

function decodeScrollTarget(raw: unknown): ScrollTarget | null {
  if (!isRecord(raw)) return null;
  if ((raw.by === 'lines' || raw.by === 'pages') && isFiniteNumber(raw.amount)) return { by: raw.by, amount: raw.amount };
  if (raw.to === 'line' && isFiniteNumber(raw.line)) return { to: 'line', line: raw.line };
  if (raw.to === 'heading' && typeof raw.heading === 'string') return { to: 'heading', heading: raw.heading };
  return null;
}

/** PRD 027 Req 7+8 (issue #363): one result off the wire, or the reason it was refused. */
export function decodeToolResult(raw: unknown): BridgeToolResult | string {
  if (!isRecord(raw)) return 'result is not an object';
  const { id, ok } = raw;
  if (typeof id !== 'string' || !id) return 'result id is not a string';
  if (ok === true) {
    const state = decodeSnapshot(raw.state);
    if (state === null) return 'result state is malformed';
    return { ...raw, ok: true, id, state };
  }
  if (ok !== false) return 'result ok is not a boolean';
  const error = decodeError(raw.error);
  return error === null ? 'result error is malformed' : { ok: false, id, error };
}

function decodeError(raw: unknown): BridgeError | null {
  if (!isRecord(raw)) return null;
  const { code, message } = raw;
  if (code === 'no_controlled_session') return noControlledSessionError();
  if (typeof message !== 'string') return null;
  if (code === 'stale_revision') {
    const state = decodeSnapshot(raw.state);
    return state === null ? null : { code, message, state };
  }
  if (code === 'timeout' || code === 'invalid_request' || code === 'tool_failed') return { code, message };
  return null;
}

/** PRD 027 Req 7 (issue #363): one snapshot off the wire, every field checked; `null` when malformed. */
export function decodeSnapshot(raw: unknown): EditorStateSnapshot | null {
  if (!isRecord(raw)) return null;
  const { path, content, dirty, cursor, selection, scroll, revision } = raw;
  if (path !== null && typeof path !== 'string') return null;
  if (typeof content !== 'string' || typeof dirty !== 'boolean' || typeof revision !== 'string') return null;
  if (!isRecord(cursor) || !isOffset(cursor.offset) || !isFiniteNumber(cursor.line)) return null;
  if (!isRecord(selection) || !isOffset(selection.from) || !isOffset(selection.to) || typeof selection.text !== 'string') return null;
  if (!isRecord(scroll) || !isFiniteNumber(scroll.topLine) || !isFiniteNumber(scroll.totalLines)) return null;
  return {
    path,
    content,
    dirty,
    cursor: { offset: cursor.offset, line: cursor.line },
    selection: { from: selection.from, to: selection.to, text: selection.text },
    scroll: { topLine: scroll.topLine, totalLines: scroll.totalLines },
    revision,
  };
}

function isToolName(value: unknown): value is BridgeToolName {
  return typeof value === 'string' && (BRIDGE_TOOL_NAMES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A non-negative finite whole number — a text offset. */
function isOffset(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && Number.isInteger(value);
}

function refuse(reason: string): BridgeDecodeFailure {
  return { ok: false, reason };
}
