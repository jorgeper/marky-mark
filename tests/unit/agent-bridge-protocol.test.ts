import { describe, expect, it } from 'vitest';
import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_TOOL_NAMES,
  decodeBridgeMessage,
  encodeBridgeMessage,
  isMutatingTool,
  MUTATING_TOOLS,
  NO_CONTROLLED_SESSION_MESSAGE,
  noControlledSessionError,
  SMART_FORMAT_OPS,
  type BridgeMessage,
  type BridgeToolName,
  type BridgeToolRequest,
  type EditorStateSnapshot,
} from '../../src/lib/agentBridgeProtocol';

// PRD 027 Req 14 (issue #363): the server↔tab contract, proven with no
// transport at all — every check here is encode → decode of plain strings.

const snapshot = (revision = 'r1'): EditorStateSnapshot => ({
  path: 'notes/plan.md',
  content: '# Plan\n\nHello world\n',
  dirty: true,
  cursor: { offset: 9, line: 3 },
  selection: { from: 9, to: 14, text: 'Hello' },
  scroll: { topLine: 1, totalLines: 3 },
  revision,
});

/** One well-formed request per tool, keyed by the union so a new tool fails the typecheck here too. */
const REQUESTS: { [T in BridgeToolName]: Extract<BridgeToolRequest, { tool: T }> } = {
  get_editor_state: { id: 'a', tool: 'get_editor_state' },
  open_file: { id: 'b', tool: 'open_file', path: 'notes/plan.md' },
  scroll: { id: 'c', tool: 'scroll', target: { by: 'pages', amount: -1 } },
  set_selection: { id: 'd', tool: 'set_selection', from: 2, to: 7 },
  replace_selection: { id: 'e', tool: 'replace_selection', revision: 'r1', text: 'Goodbye' },
  insert_text: { id: 'f', tool: 'insert_text', revision: 'r1', text: '!' },
  replace_range: { id: 'g', tool: 'replace_range', revision: 'r1', from: 0, to: 6, text: '# Agenda' },
  apply_format: { id: 'h', tool: 'apply_format', revision: 'r1', op: 'bold' },
  save: { id: 'i', tool: 'save' },
};

const roundTrip = (message: BridgeMessage) => decodeBridgeMessage(encodeBridgeMessage(message));

describe('PRD 027 Req 14 (issue #363) agent bridge protocol', () => {
  it('U1383: the tool inventory is exactly the nine PRD Req 7 session tools, unique', () => {
    expect(BRIDGE_PROTOCOL_VERSION).toBe(1);
    expect([...BRIDGE_TOOL_NAMES].sort()).toEqual(
      ['apply_format', 'get_editor_state', 'insert_text', 'open_file', 'replace_range', 'replace_selection', 'save', 'scroll', 'set_selection'],
    );
    expect(new Set(BRIDGE_TOOL_NAMES).size).toBe(9);
  });

  it('U1384: every tool request encodes to a wire envelope that decodes back deep-equal', () => {
    for (const tool of BRIDGE_TOOL_NAMES) {
      const request = REQUESTS[tool];
      const decoded = roundTrip({ v: BRIDGE_PROTOCOL_VERSION, kind: 'tool_request', request });
      expect(decoded, tool).toEqual({ ok: true, message: { v: 1, kind: 'tool_request', request } });
    }
    // The other server → tab envelope, the takeover notice (Req 10).
    expect(roundTrip({ v: BRIDGE_PROTOCOL_VERSION, kind: 'session_replaced' })).toEqual({
      ok: true,
      message: { v: 1, kind: 'session_replaced' },
    });
    // The scroll variants beyond the one in REQUESTS.
    for (const target of [{ by: 'lines', amount: 3 }, { to: 'line', line: 12 }, { to: 'heading', heading: 'Plan' }] as const) {
      const request: BridgeToolRequest = { id: 's', tool: 'scroll', target };
      expect(roundTrip({ v: 1, kind: 'tool_request', request })).toEqual({ ok: true, message: { v: 1, kind: 'tool_request', request } });
    }
  });

  it('U1385: success, stale_revision (with fresh state) and no_controlled_session results round-trip; state pushes too', () => {
    const success = { ok: true as const, id: 'e', state: snapshot('r2'), saved: true };
    expect(roundTrip({ v: 1, kind: 'tool_result', result: success })).toEqual({
      ok: true,
      message: { v: 1, kind: 'tool_result', result: success },
    });
    const stale = { ok: false as const, id: 'f', error: { code: 'stale_revision' as const, message: 'buffer changed', state: snapshot('r3') } };
    expect(roundTrip({ v: 1, kind: 'tool_result', result: stale })).toEqual({ ok: true, message: { v: 1, kind: 'tool_result', result: stale } });
    const none = { ok: false as const, id: 'g', error: noControlledSessionError() };
    expect(NO_CONTROLLED_SESSION_MESSAGE).toBe('no controlled session');
    expect(none.error).toEqual({ code: 'no_controlled_session', message: 'no controlled session' });
    expect(roundTrip({ v: 1, kind: 'tool_result', result: none })).toEqual({ ok: true, message: { v: 1, kind: 'tool_result', result: none } });
    for (const code of ['timeout', 'invalid_request', 'tool_failed'] as const) {
      const result = { ok: false as const, id: 'h', error: { code, message: 'why' } };
      expect(roundTrip({ v: 1, kind: 'tool_result', result })).toEqual({ ok: true, message: { v: 1, kind: 'tool_result', result } });
    }
    expect(roundTrip({ v: 1, kind: 'state', state: snapshot() })).toEqual({ ok: true, message: { v: 1, kind: 'state', state: snapshot() } });
  });

  it('U1386: MUTATING_TOOLS is exactly the four PRD Req 8 tools and isMutatingTool agrees', () => {
    expect([...MUTATING_TOOLS].sort()).toEqual(['apply_format', 'insert_text', 'replace_range', 'replace_selection']);
    for (const tool of BRIDGE_TOOL_NAMES) {
      expect(isMutatingTool(tool), tool).toBe((MUTATING_TOOLS as readonly string[]).includes(tool));
    }
    // The op list the decoder checks against mirrors the editor's SmartFormatOp set.
    expect(SMART_FORMAT_OPS).toContain('bold');
    expect(SMART_FORMAT_OPS).toContain('code-block');
    expect(SMART_FORMAT_OPS).toHaveLength(17);
  });

  it('U1387: decode refuses malformed wire text as data — never a throw', () => {
    const failure = (text: string) => {
      const decoded = decodeBridgeMessage(text);
      expect(decoded.ok, text).toBe(false);
      return decoded.ok ? '' : decoded.reason;
    };
    expect(failure('{not json')).toBe('not JSON');
    expect(failure('"a string"')).toBe('not an object');
    expect(failure('[]')).toBe('not an object');
    expect(failure(JSON.stringify({ v: 1 }))).toBe('missing kind');
    expect(failure(JSON.stringify({ v: 1, kind: 'ping' }))).toMatch(/unknown kind ping/);
    expect(failure(JSON.stringify({ v: 1, kind: 'tool_request', request: { id: 'x', tool: 'format_disk' } }))).toMatch(/unknown tool format_disk/);
    expect(failure(JSON.stringify({ v: 2, kind: 'session_replaced' }))).toMatch(/unsupported protocol version 2/);
    expect(failure(JSON.stringify({ kind: 'session_replaced' }))).toMatch(/unsupported protocol version/);
    // A mutating request without a string revision (Req 8) is refused, for every mutating tool.
    for (const tool of MUTATING_TOOLS) {
      const { revision: _dropped, ...noRevision } = REQUESTS[tool];
      expect(failure(JSON.stringify({ v: 1, kind: 'tool_request', request: noRevision }))).toMatch(new RegExp(`${tool} requires a string revision`));
      expect(failure(JSON.stringify({ v: 1, kind: 'tool_request', request: { ...noRevision, revision: 7 } }))).toMatch(/requires a string revision/);
    }
    // Wrong field types.
    expect(failure(JSON.stringify({ v: 1, kind: 'tool_request', request: { id: 'x', tool: 'open_file', path: 3 } }))).toMatch(/path is not a string/);
    expect(failure(JSON.stringify({ v: 1, kind: 'tool_request', request: { id: 'x', tool: 'set_selection', from: -1, to: 2 } }))).toMatch(/offsets/);
    expect(failure(JSON.stringify({ v: 1, kind: 'tool_request', request: { id: 'x', tool: 'scroll', target: { by: 'miles', amount: 1 } } }))).toMatch(/scroll target/);
    expect(failure(JSON.stringify({ v: 1, kind: 'tool_request', request: { id: 'x', tool: 'apply_format', revision: 'r', op: 'blink' } }))).toMatch(/not a SmartFormatOp/);
    expect(failure(JSON.stringify({ v: 1, kind: 'tool_request', request: { id: '', tool: 'save' } }))).toMatch(/id is not a string/);
    expect(failure(JSON.stringify({ v: 1, kind: 'tool_result', result: { ok: true, id: 'x', state: { path: 1 } } }))).toMatch(/state is malformed/);
    expect(failure(JSON.stringify({ v: 1, kind: 'tool_result', result: { ok: false, id: 'x', error: { code: 'weird', message: 'm' } } }))).toMatch(/error is malformed/);
    expect(failure(JSON.stringify({ v: 1, kind: 'tool_result', result: { ok: 'yes', id: 'x' } }))).toMatch(/ok is not a boolean/);
    expect(failure(JSON.stringify({ v: 1, kind: 'state', state: { ...snapshot(), dirty: 'yes' } }))).toBe('malformed state');
  });
});
