import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { createMockAuthProvider } from '../../server/providers/mock/auth';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import { summaryCacheBlobPath, summaryCachePrefix } from '../../server/summaryCache';
import type { SummaryCacheEntry } from '../../src/lib/summaryCacheStore';
import { createMemoryStorage } from './storage-contract';

// PRD 011 Req 28+29+30: the hosted summary cache at the HTTP layer — createApp
// on a loopback port with the mock auth provider and an in-memory storage
// seam, the shape tests/unit/server-workspaces.test.ts established. No
// provider is contacted, no LLM call is made and nothing here leaves the host:
// this issue ships a store with no producer.

describe('PRD 011 Req 29 — the workspace-scoped summary cache', () => {
  const { provider: storage, blobs } = createMemoryStorage();
  const auth = createMockAuthProvider();
  let server: Server;
  let base = '';
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    server = createServer(
      createApp(
        '/nonexistent-static',
        { auth, storage, directory: createMockDirectoryProvider() },
        'local',
      ),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const username of ['ada', 'grace', 'alan']) {
      const result = await auth.signIn({ username });
      if (result?.kind !== 'token') throw new Error('mock sign-in failed');
      tokens[username] = result.token;
    }
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const call = (user: string | null, method: string, path: string, body?: string): Promise<Response> =>
    fetch(`${base}${path}`, {
      method,
      headers: user ? { Authorization: `Bearer ${tokens[user]}` } : {},
      body,
    });

  async function createWorkspace(user: string, name: string): Promise<string> {
    const res = await call(user, 'POST', '/api/workspaces', JSON.stringify({ name }));
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  const addMember = (id: string, user: string, role: string) =>
    call('ada', 'POST', `/api/workspaces/${id}/members`, JSON.stringify({ id: user, role }));

  const entry = (key: string, summary: string) => ({
    key,
    summary,
    providerId: 'fake',
    modelId: 'fake-small',
    promptVersion: 'p1',
  });

  const put = (user: string, id: string, key: string, summary: string) =>
    call(user, 'PUT', `/api/workspaces/${id}/summary-cache/entry`, JSON.stringify(entry(key, summary)));

  const get = async (user: string, id: string, key: string): Promise<SummaryCacheEntry | null> => {
    const res = await call(user, 'GET', `/api/workspaces/${id}/summary-cache/entry?key=${encodeURIComponent(key)}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { entry: SummaryCacheEntry | null }).entry;
  };

  const KEY = 'mmz1:p1:fake:fake-small:l3:0123456789abcdef';

  it('U550: a summary written by one member is read by another, and a second workspace cannot see it', async () => {
    const a = await createWorkspace('ada', 'Alpha');
    const b = await createWorkspace('grace', 'Beta');
    await addMember(a, 'mock-grace', 'Viewer');

    expect((await put('ada', a, KEY, 'the shared summary')).status).toBe(200);

    // Req 29's whole point: members reuse each other's summaries.
    const shared = await get('grace', a, KEY);
    expect(shared?.summary).toBe('the shared summary');
    expect(shared?.providerId).toBe('fake');
    expect(shared?.promptVersion).toBe('p1');
    // The server stamps the time, so an entry read back is orderable.
    expect(shared?.at).toBeGreaterThan(0);

    // The SAME key under another workspace is a miss — the cache is scoped,
    // and one workspace's summaries are never served to another's members.
    expect(await get('grace', b, KEY)).toBeNull();
    await put('grace', b, KEY, 'beta’s own summary');
    expect((await get('ada', a, KEY))?.summary).toBe('the shared summary');
  });

  it('U551: cache blobs live under workspaces/<id>/summary-cache/, never in files/, never listed and never reachable through /api/files/', async () => {
    const id = await createWorkspace('ada', 'Layout');
    await call('ada', 'PUT', `/api/workspaces/${id}/files/doc.md`, '# doc\n');
    await put('ada', id, KEY, 'a summary');

    const cachePath = summaryCacheBlobPath(id, KEY);
    expect([...blobs.keys()]).toContain(cachePath);
    expect(cachePath.startsWith(summaryCachePrefix(id))).toBe(true);
    // Outside `files/` — the manifest's precedent, and the reason the
    // blob is never a document.
    expect(cachePath.startsWith(`workspaces/${id}/files/`)).toBe(false);
    // A key is not a path: it can name nothing outside its own prefix.
    expect(summaryCacheBlobPath(id, '../../escape')).toBe(`${summaryCachePrefix(id)}..%2F..%2Fescape.json`);

    // The file listing never surfaces it.
    const listing = await call('ada', 'GET', `/api/workspaces/${id}/files`);
    const files = (await listing.json()) as Array<{ path: string }>;
    expect(files.map((f) => f.path)).toEqual(['doc.md']);

    // And the legacy scaffold refuses the path outright — asserted, not
    // assumed (RESERVED_PREFIXES in server/app.ts).
    const scaffold = await call('ada', 'GET', `/api/files/${cachePath}`);
    expect(scaffold.status).toBe(403);
    expect((await scaffold.json()) as { error: string }).toEqual({
      error: 'reserved data is served by /api/workspaces and /api/me/files',
    });
  });

  it('U553: unauthenticated is 401 and a non-member is 403 naming the verb the route wanted', async () => {
    const id = await createWorkspace('ada', 'Guarded');
    for (const [method, path] of [
      ['GET', 'summary-cache'],
      ['DELETE', 'summary-cache'],
      ['GET', 'summary-cache/entry'],
      ['PUT', 'summary-cache/entry'],
    ] as const) {
      const anon = await call(null, method, `/api/workspaces/${id}/${path}`, method === 'GET' ? undefined : '{}');
      expect(anon.status, `${method} ${path}`).toBe(401);
    }

    // Alan is signed in and a member of nothing: the reads want doc.read, and
    // Clear — which discards every member's summaries — wants the workspace
    // authority. Both verbs are the existing catalog's.
    const reads = await call('alan', 'GET', `/api/workspaces/${id}/summary-cache`);
    expect(reads.status).toBe(403);
    expect((await reads.json()) as { required: string }).toMatchObject({ required: 'doc.read' });
    const cleared = await call('alan', 'DELETE', `/api/workspaces/${id}/summary-cache`);
    expect(cleared.status).toBe(403);
    expect((await cleared.json()) as { required: string }).toMatchObject({ required: 'workspace.settings' });
  });

  it('U554: size reports what the workspace holds, Clear empties it, and deleting the workspace takes it with it', async () => {
    const id = await createWorkspace('ada', 'Sized');
    const empty = await call('ada', 'GET', `/api/workspaces/${id}/summary-cache`);
    expect(await empty.json()).toEqual({ bytes: 0, entries: 0 });

    await put('ada', id, `${KEY}:a`, 'one');
    await put('ada', id, `${KEY}:b`, 'two');
    const filled = (await (await call('ada', 'GET', `/api/workspaces/${id}/summary-cache`)).json()) as {
      bytes: number;
      entries: number;
    };
    expect(filled.entries).toBe(2);
    expect(filled.bytes).toBeGreaterThan(0);

    const cleared = await call('ada', 'DELETE', `/api/workspaces/${id}/summary-cache`);
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ cleared: 2 });
    expect(await get('ada', id, `${KEY}:a`)).toBeNull();
    expect([...blobs.keys()].some((p) => p.startsWith(summaryCachePrefix(id)))).toBe(false);

    // And a deleted workspace leaves no cache behind.
    await put('ada', id, KEY, 'about to go');
    expect((await call('ada', 'DELETE', `/api/workspaces/${id}`)).status).toBe(200);
    expect([...blobs.keys()].some((p) => p.startsWith(`workspaces/${id}/`))).toBe(false);
  });

  it('U555: an unknown key is a miss, a corrupt blob is a miss, and a malformed write is a named 400', async () => {
    const id = await createWorkspace('ada', 'Tolerant');
    expect(await get('ada', id, 'nothing-wrote-this')).toBeNull();

    // A blob that is not an entry any more reads as a miss, never a 500.
    await storage.write(summaryCacheBlobPath(id, KEY), '{"key":"k1","summ');
    expect(await get('ada', id, KEY)).toBeNull();
    await storage.write(summaryCacheBlobPath(id, KEY), '{"key":"k1","summary":42}');
    expect(await get('ada', id, KEY)).toBeNull();

    // A key the client did not send is a 400, not a blob named 'undefined'.
    const noKey = await call('ada', 'GET', `/api/workspaces/${id}/summary-cache/entry`);
    expect(noKey.status).toBe(400);
    const bad = await call('ada', 'PUT', `/api/workspaces/${id}/summary-cache/entry`, JSON.stringify({ key: KEY }));
    expect(bad.status).toBe(400);
    expect((await bad.json()) as { error: string }).toEqual({ error: 'cache entry summary must be a string' });
    expect([...blobs.keys()].filter((p) => p.startsWith(summaryCachePrefix(id)))).toEqual([
      summaryCacheBlobPath(id, KEY),
    ]);
  });
});
