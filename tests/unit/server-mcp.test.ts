import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { createMockAuthProvider } from '../../server/providers/mock/auth';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import type { StorageProvider } from '../../server/providers/types';
import { AGENT_TOKEN_SCOPE_ERROR, AGENT_TOKEN_UNAUTHORIZED_ERROR, mintAgentToken } from '../../server/agentTokens';
import { MCP_TOOLS } from '../../server/mcp';
import { uploadWorkspaceFile } from '../../server/workspaceFiles';
import { UPLOAD_MAX_BYTES } from '../../src/lib/fileTransfer';
import { createMemoryStorage } from './storage-contract';

// PRD 027 Reqs 5+6 (issue #365): the stateless streamable-HTTP MCP endpoint,
// driven in-process through createApp against the in-memory storage seam —
// raw JSON-RPC over fetch, exactly what `claude mcp add --transport http`
// sends. The same behaviour runs against the real local server in
// tests/e2e/hosted.spec.ts (E650+).

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

/** `{error: {code, message, path?, etag?, content?}}` — the tool-error text, parsed. */
interface ToolErrorBody {
  error: { code: string; message: string; path?: string; etag?: string; content?: string };
}

describe('PRD 027 Reqs 5+6 (issue #365) MCP endpoint', () => {
  const { provider, blobs } = createMemoryStorage();
  // Every storage read/list is counted so the flag-off proof can show the
  // route answered before touching storage at all.
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
    readBytes: (path) => {
      reads += 1;
      return provider.readBytes(path);
    },
  };
  const auth = createMockAuthProvider();
  let onServer: Server;
  let offServer: Server;
  let on = '';
  let off = '';
  let session = '';

  beforeAll(async () => {
    const providers = { auth, storage: counted, directory: createMockDirectoryProvider() };
    onServer = createServer(createApp('/nonexistent-static', providers, 'local', undefined, undefined, true));
    offServer = createServer(createApp('/nonexistent-static', providers, 'local'));
    await new Promise<void>((resolve) => onServer.listen(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => offServer.listen(0, '127.0.0.1', resolve));
    on = `http://127.0.0.1:${(onServer.address() as AddressInfo).port}`;
    off = `http://127.0.0.1:${(offServer.address() as AddressInfo).port}`;
    const result = await auth.signIn({ username: 'ada' });
    if (result?.kind !== 'token') throw new Error('mock sign-in failed');
    session = result.token;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => onServer.close(() => resolve()));
    await new Promise<void>((resolve) => offServer.close(() => resolve()));
  });

  /** The user's ordinary session API — how the tests create workspaces and cross-check storage. */
  const api = (method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(`${on}${path}`, { method, headers: { Authorization: `Bearer ${session}`, ...headers }, body });

  async function createWorkspace(name: string): Promise<string> {
    const res = await api('POST', '/api/workspaces', JSON.stringify({ name }));
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  /** A workspace with a freshly minted agent token. */
  async function bridgeWorkspace(name: string): Promise<{ id: string; token: string }> {
    const id = await createWorkspace(name);
    const { token } = await mintAgentToken(provider, id, 'test');
    return { id, token };
  }

  let nextId = 1;
  /** One raw JSON-RPC request to /api/mcp — the streamable-HTTP stateless shape. */
  const rpc = (token: string | null, method: string, params?: unknown, id: number | string | null = nextId++, base = on) =>
    fetch(`${base}/api/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params === undefined ? {} : { params }) }),
    });

  /** tools/call, asserting the transport shape: HTTP 200, JSON, a result (never a protocol error). */
  async function callTool(token: string, name: string, args?: unknown): Promise<ToolResult> {
    const res = await rpc(token, 'tools/call', { name, ...(args === undefined ? {} : { arguments: args }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    const body = (await res.json()) as RpcBody;
    expect(body.jsonrpc).toBe('2.0');
    expect(body.error).toBeUndefined();
    const result = body.result as unknown as ToolResult;
    // The text and the structured content are the same JSON.
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    return result;
  }

  /** A successful tool call's payload. */
  async function toolOk<T>(token: string, name: string, args?: unknown): Promise<T> {
    const result = await callTool(token, name, args);
    expect(result.isError).toBeUndefined();
    return result.structuredContent as T;
  }

  /** A failed tool call's `{error}` — always `isError: true` on a 200, never a 500. */
  async function toolErr(token: string, name: string, args?: unknown): Promise<ToolErrorBody['error']> {
    const result = await callTool(token, name, args);
    expect(result.isError).toBe(true);
    return (result.structuredContent as unknown as ToolErrorBody).error;
  }

  it('U1407: with the flag off, every method on /api/mcp is the ordinary 404 and storage is never touched', async () => {
    const { token } = await bridgeWorkspace('Off');
    reads = 0;
    for (const method of ['POST', 'GET', 'DELETE']) {
      const res = await fetch(`${off}/api/mcp`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) : undefined,
      });
      expect(res.status, method).toBe(404);
      expect(await res.json()).toEqual({ error: 'no such endpoint' });
    }
    // No token lookup, no manifest read, nothing: the 404 came before any bridge code.
    expect(reads).toBe(0);
  });

  it('U1408: flag on — a missing header, a garbage token, a user session token and a revoked token each answer 401 with the stable code and WWW-Authenticate: Bearer', async () => {
    const { id, token } = await bridgeWorkspace('Auth');
    const expect401 = async (res: Response, label: string): Promise<void> => {
      expect(res.status, label).toBe(401);
      expect(res.headers.get('www-authenticate'), label).toBe('Bearer');
      expect(await res.json(), label).toEqual({ error: AGENT_TOKEN_UNAUTHORIZED_ERROR });
    };
    await expect401(await rpc(null, 'initialize', { protocolVersion: '2025-06-18' }), 'no header');
    await expect401(await rpc('mmat_nope_' + 'f'.repeat(64), 'tools/list'), 'unknown token');
    await expect401(await rpc('garbage', 'tools/list'), 'malformed token');
    // PRD 027 Req 4: ONE auth path — a signed-in user's session token is not
    // an agent token and buys nothing here.
    await expect401(await rpc(session, 'tools/list'), 'session token');
    // The real token works…
    expect((await rpc(token, 'ping')).status).toBe(200);
    // …until revoked through the route, when the very next request is refused.
    const rows = (await (await api('GET', `/api/workspaces/${id}/agent-tokens`)).json()) as { id: string }[];
    expect(rows).toHaveLength(1);
    expect((await api('DELETE', `/api/workspaces/${id}/agent-tokens/${rows[0].id}`)).status).toBe(204);
    await expect401(await rpc(token, 'tools/call', { name: 'list_files' }), 'revoked token');
  });

  it('U1409: GET and DELETE on /api/mcp answer 405 with Allow: POST — there is no stream and no session to end', async () => {
    const { token } = await bridgeWorkspace('Methods');
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(`${on}/api/mcp`, { method, headers: { Authorization: `Bearer ${token}` } });
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow'), method).toBe('POST');
    }
  });

  it('U1410: the protocol methods — initialize echoes a supported version (else the latest), initialized is 202 empty, ping is {}, unknown is -32601, non-JSON is -32700, a session id header is tolerated', async () => {
    const { token } = await bridgeWorkspace('Protocol');
    const init = await rpc(token, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });
    expect(init.status).toBe(200);
    expect(init.headers.get('content-type')).toMatch(/^application\/json/);
    const initBody = (await init.json()) as RpcBody;
    expect(initBody.result).toMatchObject({
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'marky-mark' },
    });
    expect(typeof (initBody.result as { serverInfo: { version: string } }).serverInfo.version).toBe('string');
    // An unsupported revision gets the server's latest.
    const future = (await (await rpc(token, 'initialize', { protocolVersion: '2099-01-01' })).json()) as RpcBody;
    expect(future.result?.protocolVersion).toBe('2025-06-18');
    // The initialized notification has no id: accepted, no body.
    const notified = await rpc(token, 'notifications/initialized', undefined, null);
    expect(notified.status).toBe(202);
    expect(await notified.text()).toBe('');
    // ping
    const ping = (await (await rpc(token, 'ping', undefined, 'p-1')).json()) as RpcBody;
    expect(ping).toEqual({ jsonrpc: '2.0', id: 'p-1', result: {} });
    // Unknown method: a JSON-RPC error, not a 500 and not a 404.
    const unknown = await rpc(token, 'resources/list');
    expect(unknown.status).toBe(200);
    expect(((await unknown.json()) as RpcBody).error?.code).toBe(-32601);
    // A body that is not JSON: parse error.
    const garbage = await fetch(`${on}/api/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(garbage.status).toBe(400);
    expect(((await garbage.json()) as RpcBody).error?.code).toBe(-32700);
    // Stateless: a client that sends a session id is simply served.
    const withSession = await fetch(`${on}/api/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Mcp-Session-Id': 'abc' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' }),
    });
    expect(withSession.status).toBe(200);
  });

  it('U1411: tools/list is the five file tools first, each a closed object schema with a required list, and no schema mentions a workspace', async () => {
    const { token } = await bridgeWorkspace('Tools');
    const body = (await (await rpc(token, 'tools/list')).json()) as RpcBody;
    const tools = (body.result as { tools: { name: string; description: string; inputSchema: Record<string, unknown> }[] }).tools;
    // Issue #367 mounted the nine session tools after the five (U1427 pins
    // the full fourteen); the file tools' order and shape are unchanged.
    expect(tools.slice(0, 5).map((t) => t.name)).toEqual(['get_workspace', 'list_files', 'read_file', 'create_file', 'write_file']);
    expect(tools).toEqual(MCP_TOOLS);
    for (const tool of tools) {
      expect(tool.description.length, tool.name).toBeGreaterThan(0);
      expect(tool.inputSchema.type, tool.name).toBe('object');
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
      expect(Array.isArray(tool.inputSchema.required), tool.name).toBe(true);
      // PRD 027 Req 5: the token identifies the workspace — no tool takes one.
      expect(JSON.stringify(tool.inputSchema).toLowerCase(), tool.name).not.toContain('workspace');
    }
  });

  it('U1412: get_workspace answers the manifest\'s id, name, created and modified; a deleted workspace is a not_found tool error', async () => {
    const { id, token } = await bridgeWorkspace('Meta');
    const manifest = ((await (await api('GET', `/api/workspaces/${id}/manifest`)).json()) as { manifest: { created: string; modified: string } }).manifest;
    expect(await toolOk(token, 'get_workspace')).toEqual({ id, name: 'Meta', created: manifest.created, modified: manifest.modified });
    // Only the manifest goes (the token record stays, so auth still passes).
    blobs.delete(`workspaces/${id}/manifest.json`);
    const err = await toolErr(token, 'get_workspace', {});
    expect(err.code).toBe('not_found');
  });

  it('U1413: create → list → read → write round trip, each answer identical to the /files route\'s, and the written text is readable through the user\'s session', async () => {
    const { id, token } = await bridgeWorkspace('Round trip');
    const created = await toolOk<{ path: string; etag: string; size: number }>(token, 'create_file', {
      path: 'notes/todo.md',
      content: '# Todo\n',
    });
    expect(created).toEqual({ path: 'notes/todo.md', etag: expect.any(String), size: 7 });

    const listed = await toolOk<{ files: unknown[] }>(token, 'list_files');
    const viaRoute = await (await api('GET', `/api/workspaces/${id}/files`)).json();
    expect(listed.files).toEqual(viaRoute);
    expect(listed.files).toEqual([{ path: 'notes/todo.md', size: 7, lastModified: expect.any(String), etag: expect.any(String) }]);

    const read = await toolOk<{ path: string; content: string; etag: string }>(token, 'read_file', { path: 'notes/todo.md' });
    expect(read).toEqual(await (await api('GET', `/api/workspaces/${id}/files/notes/todo.md`)).json());
    expect(read).toEqual({ path: 'notes/todo.md', content: '# Todo\n', etag: created.etag });

    const written = await toolOk<{ path: string; etag: string; merged?: boolean }>(token, 'write_file', {
      path: 'notes/todo.md',
      content: '# Todo\n- one\n',
      etag: read.etag,
    });
    expect(written).toEqual({ path: 'notes/todo.md', etag: expect.any(String) });
    expect(written.etag).not.toBe(read.etag);
    // One storage path: the user's ordinary route sees exactly what the agent wrote.
    expect(await (await api('GET', `/api/workspaces/${id}/files/notes/todo.md`)).json()).toEqual({
      path: 'notes/todo.md',
      content: '# Todo\n- one\n',
      etag: written.etag,
    });
    // Absent path: not_found (never a 500 or a protocol error).
    expect((await toolErr(token, 'read_file', { path: 'nope.md' })).code).toBe('not_found');
  });

  it('U1414: create_file on an existing path is already_exists and stores nothing; write_file on an absent path is not_found naming create_file', async () => {
    const { id, token } = await bridgeWorkspace('Exists');
    await toolOk(token, 'create_file', { path: 'a.md', content: 'first' });
    const clash = await toolErr(token, 'create_file', { path: 'a.md', content: 'second' });
    expect(clash.code).toBe('already_exists');
    expect(clash.path).toBe('a.md');
    expect(blobs.get(`workspaces/${id}/files/a.md`)).toBe('first');
    // The binary form refuses an existing path the same way (the upload route's 409).
    const clashBytes = await toolErr(token, 'create_file', { path: 'a.md', contentBase64: 'Zmlyc3Q=' });
    expect(clashBytes.code).toBe('already_exists');
    expect(blobs.get(`workspaces/${id}/files/a.md`)).toBe('first');

    const missing = await toolErr(token, 'write_file', { path: 'b.md', content: 'x', etag: 'e0' });
    expect(missing.code).toBe('not_found');
    expect(missing.message).toContain('create_file');
    expect(blobs.has(`workspaces/${id}/files/b.md`)).toBe(false);
  });

  it('U1415: create_file with contentBase64 stores the decoded bytes under contentTypeFor\'s media type; a disallowed extension is unsupported_type, an oversize payload too_large, and bad base64 invalid_params', async () => {
    const { id, token } = await bridgeWorkspace('Binary');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const created = await toolOk<{ path: string; etag: string; size: number }>(token, 'create_file', {
      path: 'img/pic.png',
      contentBase64: Buffer.from(png).toString('base64'),
    });
    expect(created).toEqual({ path: 'img/pic.png', etag: expect.any(String), size: png.length });
    // The raw route serves the same bytes with the extension-derived type — the upload route's own behaviour.
    const raw = await api('GET', `/api/workspaces/${id}/files/img/pic.png?raw=1`);
    expect(raw.status).toBe(200);
    expect(raw.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await raw.arrayBuffer())).toEqual(png);

    const exe = await toolErr(token, 'create_file', { path: 'payload.exe', contentBase64: 'TVo=' });
    expect(exe.code).toBe('unsupported_type');
    expect(exe.message).toMatch(/\.exe/);
    expect(blobs.has(`workspaces/${id}/files/payload.exe`)).toBe(false);

    const bad = await toolErr(token, 'create_file', { path: 'x.png', contentBase64: 'not base64!' });
    expect(bad.code).toBe('invalid_params');
    expect(blobs.has(`workspaces/${id}/files/x.png`)).toBe(false);

    // Oversize: the decoded size is what the upload rule judges. A 20 MB
    // payload is ~27 MB as base64 — past the transport's 25 MB body guard —
    // so the too_large refusal is proven on the shared upload function the
    // tool calls, with the same message the route answers 413 with.
    const huge = await uploadWorkspaceFile(provider, id, 'big.md', new Uint8Array(UPLOAD_MAX_BYTES + 1));
    expect(huge).toEqual({ ok: false, reason: 'too_large', error: expect.stringMatching(/20 MB/) });
    expect(blobs.has(`workspaces/${id}/files/big.md`)).toBe(false);
  });

  it('U1416: write_file with a stale etag and no base is conflict with the stored content untouched (and the head to retry from); with a base it merges and stores the merged text', async () => {
    const { id, token } = await bridgeWorkspace('Stale');
    const created = await toolOk<{ etag: string }>(token, 'create_file', { path: 'notes.md', content: 'alpha\nbeta\ngamma\n' });
    // Someone else saves first through the ordinary route (a different line).
    const other = await api('PUT', `/api/workspaces/${id}/files/notes.md`, 'alpha\nbeta\nGAMMA\n', { 'If-Match': created.etag });
    expect(other.status).toBe(200);
    const theirs = ((await other.json()) as { etag: string }).etag;

    const conflict = await toolErr(token, 'write_file', { path: 'notes.md', content: 'ALPHA\nbeta\ngamma\n', etag: created.etag });
    expect(conflict.code).toBe('conflict');
    expect(conflict.message).toBe('the file changed on the server since it was loaded');
    expect(conflict.path).toBe('notes.md');
    expect(conflict.etag).toBe(theirs);
    expect(conflict.content).toBe('alpha\nbeta\nGAMMA\n');
    expect(blobs.get(`workspaces/${id}/files/notes.md`)).toBe('alpha\nbeta\nGAMMA\n');

    // PRD 016 Req 8 through the same function the route uses: with the base, a clean merge lands.
    const merged = await toolOk<{ path: string; etag: string; merged: boolean; content: string }>(token, 'write_file', {
      path: 'notes.md',
      content: 'ALPHA\nbeta\ngamma\n',
      etag: created.etag,
      base: 'alpha\nbeta\ngamma\n',
    });
    expect(merged).toEqual({ path: 'notes.md', etag: expect.any(String), merged: true, content: 'ALPHA\nbeta\nGAMMA\n' });
    expect(blobs.get(`workspaces/${id}/files/notes.md`)).toBe('ALPHA\nbeta\nGAMMA\n');
    expect(await (await api('GET', `/api/workspaces/${id}/files/notes.md`)).json()).toMatchObject({ etag: merged.etag });

    // A conflicting merge (same line edited both ways) is the same conflict, untouched.
    const clash = await toolErr(token, 'write_file', { path: 'notes.md', content: 'ALPHA\nbeta\nomega\n', etag: created.etag, base: 'alpha\nbeta\ngamma\n' });
    expect(clash.code).toBe('conflict');
    expect(blobs.get(`workspaces/${id}/files/notes.md`)).toBe('ALPHA\nbeta\nGAMMA\n');
  });

  it('U1417: a `..` path is agent_token_out_of_scope, an invalid path is invalid_path, malformed params are invalid_params, an unknown tool is -32602 — and every tool error is a 200 result with isError, never a 500', async () => {
    const { id, token } = await bridgeWorkspace('Scope');
    await toolOk(token, 'create_file', { path: 'ok.md', content: 'x' });
    const escape = await toolErr(token, 'read_file', { path: '../manifest.json' });
    expect(escape.code).toBe(AGENT_TOKEN_SCOPE_ERROR.code);
    expect(escape.message).toBe(AGENT_TOKEN_SCOPE_ERROR.message);
    // The same refusal on every path-taking tool.
    expect((await toolErr(token, 'create_file', { path: '../../other/files/x.md', content: 'x' })).code).toBe(AGENT_TOKEN_SCOPE_ERROR.code);
    expect((await toolErr(token, 'write_file', { path: 'a/../../manifest.json', content: 'x', etag: 'e' })).code).toBe(AGENT_TOKEN_SCOPE_ERROR.code);
    expect(blobs.get(`workspaces/${id}/manifest.json`)).toMatch(/"name"/);

    expect((await toolErr(token, 'read_file', { path: 'a//b.md' })).code).toBe('invalid_path');
    expect((await toolErr(token, 'read_file', { path: './b.md' })).code).toBe('invalid_path');

    // Params: missing required, wrong type, unknown property, both/neither content forms.
    expect((await toolErr(token, 'read_file', {})).code).toBe('invalid_params');
    expect((await toolErr(token, 'read_file')).code).toBe('invalid_params');
    expect((await toolErr(token, 'read_file', { path: 42 })).code).toBe('invalid_params');
    expect((await toolErr(token, 'read_file', { path: 'ok.md', workspace: id })).code).toBe('invalid_params');
    expect((await toolErr(token, 'create_file', { path: 'n.md' })).code).toBe('invalid_params');
    expect((await toolErr(token, 'create_file', { path: 'n.md', content: 'a', contentBase64: 'YQ==' })).code).toBe('invalid_params');
    expect((await toolErr(token, 'write_file', { path: 'ok.md', content: 'a' })).code).toBe('invalid_params');
    expect(blobs.has(`workspaces/${id}/files/n.md`)).toBe(false);

    // An unknown tool name is the one params refusal at the protocol level.
    const unknown = await rpc(token, 'tools/call', { name: 'delete_file', arguments: { path: 'ok.md' } });
    expect(unknown.status).toBe(200);
    expect(((await unknown.json()) as RpcBody).error?.code).toBe(-32602);
    const noName = await rpc(token, 'tools/call', {});
    expect(((await noName.json()) as RpcBody).error?.code).toBe(-32602);
    expect(blobs.get(`workspaces/${id}/files/ok.md`)).toBe('x');
  });
});
