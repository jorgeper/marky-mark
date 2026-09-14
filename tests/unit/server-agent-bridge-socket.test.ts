import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, createAppHandlers } from '../../server/app';
import { createMockAuthProvider } from '../../server/providers/mock/auth';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import type { StorageProvider } from '../../server/providers/types';
import { mintAgentToken } from '../../server/agentTokens';
import { agentSessionWorkspaceId } from '../../server/agentBridgeSocket';
import { MCP_TOOLS } from '../../server/mcp';
import { acceptKeyFor } from '../../server/websocket';
import { WORKSPACE_ROUTE_PERMISSIONS } from '../../server/workspaces';
import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_TOOL_NAMES,
  decodeBridgeMessage,
  encodeBridgeMessage,
  NO_CONTROLLED_SESSION_MESSAGE,
  type BridgeToolRequest,
  type EditorStateSnapshot,
} from '../../src/lib/agentBridgeProtocol';
import { createMemoryStorage } from './storage-contract';

// PRD 027 Reqs 7, 9, 10 (issue #367): the control channel end to end,
// in-process — `createServer` + the app's upgrade handler over the in-memory
// storage seam, Node's global `WebSocket` as the tab, and raw JSON-RPC to
// /api/mcp as the agent. The same behaviour runs against the real local
// server in tests/e2e/hosted.spec.ts (E655+).

interface RpcBody {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface ToolResult {
  content: [{ type: 'text'; text: string }];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

const snapshot = (over: Partial<EditorStateSnapshot> = {}): EditorStateSnapshot => ({
  path: 'notes.md',
  content: '# Notes\n\nhello\n',
  dirty: false,
  cursor: { offset: 0, line: 1 },
  selection: { from: 0, to: 0, text: '' },
  scroll: { topLine: 1, totalLines: 3 },
  revision: 'r1',
  ...over,
});

/** Await one event on a WebSocket. */
const once = <T = unknown>(socket: WebSocket, name: string): Promise<T> =>
  new Promise((resolve) => socket.addEventListener(name, (e) => resolve(e as T), { once: true }));

/** A tab: an open socket, plus a queue of the decoded requests it receives. */
async function openTab(url: string): Promise<{
  socket: WebSocket;
  nextRequest(): Promise<BridgeToolRequest>;
  nextMessage(): Promise<string>;
  /** How many messages the tab has received so far. */
  received(): number;
  answer(result: Record<string, unknown>): void;
}> {
  const socket = new WebSocket(url);
  const queue: string[] = [];
  const waiters: ((text: string) => void)[] = [];
  let received = 0;
  socket.addEventListener('message', (e) => {
    received += 1;
    const text = String((e as MessageEvent).data);
    const waiter = waiters.shift();
    if (waiter) waiter(text);
    else queue.push(text);
  });
  const opened = once(socket, 'open');
  const failed = once<Event>(socket, 'error').then(() => {
    throw new Error('websocket refused');
  });
  await Promise.race([opened, failed]);
  const nextMessage = () =>
    new Promise<string>((resolve) => {
      const queued = queue.shift();
      if (queued !== undefined) resolve(queued);
      else waiters.push(resolve);
    });
  return {
    socket,
    nextMessage,
    received: () => received,
    async nextRequest() {
      const decoded = decodeBridgeMessage(await nextMessage());
      if (!decoded.ok || decoded.message.kind !== 'tool_request') throw new Error('expected a tool_request');
      return decoded.message.request;
    },
    answer(result) {
      socket.send(JSON.stringify({ v: BRIDGE_PROTOCOL_VERSION, kind: 'tool_result', result }));
    },
  };
}

/** The refusal an upgrade attempt got: the socket errors and closes with no `101`. */
async function refused(url: string): Promise<boolean> {
  const socket = new WebSocket(url);
  return new Promise((resolve) => {
    socket.addEventListener('open', () => {
      socket.close();
      resolve(false);
    });
    socket.addEventListener('error', () => resolve(true), { once: true });
  });
}

describe('PRD 027 Reqs 7+9+10 (issue #367) agent-session WebSocket + MCP session tools', () => {
  const { provider } = createMemoryStorage();
  let reads = 0;
  const counted: StorageProvider = {
    ...provider,
    read: (path) => {
      reads += 1;
      return provider.read(path);
    },
    list: (prefix) => {
      reads += 1;
      return provider.list(prefix);
    },
  };
  const auth = createMockAuthProvider();
  let onServer: Server;
  let offServer: Server;
  let on = '';
  let onWs = '';
  let off = '';
  let offWs = '';
  const sessions: Record<string, string> = {};

  beforeAll(async () => {
    const providers = { auth, storage: counted, directory: createMockDirectoryProvider() };
    const handlers = createAppHandlers('/nonexistent-static', providers, 'local', undefined, undefined, true);
    expect(handlers.upgrade).not.toBeNull();
    onServer = createServer(handlers.request);
    onServer.on('upgrade', handlers.upgrade!);
    // The flag-off app: `createApp`'s shape unchanged, and the handler pair
    // carries no upgrade listener to attach.
    const offHandlers = createAppHandlers('/nonexistent-static', providers, 'local');
    expect(offHandlers.upgrade).toBeNull();
    offServer = createServer(createApp('/nonexistent-static', providers, 'local'));
    await new Promise<void>((resolve) => onServer.listen(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => offServer.listen(0, '127.0.0.1', resolve));
    on = `http://127.0.0.1:${(onServer.address() as AddressInfo).port}`;
    onWs = on.replace('http', 'ws');
    off = `http://127.0.0.1:${(offServer.address() as AddressInfo).port}`;
    offWs = off.replace('http', 'ws');
    for (const username of ['ada', 'alan']) {
      const result = await auth.signIn({ username });
      if (result?.kind !== 'token') throw new Error('mock sign-in failed');
      sessions[username] = result.token;
    }
  });

  afterAll(async () => {
    onServer.closeAllConnections();
    offServer.closeAllConnections();
    await new Promise<void>((resolve) => onServer.close(() => resolve()));
    await new Promise<void>((resolve) => offServer.close(() => resolve()));
  });

  const api = (user: string, method: string, path: string, body?: string, base = on): Promise<Response> =>
    fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${sessions[user]}` }, body });

  /** A workspace owned by ada with an agent token; the tab URL carries her session. */
  async function bridgeWorkspace(name: string): Promise<{ id: string; token: string; tabUrl: string }> {
    const res = await api('ada', 'POST', '/api/workspaces', JSON.stringify({ name }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const { token } = await mintAgentToken(provider, id, 'test');
    return { id, token, tabUrl: `${onWs}/api/workspaces/${id}/agent-session?access_token=${encodeURIComponent(sessions.ada)}` };
  }

  let nextId = 1;
  const rpc = (token: string, method: string, params?: unknown) =>
    fetch(`${on}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, ...(params === undefined ? {} : { params }) }),
    });

  async function callTool(token: string, name: string, args?: unknown): Promise<ToolResult> {
    const res = await rpc(token, 'tools/call', { name, ...(args === undefined ? {} : { arguments: args }) });
    expect(res.status, name).toBe(200);
    const body = (await res.json()) as RpcBody;
    expect(body.error, name).toBeUndefined();
    const result = body.result as unknown as ToolResult;
    expect(JSON.parse(result.content[0].text), name).toEqual(result.structuredContent);
    return result;
  }

  const errorOf = (result: ToolResult) => (result.structuredContent as { error: { code: string; message: string; state?: unknown } }).error;

  it('U1427: tools/list is exactly the fourteen tools — the five file tools then the nine session tools in protocol order, each a closed schema; the mutating four require revision and none names a workspace', async () => {
    const { token } = await bridgeWorkspace('Tools');
    const body = (await (await rpc(token, 'tools/list')).json()) as RpcBody;
    const tools = (body.result as { tools: { name: string; inputSchema: { required: string[]; properties: Record<string, unknown>; additionalProperties: boolean } }[] }).tools;
    expect(tools).toEqual(MCP_TOOLS);
    expect(tools.map((t) => t.name)).toEqual(['get_workspace', 'list_files', 'read_file', 'create_file', 'write_file', ...BRIDGE_TOOL_NAMES]);
    for (const tool of tools) {
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
      expect(JSON.stringify(tool.inputSchema).toLowerCase(), tool.name).not.toContain('workspace');
    }
    const byName = new Map(tools.map((t) => [t.name, t.inputSchema]));
    for (const name of ['replace_selection', 'insert_text', 'replace_range', 'apply_format']) {
      expect(byName.get(name)!.required, name).toContain('revision');
    }
    expect(byName.get('scroll')!.required).toEqual(['target']);
    expect(byName.get('set_selection')!.required).toEqual(['from', 'to']);
    expect(byName.get('replace_range')!.required).toEqual(['revision', 'from', 'to', 'text']);
    expect((byName.get('apply_format')!.properties.op as { enum: string[] }).enum).toContain('bold');
  });

  it('U1428: an upgrade without a token, with a bad token, from a non-member, and to an unknown workspace is refused with no 101; a plain GET on the route is 426 behind the doc.read gate', async () => {
    const { id } = await bridgeWorkspace('Refusals');
    expect(await refused(`${onWs}/api/workspaces/${id}/agent-session`)).toBe(true);
    expect(await refused(`${onWs}/api/workspaces/${id}/agent-session?access_token=nope`)).toBe(true);
    expect(await refused(`${onWs}/api/workspaces/${id}/agent-session?access_token=${encodeURIComponent(sessions.alan)}`)).toBe(true);
    expect(await refused(`${onWs}/api/workspaces/no-such/agent-session?access_token=${encodeURIComponent(sessions.ada)}`)).toBe(true);
    expect(await refused(`${onWs}/api/workspaces/${id}/other?access_token=${encodeURIComponent(sessions.ada)}`)).toBe(true);
    // The route is in the permission table (the drift test in
    // server-workspaces.test.ts covers it) and a plain GET is told to upgrade.
    expect(WORKSPACE_ROUTE_PERMISSIONS.find((r) => r.path === 'agent-session')).toMatchObject({ method: 'GET', required: 'doc.read' });
    const plain = await api('ada', 'GET', `/api/workspaces/${id}/agent-session`);
    expect(plain.status).toBe(426);
    const nonMember = await api('alan', 'GET', `/api/workspaces/${id}/agent-session`);
    expect(nonMember.status).toBe(403);
    expect(((await nonMember.json()) as { required: string }).required).toBe('doc.read');
    // Path parsing: only the exact shape names a workspace.
    expect(agentSessionWorkspaceId(`/api/workspaces/${id}/agent-session`)).toBe(id);
    expect(agentSessionWorkspaceId('/api/workspaces/a%20b/agent-session')).toBe('a b');
    expect(agentSessionWorkspaceId('/api/workspaces//agent-session')).toBeNull();
    expect(agentSessionWorkspaceId('/api/workspaces/x/y/agent-session')).toBeNull();
    expect(agentSessionWorkspaceId('/api/workspaces/x/files')).toBeNull();
    // RFC 6455 §4.2.2's worked example.
    expect(acceptKeyFor('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it('U1429: with the flag off the path is refused with no 101 and no bridge code runs (no storage read)', async () => {
    const { id } = await bridgeWorkspace('Off');
    reads = 0;
    expect(await refused(`${offWs}/api/workspaces/${id}/agent-session?access_token=${encodeURIComponent(sessions.ada)}`)).toBe(true);
    expect(reads).toBe(0);
    const plain = await api('ada', 'GET', `/api/workspaces/${id}/agent-session`, undefined, off);
    expect(plain.status).toBe(404);
  });

  it('U1430: without a tab every session tool answers no_controlled_session as data while file tools work; a member\'s upgrade registers the tab so get_editor_state reaches it and its tool_result comes back as {state}', async () => {
    const { token, tabUrl } = await bridgeWorkspace('Round trip');
    for (const name of BRIDGE_TOOL_NAMES) {
      const args =
        name === 'open_file' ? { path: 'a.md' }
        : name === 'scroll' ? { target: { by: 'lines', amount: 2 } }
        : name === 'set_selection' ? { from: 0, to: 1 }
        : name === 'replace_selection' || name === 'insert_text' ? { revision: 'r', text: 'x' }
        : name === 'replace_range' ? { revision: 'r', from: 0, to: 1, text: 'x' }
        : name === 'apply_format' ? { revision: 'r', op: 'bold' }
        : undefined;
      const result = await callTool(token, name, args);
      expect(result.isError, name).toBe(true);
      expect(errorOf(result), name).toEqual({ code: 'no_controlled_session', message: NO_CONTROLLED_SESSION_MESSAGE });
    }
    const created = await callTool(token, 'create_file', { path: 'a.md', content: 'hi' });
    expect(created.isError).toBeUndefined();

    const tab = await openTab(tabUrl);
    const pending = callTool(token, 'get_editor_state');
    const request = await tab.nextRequest();
    expect(request.tool).toBe('get_editor_state');
    expect(typeof request.id).toBe('string');
    tab.answer({ ok: true, id: request.id, state: snapshot() });
    const result = await pending;
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ state: snapshot() });

    // A scroll carries its typed target; a mutating call carries the revision.
    const scrolling = callTool(token, 'scroll', { target: { to: 'heading', heading: 'Notes' } });
    const scroll = await tab.nextRequest();
    expect(scroll).toEqual({ id: scroll.id, tool: 'scroll', target: { to: 'heading', heading: 'Notes' } });
    tab.answer({ ok: true, id: scroll.id, state: snapshot({ scroll: { topLine: 1, totalLines: 3 } }) });
    expect((await scrolling).isError).toBeUndefined();

    // stale_revision comes back with the fresh state; tool_failed with its message.
    const stale = callTool(token, 'insert_text', { revision: 'old', text: 'x' });
    const insert = await tab.nextRequest();
    expect(insert).toEqual({ id: insert.id, tool: 'insert_text', revision: 'old', text: 'x' });
    tab.answer({ ok: false, id: insert.id, error: { code: 'stale_revision', message: 'buffer changed', state: snapshot({ revision: 'r2' }) } });
    const staleResult = await stale;
    expect(staleResult.isError).toBe(true);
    expect(errorOf(staleResult)).toEqual({ code: 'stale_revision', message: 'buffer changed', state: snapshot({ revision: 'r2' }) });
    const failing = callTool(token, 'save');
    const save = await tab.nextRequest();
    tab.answer({ ok: false, id: save.id, error: { code: 'tool_failed', message: 'nope' } });
    expect(errorOf(await failing)).toEqual({ code: 'tool_failed', message: 'nope' });

    // File tools are unaffected by the tab.
    const read = await callTool(token, 'read_file', { path: 'a.md' });
    expect(read.structuredContent).toMatchObject({ path: 'a.md', content: 'hi' });

    // Closing the socket tears the session down: session tools fail again.
    tab.socket.close();
    await once(tab.socket, 'close');
    await new Promise((r) => setTimeout(r, 20));
    expect(errorOf(await callTool(token, 'get_editor_state')).code).toBe('no_controlled_session');
  });

  it('U1431: a token for another workspace never reaches the tab; a malformed frame, a server→tab kind and an unknown result id are ignored without closing the channel', async () => {
    const a = await bridgeWorkspace('A');
    const b = await bridgeWorkspace('B');
    const tab = await openTab(a.tabUrl);
    // B's token: no tab for B, and A's socket sees nothing.
    const other = await callTool(b.token, 'get_editor_state');
    expect(errorOf(other).code).toBe('no_controlled_session');
    // Noise on the channel: not JSON, wrong version, a tool_request echoed
    // back, a result nobody is waiting for — all dropped, socket still open.
    tab.socket.send('{not json');
    tab.socket.send(JSON.stringify({ v: 99, kind: 'state', state: snapshot() }));
    tab.socket.send(encodeBridgeMessage({ v: BRIDGE_PROTOCOL_VERSION, kind: 'tool_request', request: { id: 'x', tool: 'save' } }));
    tab.answer({ ok: true, id: 'never-asked', state: snapshot() });
    tab.socket.send(encodeBridgeMessage({ v: BRIDGE_PROTOCOL_VERSION, kind: 'state', state: snapshot({ revision: 'pushed' }) }));
    await new Promise((r) => setTimeout(r, 30));
    expect(tab.socket.readyState).toBe(WebSocket.OPEN);
    expect(tab.received()).toBe(0);
    // Still the live session: a real call round-trips (the first message it gets).
    const pending = callTool(a.token, 'get_editor_state');
    const request = await tab.nextRequest();
    tab.answer({ ok: true, id: request.id, state: snapshot() });
    expect((await pending).isError).toBeUndefined();
    tab.socket.close();
    await once(tab.socket, 'close');
  });

  it('U1432: a second upgrade for the same workspace makes the first socket receive session_replaced and close; the second is the live session', async () => {
    const { token, tabUrl } = await bridgeWorkspace('Takeover');
    const first = await openTab(tabUrl);
    const firstClosed = once<CloseEvent>(first.socket, 'close');
    const second = await openTab(tabUrl);
    const notice = decodeBridgeMessage(await first.nextMessage());
    expect(notice).toEqual({ ok: true, message: { v: BRIDGE_PROTOCOL_VERSION, kind: 'session_replaced' } });
    const closeEvent = await firstClosed;
    expect(closeEvent.code).toBe(1000);
    const pending = callTool(token, 'get_editor_state');
    const request = await second.nextRequest();
    second.answer({ ok: true, id: request.id, state: snapshot({ revision: 'second' }) });
    expect((await pending).structuredContent).toEqual({ state: snapshot({ revision: 'second' }) });
    second.socket.close();
    await once(second.socket, 'close');
  });

  it('U1433: bad session-tool arguments answer invalid_params without a dispatch — unknown key, missing revision, a bad scroll target, a non-integer offset, an op outside SMART_FORMAT_OPS', async () => {
    const { token, tabUrl } = await bridgeWorkspace('Params');
    const tab = await openTab(tabUrl);
    const bad: [string, unknown][] = [
      ['get_editor_state', { workspace: 'x' }],
      ['open_file', {}],
      ['open_file', { path: 3 }],
      ['scroll', { target: { by: 'miles', amount: 1 } }],
      ['scroll', { target: { to: 'line' } }],
      ['set_selection', { from: 1.5, to: 2 }],
      ['set_selection', { from: -1, to: 2 }],
      ['replace_selection', { text: 'x' }],
      ['insert_text', { revision: 'r' }],
      ['replace_range', { revision: 'r', from: 0, to: 1 }],
      ['apply_format', { revision: 'r', op: 'sparkle' }],
      ['save', ['not', 'an', 'object']],
    ];
    for (const [name, args] of bad) {
      const result = await callTool(token, name, args);
      expect(result.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
      expect(errorOf(result).code, `${name} ${JSON.stringify(args)}`).toBe('invalid_params');
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(tab.received()).toBe(0);
    tab.socket.close();
    await once(tab.socket, 'close');
  });
});
