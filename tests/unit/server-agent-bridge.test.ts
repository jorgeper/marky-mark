import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionBroker, type SessionTransport } from '../../server/agentBridge';
import {
  BRIDGE_PROTOCOL_VERSION,
  noControlledSessionError,
  type EditorStateSnapshot,
  type ServerToTabMessage,
} from '../../src/lib/agentBridgeProtocol';

// PRD 027 Req 14 (issue #363): the session broker, driven through an
// in-memory fake transport — no WebSocket, no HTTP, no Azure. The tab side
// is whatever `deliver` is handed.

const snapshot = (revision = 'r1'): EditorStateSnapshot => ({
  path: 'a.md',
  content: 'hello',
  dirty: false,
  cursor: { offset: 0, line: 1 },
  selection: { from: 0, to: 0, text: '' },
  scroll: { topLine: 1, totalLines: 1 },
  revision,
});

/** A fake transport: records every `send` and `close`; answers nothing on its own. */
function fakeTransport() {
  const sent: ServerToTabMessage[] = [];
  let closed = 0;
  const transport: SessionTransport = {
    send: (message) => {
      sent.push(message);
    },
    close: () => {
      closed += 1;
    },
  };
  /** The requests sent so far (the takeover notices filtered out). */
  const requests = () => sent.flatMap((m) => (m.kind === 'tool_request' ? [m.request] : []));
  return { transport, sent, requests, closed: () => closed };
}

/** Let promise callbacks scheduled by a `deliver` run. */
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('PRD 027 Req 14 (issue #363) session broker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('U1388: dispatch with no registered session settles with no_controlled_session, as data', async () => {
    const broker = createSessionBroker();
    expect(broker.has('ws-1')).toBe(false);
    const result = await broker.dispatch('ws-1', { tool: 'get_editor_state' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual(noControlledSessionError());
    expect(result.error.message).toBe('no controlled session');
    expect(typeof result.id).toBe('string');
    expect(broker.lastState('ws-1')).toBeNull();
  });

  it('U1389: register + dispatch sends one tool_request with a unique id; the matching result settles the call', async () => {
    const broker = createSessionBroker();
    const tab = fakeTransport();
    const handle = broker.register('ws-1', tab.transport);
    expect(broker.has('ws-1')).toBe(true);
    expect(handle.active).toBe(true);

    const first = broker.dispatch('ws-1', { tool: 'replace_selection', revision: 'r1', text: 'x' });
    const second = broker.dispatch('ws-1', { tool: 'save' });
    expect(tab.sent).toHaveLength(2);
    const [reqA, reqB] = tab.requests();
    expect(tab.sent[0]).toEqual({ v: BRIDGE_PROTOCOL_VERSION, kind: 'tool_request', request: reqA });
    expect(reqA).toMatchObject({ tool: 'replace_selection', revision: 'r1', text: 'x' });
    expect(reqB).toMatchObject({ tool: 'save' });
    expect(reqA.id).not.toBe(reqB.id);
    expect(reqA.id.length).toBeGreaterThan(0);

    // Answer out of order: the id, not arrival order, correlates.
    handle.deliver({ v: 1, kind: 'tool_result', result: { ok: true, id: reqB.id, state: snapshot('r2') } });
    expect(await second).toEqual({ ok: true, id: reqB.id, state: snapshot('r2') });
    handle.deliver({ v: 1, kind: 'tool_result', result: { ok: false, id: reqA.id, error: { code: 'stale_revision', message: 'changed', state: snapshot('r3') } } });
    const a = await first;
    expect(a.ok).toBe(false);
    if (a.ok) throw new Error('unreachable');
    expect(a.error.code).toBe('stale_revision');
    // The broker remembers the latest successful snapshot.
    expect(broker.lastState('ws-1')).toEqual(snapshot('r2'));
    expect(tab.closed()).toBe(0);
  });

  it('U1390: results with unknown ids and state pushes settle nothing; a state push updates lastState', async () => {
    const broker = createSessionBroker();
    const tab = fakeTransport();
    const handle = broker.register('ws-1', tab.transport);
    let settled = false;
    const call = broker.dispatch('ws-1', { tool: 'get_editor_state' }).then((r) => {
      settled = true;
      return r;
    });
    handle.deliver({ v: 1, kind: 'tool_result', result: { ok: true, id: 'not-ours', state: snapshot('zz') } });
    handle.deliver({ v: 1, kind: 'state', state: snapshot('pushed') });
    await tick();
    expect(settled).toBe(false);
    expect(broker.lastState('ws-1')).toEqual(snapshot('pushed'));
    const [req] = tab.requests();
    handle.deliver({ v: 1, kind: 'tool_result', result: { ok: true, id: req.id, state: snapshot('r9') } });
    expect((await call).ok).toBe(true);
    expect(settled).toBe(true);
  });

  it('U1391: a second registration replaces the first — session_replaced + close, pending settled, stale handle inert', async () => {
    const broker = createSessionBroker();
    const old = fakeTransport();
    const oldHandle = broker.register('ws-1', old.transport);
    const oldCall = broker.dispatch('ws-1', { tool: 'save' });
    const [oldReq] = old.requests();

    const fresh = fakeTransport();
    const freshHandle = broker.register('ws-1', fresh.transport);

    // PRD 027 Req 10: the old tab is told, then its channel is closed.
    expect(old.sent.at(-1)).toEqual({ v: BRIDGE_PROTOCOL_VERSION, kind: 'session_replaced' });
    expect(old.closed()).toBe(1);
    expect(oldHandle.active).toBe(false);
    expect(freshHandle.active).toBe(true);
    expect(broker.has('ws-1')).toBe(true);
    // Its pending call settles with no_controlled_session, keeping its id.
    expect(await oldCall).toEqual({ ok: false, id: oldReq.id, error: noControlledSessionError() });

    // Subsequent dispatches reach the new session only.
    const newCall = broker.dispatch('ws-1', { tool: 'insert_text', revision: 'r1', text: 'hi' });
    expect(fresh.requests()).toHaveLength(1);
    expect(old.requests()).toHaveLength(1);
    const [newReq] = fresh.requests();

    // The stale handle cannot answer the new session's request, nor push state into it.
    let settled = false;
    void newCall.then(() => {
      settled = true;
    });
    oldHandle.deliver({ v: 1, kind: 'tool_result', result: { ok: true, id: newReq.id, state: snapshot('stale') } });
    oldHandle.deliver({ v: 1, kind: 'state', state: snapshot('stale-push') });
    await tick();
    expect(settled).toBe(false);
    expect(broker.lastState('ws-1')).toBeNull();
    // A stale handle's close() does not tear down the live session either.
    oldHandle.close();
    expect(broker.has('ws-1')).toBe(true);
    expect(fresh.closed()).toBe(0);

    freshHandle.deliver({ v: 1, kind: 'tool_result', result: { ok: true, id: newReq.id, state: snapshot('r2') } });
    expect(await newCall).toEqual({ ok: true, id: newReq.id, state: snapshot('r2') });
    // The new transport never received a takeover notice.
    expect(fresh.sent.every((m) => m.kind === 'tool_request')).toBe(true);
  });

  it('U1392: two workspaces hold independent sessions', async () => {
    const broker = createSessionBroker();
    const a = fakeTransport();
    const b = fakeTransport();
    const handleA = broker.register('ws-a', a.transport);
    const handleB = broker.register('ws-b', b.transport);
    expect(a.closed()).toBe(0);
    expect(a.sent).toHaveLength(0);

    const callA = broker.dispatch('ws-a', { tool: 'save' });
    const callB = broker.dispatch('ws-b', { tool: 'save' });
    expect(a.requests()).toHaveLength(1);
    expect(b.requests()).toHaveLength(1);
    const [reqA] = a.requests();
    const [reqB] = b.requests();
    // B's handle cannot settle A's call.
    handleB.deliver({ v: 1, kind: 'tool_result', result: { ok: true, id: reqA.id, state: snapshot('wrong') } });
    handleA.deliver({ v: 1, kind: 'tool_result', result: { ok: true, id: reqA.id, state: snapshot('a') } });
    handleB.deliver({ v: 1, kind: 'tool_result', result: { ok: true, id: reqB.id, state: snapshot('b') } });
    expect((await callA)).toEqual({ ok: true, id: reqA.id, state: snapshot('a') });
    expect((await callB)).toEqual({ ok: true, id: reqB.id, state: snapshot('b') });

    handleA.close();
    expect(broker.has('ws-a')).toBe(false);
    expect(broker.has('ws-b')).toBe(true);
  });

  it('U1393: handle close() tears the session down — has() false, pending settled, later dispatches refused', async () => {
    const broker = createSessionBroker();
    const tab = fakeTransport();
    const handle = broker.register('ws-1', tab.transport);
    const pending = broker.dispatch('ws-1', { tool: 'get_editor_state' });
    const [req] = tab.requests();
    handle.close();
    expect(handle.active).toBe(false);
    expect(broker.has('ws-1')).toBe(false);
    expect(await pending).toEqual({ ok: false, id: req.id, error: noControlledSessionError() });
    // The broker never calls close() on a transport that closed itself.
    expect(tab.closed()).toBe(0);
    // Later: refused, and the transport hears nothing more.
    const later = await broker.dispatch('ws-1', { tool: 'save' });
    expect(later.ok).toBe(false);
    if (later.ok) throw new Error('unreachable');
    expect(later.error.code).toBe('no_controlled_session');
    expect(tab.sent).toHaveLength(1);
    // A late result for the closed session is ignored, not a crash.
    handle.deliver({ v: 1, kind: 'tool_result', result: { ok: true, id: req.id, state: snapshot() } });
    expect(broker.lastState('ws-1')).toBeNull();
  });

  it('U1394: an unanswered request settles with timeout after timeoutMs; a result arriving afterwards is ignored', async () => {
    vi.useFakeTimers();
    const broker = createSessionBroker({ timeoutMs: 250 });
    const tab = fakeTransport();
    const handle = broker.register('ws-1', tab.transport);
    let settled: unknown = null;
    const call = broker.dispatch('ws-1', { tool: 'scroll', target: { by: 'pages', amount: 1 } }).then((r) => {
      settled = r;
      return r;
    });
    const [req] = tab.requests();
    await vi.advanceTimersByTimeAsync(249);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    const result = await call;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.id).toBe(req.id);
    expect(result.error.code).toBe('timeout');
    expect(result.error.message).toContain('scroll');
    // Late answer: ignored, and the session stays registered and usable.
    handle.deliver({ v: 1, kind: 'tool_result', result: { ok: true, id: req.id, state: snapshot('late') } });
    expect(broker.lastState('ws-1')).toBeNull();
    expect(broker.has('ws-1')).toBe(true);
    const next = broker.dispatch('ws-1', { tool: 'save' });
    const [, req2] = tab.requests();
    handle.deliver({ v: 1, kind: 'tool_result', result: { ok: true, id: req2.id, state: snapshot('r2') } });
    expect((await next).ok).toBe(true);
    // The default timeout is a few seconds, and an answered call leaves no live timer behind.
    expect(vi.getTimerCount()).toBe(0);
  });
});
