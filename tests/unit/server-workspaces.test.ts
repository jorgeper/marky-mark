import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { createMockAuthProvider } from '../../server/providers/mock/auth';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import { PERMISSIONS, type WorkspaceManifest } from '../../src/lib/hostedWorkspace';
import { WORKSPACE_ROUTE_PERMISSIONS } from '../../server/workspaces';
import { createMemoryStorage, describeStorageContract } from './storage-contract';

// PRD 007 Req 7+13: the workspace API's blob layout and permission
// enforcement, proven offline at the HTTP layer — createApp wired to an
// in-memory storage seam and the mock auth provider, no network beyond
// the OS loopback and no Azure anything. The same behaviour runs against
// real Azurite blobs in tests/e2e/hosted.spec.ts (E172+).

describe('PRD 007 Req 7+13 workspace API over HTTP', () => {
  const { provider, blobs } = createMemoryStorage();
  const auth = createMockAuthProvider();
  let server: Server;
  let base = '';
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    server = createServer(
      createApp('/nonexistent-static', { auth, storage: provider, directory: createMockDirectoryProvider() }, 'local'),
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

  const call = (
    user: string,
    method: string,
    path: string,
    body?: string,
  ): Promise<Response> =>
    fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${tokens[user]}` }, body });

  /** Create a workspace as `user` and return its id. */
  async function createWorkspace(user: string, name: string): Promise<string> {
    const res = await call(user, 'POST', '/api/workspaces', JSON.stringify({ name }));
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  it('U263: creating a workspace writes its manifest under its own prefix, creator as Owner', async () => {
    const id = await createWorkspace('ada', 'Layout proof');
    // Blob layout (Req 7): the manifest is at workspaces/<id>/manifest.json —
    // a per-workspace prefix in the container; nothing else is written.
    expect([...blobs.keys()].sort()).toEqual([`workspaces/${id}/manifest.json`]);
    const read = await call('ada', 'GET', `/api/workspaces/${id}/manifest`);
    expect(read.status).toBe(200);
    const { manifest } = (await read.json()) as { manifest: WorkspaceManifest };
    expect(manifest.name).toBe('Layout proof');
    // Issue #180: the creator's display name is snapshotted at add time —
    // the fallback member lists render when the directory cannot answer.
    expect(manifest.members).toEqual([{ id: 'mock-ada', role: 'Owner', displayName: 'Ada Lovelace' }]);
    expect(manifest.everyone).toEqual({ enabled: false, role: 'Viewer' });
    blobs.clear();
  });

  it('U264: each file endpoint answers 403 naming its one required permission when the caller lacks it', async () => {
    const id = await createWorkspace('ada', 'Perms');
    // Ada (Owner) writes a file and grants Grace Viewer.
    expect((await call('ada', 'PUT', `/api/workspaces/${id}/files/notes/a.md`, '# hi')).status).toBe(200);
    const { manifest } = (await (await call('ada', 'GET', `/api/workspaces/${id}/manifest`)).json()) as {
      manifest: WorkspaceManifest;
    };
    manifest.members.push({ id: 'mock-grace', role: 'Viewer' });
    expect(
      (await call('ada', 'PUT', `/api/workspaces/${id}/manifest`, JSON.stringify(manifest))).status,
    ).toBe(200);

    // Viewer: doc.read suffices to list and read…
    expect((await call('grace', 'GET', `/api/workspaces/${id}/files`)).status).toBe(200);
    expect((await call('grace', 'GET', `/api/workspaces/${id}/files/notes/a.md`)).status).toBe(200);
    // …but writing needs doc.edit, deleting file.delete, manifest updates
    // workspace.settings — each 403 names the missing verb.
    for (const [method, path, required] of [
      ['PUT', `/api/workspaces/${id}/files/notes/a.md`, 'doc.edit'],
      ['DELETE', `/api/workspaces/${id}/files/notes/a.md`, 'file.delete'],
      ['PUT', `/api/workspaces/${id}/manifest`, 'workspace.settings'],
    ] as const) {
      const res = await call('grace', method, path, '{}');
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(((await res.json()) as { required: string }).required).toBe(required);
    }
    // A non-member without everyone-access gets 403 even for reads.
    expect((await call('alan', 'GET', `/api/workspaces/${id}/files/notes/a.md`)).status).toBe(403);
    expect((await call('alan', 'GET', `/api/workspaces/${id}/manifest`)).status).toBe(403);
    blobs.clear();
  });

  it('U265: everyone-access grants its default role to non-members; explicit membership still overrides', async () => {
    const id = await createWorkspace('ada', 'Open house');
    await call('ada', 'PUT', `/api/workspaces/${id}/files/doc.md`, 'shared');
    const { manifest } = (await (await call('ada', 'GET', `/api/workspaces/${id}/manifest`)).json()) as {
      manifest: WorkspaceManifest;
    };
    manifest.everyone = { enabled: true, role: 'Editor' };
    manifest.members.push({ id: 'mock-grace', role: 'Viewer' });
    await call('ada', 'PUT', `/api/workspaces/${id}/manifest`, JSON.stringify(manifest));
    // Alan (non-member) gets the everyone Editor role: read AND write.
    expect((await call('alan', 'GET', `/api/workspaces/${id}/files/doc.md`)).status).toBe(200);
    expect((await call('alan', 'PUT', `/api/workspaces/${id}/files/doc.md`, 'x')).status).toBe(200);
    // Grace is explicitly a Viewer: the everyone Editor role does NOT apply.
    expect((await call('grace', 'PUT', `/api/workspaces/${id}/files/doc.md`, 'x')).status).toBe(403);
    blobs.clear();
  });

  it('U266: manifest updates validate — built-in shadowing and version drift are 400s, created is immutable', async () => {
    const id = await createWorkspace('ada', 'Guarded');
    const { manifest } = (await (await call('ada', 'GET', `/api/workspaces/${id}/manifest`)).json()) as {
      manifest: WorkspaceManifest;
    };
    const shadow = { ...manifest, roles: [{ name: 'Owner', permissions: [] }] };
    const shadowRes = await call('ada', 'PUT', `/api/workspaces/${id}/manifest`, JSON.stringify(shadow));
    expect(shadowRes.status).toBe(400);
    expect(((await shadowRes.json()) as { error: string }).error).toContain('shadows a built-in');
    expect((await call('ada', 'PUT', `/api/workspaces/${id}/manifest`, JSON.stringify({ ...manifest, version: 9 }))).status).toBe(400);
    // A legal update keeps created and restamps modified server-side.
    const renamed = await call(
      'ada',
      'PUT',
      `/api/workspaces/${id}/manifest`,
      JSON.stringify({ ...manifest, name: 'Renamed', created: '1999-01-01T00:00:00.000Z' }),
    );
    expect(renamed.status).toBe(200);
    const updated = ((await renamed.json()) as { manifest: WorkspaceManifest }).manifest;
    expect(updated.name).toBe('Renamed');
    expect(updated.created).toBe(manifest.created);
    blobs.clear();
  });

  it('U267: the legacy /api/files scaffold cannot see or touch the workspace prefix', async () => {
    const id = await createWorkspace('ada', 'Fenced');
    await call('ada', 'PUT', `/api/workspaces/${id}/files/secret.md`, 'fenced');
    // Reads, writes and deletes through the workspace-agnostic scaffold are
    // refused outright — no permission bypass.
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      const res = await call('grace', method, `/api/files/workspaces/${id}/manifest.json`);
      expect(res.status, method).toBe(403);
    }
    // And the listing filters the workspace root out entirely.
    await call('ada', 'PUT', '/api/files/plain.md', 'visible');
    const listed = (await (await call('grace', 'GET', '/api/files')).json()) as { path: string }[];
    expect(listed.map((f) => f.path)).toEqual(['plain.md']);
    blobs.clear();
  });

  it('U268: workspace file listings are workspace-relative and never include the manifest; unknown ids are 404', async () => {
    const id = await createWorkspace('ada', 'Listing');
    await call('ada', 'PUT', `/api/workspaces/${id}/files/notes/a.md`, 'a');
    const listed = (await (await call('ada', 'GET', `/api/workspaces/${id}/files`)).json()) as { path: string }[];
    expect(listed.map((f) => f.path)).toEqual(['notes/a.md']);
    expect((await call('ada', 'GET', '/api/workspaces/no-such-id/manifest')).status).toBe(404);
    // An empty id segment is malformed, not a lookup.
    expect((await call('ada', 'GET', '/api/workspaces//manifest')).status).toBe(400);
    // A dot-dot id must not escape the workspace root. fetch() normalizes
    // '..' away client-side, so send the raw wire shape a non-compliant
    // client could: server-side WHATWG URL parsing collapses it to a path
    // outside /api/workspaces (404 'no such endpoint') — never a blob read.
    const rawStatus = await new Promise<number>((resolve, reject) => {
      const { port } = server.address() as AddressInfo;
      httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/api/workspaces/../escape/manifest',
          headers: { Authorization: `Bearer ${tokens.ada}` },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      )
        .on('error', reject)
        .end();
    });
    expect(rawStatus).toBe(404);
    blobs.clear();
  });

  it('U834: raw workspace blobs round-trip bytes, are served with an extension-derived type, and stay permission-checked', async () => {
    // PRD 007 Req 8: pasted images are workspace blobs — bytes in, bytes out,
    // behind the same doc.edit / doc.read verbs as any other file.
    const id = await createWorkspace('ada', 'Images');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    const put = await fetch(`${base}/api/workspaces/${id}/files/images/pic.png?raw=1`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokens.ada}`, 'Content-Type': 'application/octet-stream' },
      body: png,
    });
    expect(put.status).toBe(200);

    const got = await call('ada', 'GET', `/api/workspaces/${id}/files/images/pic.png?raw=1`);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(png);
    // The uploader's Content-Type never decides how bytes come back: a file
    // named .html is a download, so a "pasted image" can never be same-origin
    // script.
    await fetch(`${base}/api/workspaces/${id}/files/evil.html?raw=1`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokens.ada}`, 'Content-Type': 'text/html' },
      body: new Uint8Array([0x3c]),
    });
    const evil = await call('ada', 'GET', `/api/workspaces/${id}/files/evil.html?raw=1`);
    expect(evil.headers.get('content-type')).toBe('application/octet-stream');
    // A non-member sees the same 403 the JSON view gives, and a missing blob 404s.
    expect((await call('grace', 'GET', `/api/workspaces/${id}/files/images/pic.png?raw=1`)).status).toBe(403);
    expect((await call('ada', 'GET', `/api/workspaces/${id}/files/images/none.png?raw=1`)).status).toBe(404);
    blobs.clear();
  });

  it('U835: an <img>-shaped GET authenticates with ?access_token=, but a write with one stays 401', async () => {
    // PRD 007 Req 8: an image element cannot send an Authorization header.
    // The query-string token is a GET-only concession — it must never mutate.
    const id = await createWorkspace('ada', 'Asset URLs');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await fetch(`${base}/api/workspaces/${id}/files/images/a.png?raw=1`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokens.ada}` },
      body: png,
    });
    const viaQuery = await fetch(
      `${base}/api/workspaces/${id}/files/images/a.png?raw=1&access_token=${encodeURIComponent(tokens.ada)}`,
    );
    expect(viaQuery.status).toBe(200);
    expect(new Uint8Array(await viaQuery.arrayBuffer())).toEqual(png);
    // No token at all is still 401, and a bad one too.
    expect((await fetch(`${base}/api/workspaces/${id}/files/images/a.png?raw=1`)).status).toBe(401);
    expect(
      (await fetch(`${base}/api/workspaces/${id}/files/images/a.png?raw=1&access_token=nonsense`)).status,
    ).toBe(401);
    // A PUT carrying the same token in the query is unauthenticated.
    const write = await fetch(
      `${base}/api/workspaces/${id}/files/images/a.png?raw=1&access_token=${encodeURIComponent(tokens.ada)}`,
      { method: 'PUT', body: png },
    );
    expect(write.status).toBe(401);
    blobs.clear();
  });

  it('U836: per-user blobs are scoped to the token, invisible to other users and to the /api/files scaffold', async () => {
    // PRD 007 Req 9: the roaming User settings layer. The prefix comes from
    // the validated token, so there is no URL by which one user names
    // another's blobs — and the workspace-agnostic scaffold cannot see them.
    expect((await call('ada', 'PUT', '/api/me/files/settings.json', '{"themeLight":"nord"}')).status).toBe(200);
    const mine = await call('ada', 'GET', '/api/me/files/settings.json');
    expect(mine.status).toBe(200);
    expect((await mine.json()) as { content: string }).toMatchObject({
      path: 'settings.json',
      content: '{"themeLight":"nord"}',
    });
    // It landed under the user's own prefix…
    expect([...blobs.keys()]).toEqual(['users/mock-ada/settings.json']);
    // …a different user has their own empty view of the same endpoint…
    expect((await call('grace', 'GET', '/api/me/files/settings.json')).status).toBe(404);
    expect(await (await call('grace', 'GET', '/api/me/files')).json()).toEqual([]);
    // …the listing is user-relative…
    const listed = (await (await call('ada', 'GET', '/api/me/files')).json()) as { path: string }[];
    expect(listed.map((f) => f.path)).toEqual(['settings.json']);
    // …and the scaffold can neither read nor list it.
    expect((await call('grace', 'GET', '/api/files/users/mock-ada/settings.json')).status).toBe(403);
    const scaffold = (await (await call('grace', 'GET', '/api/files')).json()) as { path: string }[];
    expect(scaffold).toEqual([]);
    // Deleting is scoped the same way.
    expect((await call('grace', 'DELETE', '/api/me/files/settings.json')).status).toBe(404);
    expect((await call('ada', 'DELETE', '/api/me/files/settings.json')).status).toBe(200);
    blobs.clear();
  });

  /** Grant `user` a role in `id` (the manifest PUT the members UI will drive). */
  async function grant(id: string, user: string, role: string): Promise<void> {
    const { manifest } = (await (await call('ada', 'GET', `/api/workspaces/${id}/manifest`)).json()) as {
      manifest: WorkspaceManifest;
    };
    manifest.members.push({ id: `mock-${user}`, role });
    expect((await call('ada', 'PUT', `/api/workspaces/${id}/manifest`, JSON.stringify(manifest))).status).toBe(200);
  }

  it('U843: move/rename routes each check exactly one verb, carry a folder\'s contents, and never clobber', async () => {
    // PRD 007 Req 18: file moves need file.rename, folder moves need
    // folder.manage — a Contributor holds neither, and the server refuses
    // whatever the UI showed.
    const id = await createWorkspace('ada', 'Moves');
    await grant(id, 'grace', 'Contributor');
    await call('ada', 'PUT', `/api/workspaces/${id}/files/a.md`, '# a');
    await call('ada', 'PUT', `/api/workspaces/${id}/files/notes/deep/b.md`, '# b');

    const forbidden = await call('grace', 'POST', `/api/workspaces/${id}/move-file`, JSON.stringify({ from: 'a.md', to: 'moved.md' }));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: 'forbidden', required: 'file.rename' });
    const forbiddenDir = await call('grace', 'POST', `/api/workspaces/${id}/move-folder`, JSON.stringify({ from: 'notes', to: 'archive' }));
    expect(forbiddenDir.status).toBe(403);
    expect(await forbiddenDir.json()).toEqual({ error: 'forbidden', required: 'folder.manage' });

    // The move itself: the blob moves, the old path is gone, bytes survive.
    expect((await call('ada', 'POST', `/api/workspaces/${id}/move-file`, JSON.stringify({ from: 'a.md', to: 'notes/a.md' }))).status).toBe(200);
    expect((await call('ada', 'GET', `/api/workspaces/${id}/files/a.md`)).status).toBe(404);
    expect(await (await call('ada', 'GET', `/api/workspaces/${id}/files/notes/a.md`)).json()).toMatchObject({ content: '# a' });

    // A directory move takes its whole subtree with it.
    expect((await call('ada', 'POST', `/api/workspaces/${id}/move-folder`, JSON.stringify({ from: 'notes', to: 'archive/notes' }))).status).toBe(200);
    expect(await (await call('ada', 'GET', `/api/workspaces/${id}/files/archive/notes/deep/b.md`)).json()).toMatchObject({ content: '# b' });
    expect((await call('ada', 'GET', `/api/workspaces/${id}/files/notes/a.md`)).status).toBe(404);

    // A move onto an occupied path is refused — the target is NOT destroyed.
    await call('ada', 'PUT', `/api/workspaces/${id}/files/keep.md`, '# keep');
    const clash = await call('ada', 'POST', `/api/workspaces/${id}/move-file`, JSON.stringify({ from: 'archive/notes/a.md', to: 'keep.md' }));
    expect(clash.status).toBe(409);
    expect(await (await call('ada', 'GET', `/api/workspaces/${id}/files/keep.md`)).json()).toMatchObject({ content: '# keep' });
    // An unknown source is a 404, and a folder into itself a 400.
    expect((await call('ada', 'POST', `/api/workspaces/${id}/move-file`, JSON.stringify({ from: 'nope.md', to: 'x.md' }))).status).toBe(404);
    expect((await call('ada', 'POST', `/api/workspaces/${id}/move-folder`, JSON.stringify({ from: 'archive', to: 'archive/inner' }))).status).toBe(400);
    blobs.clear();
  });

  it('U844: an empty folder survives as a placeholder blob, and deleting one needs folder.manage', async () => {
    // PRD 007 Req 18: blob storage has no directories — the marker blob is
    // what makes a new empty folder still be there on the next listing.
    const id = await createWorkspace('ada', 'Folders');
    await grant(id, 'grace', 'Contributor');
    expect((await call('grace', 'POST', `/api/workspaces/${id}/folders`, JSON.stringify({ path: 'ideas' }))).status).toBe(403);
    expect((await call('ada', 'POST', `/api/workspaces/${id}/folders`, JSON.stringify({ path: 'ideas' }))).status).toBe(201);
    expect(blobs.has(`workspaces/${id}/files/ideas/.mmkeep`)).toBe(true);
    const listed = (await (await call('ada', 'GET', `/api/workspaces/${id}/files`)).json()) as { path: string }[];
    expect(listed.map((f) => f.path)).toEqual(['ideas/.mmkeep']);

    // Deleting the folder takes everything under it, and only with the verb.
    await call('ada', 'PUT', `/api/workspaces/${id}/files/ideas/x.md`, '# x');
    expect((await call('grace', 'DELETE', `/api/workspaces/${id}/folders/ideas`)).status).toBe(403);
    expect((await call('ada', 'DELETE', `/api/workspaces/${id}/folders/ideas`)).status).toBe(200);
    expect((await call('ada', 'GET', `/api/workspaces/${id}/files/ideas/x.md`)).status).toBe(404);
    expect((await call('ada', 'DELETE', `/api/workspaces/${id}/folders/ideas`)).status).toBe(404);
    blobs.clear();
  });

  it('U845: upload and download check their own verb, and the server re-applies the size/type rule', async () => {
    // PRD 007 Req 19 + Req 17: the client's check is a courtesy; THIS is the
    // control — a hand-rolled request gets the same answer.
    const id = await createWorkspace('ada', 'Transfer');
    await grant(id, 'grace', 'Viewer');
    const upload = (user: string, name: string, body: string) =>
      call(user, 'PUT', `/api/workspaces/${id}/upload/${name}`, body);

    expect((await upload('grace', 'notes.md', '# hi')).status).toBe(403);
    expect((await upload('ada', 'notes.md', '# hi')).status).toBe(201);
    expect(await (await call('ada', 'GET', `/api/workspaces/${id}/files/notes.md`)).json()).toMatchObject({ content: '# hi' });

    // A disallowed type is 415 with the reason, and NOTHING is written.
    const bad = await upload('ada', 'payload.exe', 'MZ');
    expect(bad.status).toBe(415);
    expect(((await bad.json()) as { error: string }).error).toMatch(/\.exe/);
    expect(blobs.has(`workspaces/${id}/files/payload.exe`)).toBe(false);
    // Oversize is 413 naming the limit.
    const huge = await upload('ada', 'big.md', 'x'.repeat(20 * 1024 * 1024 + 1));
    expect(huge.status).toBe(413);
    expect(((await huge.json()) as { error: string }).error).toMatch(/20 MB/);
    // An upload never silently replaces an existing blob.
    expect((await upload('ada', 'notes.md', '# other')).status).toBe(409);
    expect(await (await call('ada', 'GET', `/api/workspaces/${id}/files/notes.md`)).json()).toMatchObject({ content: '# hi' });

    // Download is its own verb: a Viewer holds file.download, a member with
    // no verbs at all does not.
    expect((await call('grace', 'GET', `/api/workspaces/${id}/download/notes.md`)).status).toBe(200);
    expect((await call('alan', 'GET', `/api/workspaces/${id}/download/notes.md`)).status).toBe(403);
    const got = await call('ada', 'GET', `/api/workspaces/${id}/download/notes.md`);
    expect(got.headers.get('content-disposition')).toContain('notes.md');
    expect(await got.text()).toBe('# hi');
    expect((await call('ada', 'GET', `/api/workspaces/${id}/download/nope.md`)).status).toBe(404);
    blobs.clear();
  });

  it('U846: a save carrying a stale ETag is refused 412 with the stored content untouched', async () => {
    // PRD 007 Req 20: two members, one file. Ada reads, Grace saves, Ada's
    // conditional save must lose — and Grace's write must survive.
    const id = await createWorkspace('ada', 'Concurrency');
    await grant(id, 'grace', 'Editor');
    const path = `/api/workspaces/${id}/files/shared.md`;
    // A first write of a path that does not exist yet is unconditional.
    expect((await call('ada', 'PUT', path, 'v1')).status).toBe(200);
    const { etag } = (await (await call('ada', 'GET', path)).json()) as { etag: string };
    expect(etag).not.toBe('');

    // Grace saves first (her own read's tag, so hers lands).
    const graceRead = (await (await call('grace', 'GET', path)).json()) as { etag: string };
    const graceSave = await fetch(`${base}${path}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokens.grace}`, 'If-Match': graceRead.etag },
      body: 'grace was here',
    });
    expect(graceSave.status).toBe(200);

    // Ada's save carries the tag from BEFORE Grace's write: refused, and the
    // stored content is still Grace's.
    const adaSave = await fetch(`${base}${path}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokens.ada}`, 'If-Match': etag },
      body: 'ada clobbers',
    });
    expect(adaSave.status).toBe(412);
    expect(await (await call('ada', 'GET', path)).json()).toMatchObject({ content: 'grace was here' });

    // The overwrite branch: no If-Match at all, so it lands unconditionally.
    expect((await call('ada', 'PUT', path, 'ada overwrote')).status).toBe(200);
    expect(await (await call('ada', 'GET', path)).json()).toMatchObject({ content: 'ada overwrote' });
    blobs.clear();
  });

  // PRD 007 Req 15+16+17: the member and custom-role endpoints, each behind
  // exactly one verb. `workspace.settings` is deliberately NOT one of them:
  // the whole-manifest PUT above keeps its own gate untouched (#79 narrows it).
  /** Grant `user` `role` in `id` through the membership endpoint, as ada. */
  const addMember = (id: string, user: string, role: string) =>
    call('ada', 'POST', `/api/workspaces/${id}/members`, JSON.stringify({ id: user, role }));

  it('U305: the member endpoints add, re-role and remove, and the server owns modified', async () => {
    const id = await createWorkspace('ada', 'People');
    const added = await addMember(id, 'mock-grace', 'Viewer');
    expect(added.status).toBe(200);
    const first = ((await added.json()) as { manifest: WorkspaceManifest }).manifest;
    // Issue #180: each add snapshots the display name the directory knows.
    expect(first.members).toEqual([
      { id: 'mock-ada', role: 'Owner', displayName: 'Ada Lovelace' },
      { id: 'mock-grace', role: 'Viewer', displayName: 'Grace Hopper' },
    ]);
    // Grace can read but not write — the grant is live, not just recorded.
    await call('ada', 'PUT', `/api/workspaces/${id}/files/a.md`, 'hi');
    expect((await call('grace', 'PUT', `/api/workspaces/${id}/files/a.md`, 'x')).status).toBe(403);

    const promoted = await call(
      'ada',
      'PUT',
      `/api/workspaces/${id}/members/mock-grace`,
      JSON.stringify({ role: 'Editor' }),
    );
    expect(promoted.status).toBe(200);
    const second = ((await promoted.json()) as { manifest: WorkspaceManifest }).manifest;
    // …and a role change keeps the snapshot (issue #180).
    expect(second.members[1]).toEqual({ id: 'mock-grace', role: 'Editor', displayName: 'Grace Hopper' });
    // Creation is immutable; the modification stamp is the server's.
    expect(second.created).toBe(first.created);
    expect(Date.parse(second.modified)).toBeGreaterThanOrEqual(Date.parse(first.created));
    expect((await call('grace', 'PUT', `/api/workspaces/${id}/files/a.md`, 'x')).status).toBe(200);

    const removed = await call('ada', 'DELETE', `/api/workspaces/${id}/members/mock-grace`);
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { manifest: WorkspaceManifest }).manifest.members).toEqual([
      { id: 'mock-ada', role: 'Owner', displayName: 'Ada Lovelace' },
    ]);
    expect((await call('grace', 'GET', `/api/workspaces/${id}/files/a.md`)).status).toBe(403);
    blobs.clear();
  });

  it('U306: everyone-access is a member endpoint too — it grants a default role to non-members', async () => {
    const id = await createWorkspace('ada', 'Open');
    await call('ada', 'PUT', `/api/workspaces/${id}/files/a.md`, 'hi');
    expect((await call('alan', 'GET', `/api/workspaces/${id}/files/a.md`)).status).toBe(403);
    const on = await call(
      'ada',
      'PUT',
      `/api/workspaces/${id}/everyone`,
      JSON.stringify({ enabled: true, role: 'Viewer' }),
    );
    expect(on.status).toBe(200);
    expect(((await on.json()) as { manifest: WorkspaceManifest }).manifest.everyone).toEqual({
      enabled: true,
      role: 'Viewer',
    });
    expect((await call('alan', 'GET', `/api/workspaces/${id}/files/a.md`)).status).toBe(200);
    // An unknown role is a 400 naming it, and access is unchanged.
    const bad = await call(
      'ada',
      'PUT',
      `/api/workspaces/${id}/everyone`,
      JSON.stringify({ enabled: true, role: 'Superuser' }),
    );
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain('Superuser');
    // Turning it off closes the door again.
    await call('ada', 'PUT', `/api/workspaces/${id}/everyone`, JSON.stringify({ enabled: false }));
    expect((await call('alan', 'GET', `/api/workspaces/${id}/files/a.md`)).status).toBe(403);
    blobs.clear();
  });

  it('U307: the last Owner cannot be removed or demoted through the member endpoints', async () => {
    const id = await createWorkspace('ada', 'Owned');
    for (const [method, path, body] of [
      ['DELETE', `/api/workspaces/${id}/members/mock-ada`, undefined],
      ['PUT', `/api/workspaces/${id}/members/mock-ada`, JSON.stringify({ role: 'Viewer' })],
    ] as const) {
      const res = await call('ada', method, path, body);
      expect(res.status, `${method} ${path}`).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain('at least one Owner');
    }
    // With a second Owner in place, both become legal.
    expect((await addMember(id, 'mock-grace', 'Owner')).status).toBe(200);
    expect((await call('ada', 'DELETE', `/api/workspaces/${id}/members/mock-ada`)).status).toBe(200);
    blobs.clear();
  });

  it('U308: the custom-role endpoints create, rename+edit and delete, carrying members over on a rename', async () => {
    const id = await createWorkspace('ada', 'Roles');
    const made = await call(
      'ada',
      'POST',
      `/api/workspaces/${id}/roles`,
      JSON.stringify({ name: 'Reviewer', permissions: ['doc.read', 'comment.read', 'comment.write'] }),
    );
    expect(made.status).toBe(200);
    expect(((await made.json()) as { manifest: WorkspaceManifest }).manifest.roles).toEqual([
      { name: 'Reviewer', permissions: ['doc.read', 'comment.read', 'comment.write'] },
    ]);
    // The fresh role is grantable straight away.
    expect((await addMember(id, 'mock-grace', 'Reviewer')).status).toBe(200);

    const renamed = await call(
      'ada',
      'PUT',
      `/api/workspaces/${id}/roles/Reviewer`,
      JSON.stringify({ name: 'Auditor', permissions: ['doc.read'] }),
    );
    expect(renamed.status).toBe(200);
    const after = ((await renamed.json()) as { manifest: WorkspaceManifest }).manifest;
    expect(after.roles).toEqual([{ name: 'Auditor', permissions: ['doc.read'] }]);
    // Grace came along: she never silently drops to no permissions.
    expect(after.members[1]).toEqual({ id: 'mock-grace', role: 'Auditor', displayName: 'Grace Hopper' });
    expect((await call('grace', 'GET', `/api/workspaces/${id}/manifest`)).status).toBe(200);

    // Held roles cannot be deleted; freeing it first makes the delete legal.
    const held = await call('ada', 'DELETE', `/api/workspaces/${id}/roles/Auditor`);
    expect(held.status).toBe(400);
    const heldError = ((await held.json()) as { error: string }).error;
    expect(heldError).toContain('Auditor');
    expect(heldError).toContain('1 member');
    await call('ada', 'DELETE', `/api/workspaces/${id}/members/mock-grace`);
    expect((await call('ada', 'DELETE', `/api/workspaces/${id}/roles/Auditor`)).status).toBe(200);
    blobs.clear();
  });

  it('U309: role writes refuse built-in names, duplicates, unknown verbs and unknown targets with a 400', async () => {
    const id = await createWorkspace('ada', 'Guarded roles');
    const post = (body: unknown) =>
      call('ada', 'POST', `/api/workspaces/${id}/roles`, JSON.stringify(body));
    expect((await post({ name: 'Reviewer', permissions: ['doc.read'] })).status).toBe(200);

    const shadow = await post({ name: 'Owner', permissions: [] });
    expect(shadow.status).toBe(400);
    expect(((await shadow.json()) as { error: string }).error).toContain('built-in');
    const dup = await post({ name: 'Reviewer', permissions: [] });
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as { error: string }).error).toContain('already exists');
    const verb = await post({ name: 'Auditor', permissions: ['doc.publish'] });
    expect(verb.status).toBe(400);
    expect(((await verb.json()) as { error: string }).error).toContain('doc.publish');
    expect((await post({ name: 'Auditor', permissions: 'all' })).status).toBe(400);
    // Editing or deleting a built-in is refused at the same gate.
    expect(
      (await call('ada', 'PUT', `/api/workspaces/${id}/roles/Viewer`, JSON.stringify({ name: 'Peeker', permissions: [] })))
        .status,
    ).toBe(400);
    expect((await call('ada', 'DELETE', `/api/workspaces/${id}/roles/Editor`)).status).toBe(400);
    // A role nothing defines is a 400 too.
    expect((await call('ada', 'DELETE', `/api/workspaces/${id}/roles/Ghost`)).status).toBe(400);
    // …and an unknown workspace id stays a 404 on every one of these routes.
    expect((await call('ada', 'POST', '/api/workspaces/no-such-id/roles', '{}')).status).toBe(404);
    expect((await call('ada', 'POST', '/api/workspaces/no-such-id/members', '{}')).status).toBe(404);
    blobs.clear();
  });

  it('U310: each new endpoint checks exactly one verb — members and roles are separately gated', async () => {
    const id = await createWorkspace('ada', 'Verbs');
    // A custom role holding workspace.members but NOT workspace.roles, and
    // one holding workspace.roles but NOT workspace.members: each can use
    // exactly its own endpoints and gets a 403 naming the other's verb.
    await call('ada', 'POST', `/api/workspaces/${id}/roles`, JSON.stringify({ name: 'Peopler', permissions: ['doc.read', 'workspace.members'] }));
    await call('ada', 'POST', `/api/workspaces/${id}/roles`, JSON.stringify({ name: 'Roler', permissions: ['doc.read', 'workspace.roles'] }));
    await addMember(id, 'mock-grace', 'Peopler');
    await addMember(id, 'mock-alan', 'Roler');

    const memberRoutes = [
      ['POST', `/api/workspaces/${id}/members`, JSON.stringify({ id: 'mock-katherine', role: 'Viewer' })],
      ['PUT', `/api/workspaces/${id}/members/mock-alan`, JSON.stringify({ role: 'Viewer' })],
      ['DELETE', `/api/workspaces/${id}/members/mock-alan`, undefined],
      ['PUT', `/api/workspaces/${id}/everyone`, JSON.stringify({ enabled: false })],
    ] as const;
    const roleRoutes = [
      ['POST', `/api/workspaces/${id}/roles`, JSON.stringify({ name: 'Extra', permissions: [] })],
      ['PUT', `/api/workspaces/${id}/roles/Extra`, JSON.stringify({ name: 'Extra', permissions: [] })],
      ['DELETE', `/api/workspaces/${id}/roles/Extra`, undefined],
    ] as const;

    for (const [method, path, body] of roleRoutes) {
      const res = await call('grace', method, path, body);
      expect(res.status, `grace ${method} ${path}`).toBe(403);
      expect(((await res.json()) as { required: string }).required).toBe('workspace.roles');
    }
    for (const [method, path, body] of memberRoutes) {
      const res = await call('alan', method, path, body);
      expect(res.status, `alan ${method} ${path}`).toBe(403);
      expect(((await res.json()) as { required: string }).required).toBe('workspace.members');
    }
    // And each does hold their own: grace administers people, alan roles.
    expect((await call('grace', 'PUT', `/api/workspaces/${id}/everyone`, JSON.stringify({ enabled: false }))).status).toBe(200);
    for (const [method, path, body] of roleRoutes) {
      expect((await call('alan', method, path, body)).status, `alan ${method} ${path}`).toBe(200);
    }
    blobs.clear();
  });

  /**
   * PRD 007 Req 13+17: the enforcement sweep. The route→verb table in
   * server/workspaces.ts is the documented mapping; these tests drive it
   * against the real handlers, so a table entry that drifts from its route —
   * or a catalog verb no route requires — fails here.
   */
  it('U326: every route in the table 403s with exactly its declared verb, and every catalog verb is enforced', async () => {
    const id = await createWorkspace('ada', 'Table');
    // Seed what the placeholders address: an existing blob, its sidecar, a
    // folder, a member and a custom role.
    await call('ada', 'PUT', `/api/workspaces/${id}/files/existing.md`, '# there\n');
    await call('ada', 'PUT', `/api/workspaces/${id}/files/existing.md.comments.json`, '{"version":1,"comments":[]}');
    await call('ada', 'POST', `/api/workspaces/${id}/folders`, JSON.stringify({ path: 'folder' }));
    await addMember(id, 'mock-grace', 'Viewer');
    await call('ada', 'POST', `/api/workspaces/${id}/roles`, JSON.stringify({ name: 'Some', permissions: [] }));
    const before = [...blobs.keys()].sort();

    const fill = (path: string): string =>
      path
        .replace('<existing>', 'existing.md')
        .replace('<sidecar>', 'existing.md.comments.json')
        .replace('<new>', 'brand-new.md')
        .replace('<folder>', 'folder')
        .replace('<member>', 'mock-grace')
        .replace('<role>', 'Some');

    // Alan is a signed-in non-member of a workspace with everyone-access off:
    // he resolves to no verbs at all, so every route answers 403 and names
    // the one verb it wanted.
    for (const route of WORKSPACE_ROUTE_PERMISSIONS) {
      const path = `/api/workspaces/${id}${route.path ? `/${fill(route.path)}` : ''}`;
      const res = await call('alan', route.method, path, route.method === 'GET' ? undefined : '{}');
      expect(res.status, `${route.method} ${route.path}`).toBe(403);
      expect(((await res.json()) as { required: string }).required, `${route.method} ${route.path}`).toBe(
        route.required,
      );
    }
    // Req 17: nothing he tried landed — enforcement is not advisory.
    expect([...blobs.keys()].sort()).toEqual(before);

    // Req 13: the whole catalog is reachable — no verb can be added to
    // PERMISSIONS and left with no operation behind it.
    const enforced = new Set(WORKSPACE_ROUTE_PERMISSIONS.map((r) => r.required));
    expect([...PERMISSIONS].filter((p) => !enforced.has(p))).toEqual([]);
    blobs.clear();
  });

  it('U327: a comment sidecar answers to the comment verbs — a Commenter comments, a Viewer cannot', async () => {
    const id = await createWorkspace('ada', 'Sidecars');
    await call('ada', 'PUT', `/api/workspaces/${id}/files/doc.md`, '# doc\n');
    await addMember(id, 'mock-grace', 'Commenter');
    await addMember(id, 'mock-alan', 'Viewer');
    const sidecar = `/api/workspaces/${id}/files/doc.md.comments.json`;
    const payload = '{"version":1,"comments":[{"id":"c1"}]}';

    // PRD 007 Req 14+17: the headline fix. A Commenter holds no doc.edit and
    // could not write a sidecar while it demanded that verb.
    expect((await call('grace', 'PUT', sidecar, payload)).status).toBe(200);
    expect((await call('grace', 'GET', sidecar)).status).toBe(200);
    // …but the document itself is still not theirs to change.
    const save = await call('grace', 'PUT', `/api/workspaces/${id}/files/doc.md`, 'changed');
    expect(save.status).toBe(403);
    expect(((await save.json()) as { required: string }).required).toBe('doc.edit');
    expect(blobs.get(`workspaces/${id}/files/doc.md`)).toBe('# doc\n');

    // A Viewer reads the same comments and writes neither store.
    expect((await call('alan', 'GET', sidecar)).status).toBe(200);
    for (const [method, path, required] of [
      ['PUT', sidecar, 'comment.write'],
      ['DELETE', sidecar, 'comment.write'],
      ['PUT', `/api/workspaces/${id}/files/doc.md`, 'doc.edit'],
    ] as const) {
      const res = await call('alan', method, path, 'x');
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(((await res.json()) as { required: string }).required).toBe(required);
    }
    expect(blobs.get(`workspaces/${id}/files/doc.md.comments.json`)).toBe(payload);

    // A custom role without comment.read cannot even see them, while the
    // document stays readable — the two are separate verbs.
    await call('ada', 'POST', `/api/workspaces/${id}/roles`, JSON.stringify({ name: 'NoComments', permissions: ['doc.read', 'doc.edit'] }));
    await call('ada', 'PUT', `/api/workspaces/${id}/members/mock-alan`, JSON.stringify({ role: 'NoComments' }));
    const hidden = await call('alan', 'GET', sidecar);
    expect(hidden.status).toBe(403);
    expect(((await hidden.json()) as { required: string }).required).toBe('comment.read');
    expect((await call('alan', 'GET', `/api/workspaces/${id}/files/doc.md`)).status).toBe(200);
    // A pasted image is not a sidecar: it stays on the doc/file verbs.
    expect((await call('alan', 'PUT', `/api/workspaces/${id}/files/images/p.png?raw=1`, 'bytes')).status).toBe(403);
    blobs.clear();
  });

  it('U328: a PUT that creates needs file.create, a PUT that saves needs doc.edit', async () => {
    const id = await createWorkspace('ada', 'Create');
    await call('ada', 'PUT', `/api/workspaces/${id}/files/there.md`, 'original\n');
    // PRD 007 Req 15: custom roles are exactly why the two cannot share a
    // verb — one role each way round.
    await call('ada', 'POST', `/api/workspaces/${id}/roles`, JSON.stringify({ name: 'Saver', permissions: ['doc.read', 'doc.edit'] }));
    await call('ada', 'POST', `/api/workspaces/${id}/roles`, JSON.stringify({ name: 'Maker', permissions: ['doc.read', 'file.create'] }));
    await addMember(id, 'mock-grace', 'Saver');
    await addMember(id, 'mock-alan', 'Maker');

    // Saver: may overwrite what exists, may not bring a new path into being.
    expect((await call('grace', 'PUT', `/api/workspaces/${id}/files/there.md`, 'edited\n')).status).toBe(200);
    const refusedCreate = await call('grace', 'PUT', `/api/workspaces/${id}/files/fresh.md`, 'new\n');
    expect(refusedCreate.status).toBe(403);
    expect(((await refusedCreate.json()) as { required: string }).required).toBe('file.create');
    expect(blobs.has(`workspaces/${id}/files/fresh.md`)).toBe(false);

    // Maker: the mirror image, including for raw bytes (a pasted image).
    expect((await call('alan', 'PUT', `/api/workspaces/${id}/files/fresh.md`, 'new\n')).status).toBe(200);
    expect((await call('alan', 'PUT', `/api/workspaces/${id}/files/images/p.png?raw=1`, 'bytes')).status).toBe(200);
    const refusedSave = await call('alan', 'PUT', `/api/workspaces/${id}/files/there.md`, 'stomped\n');
    expect(refusedSave.status).toBe(403);
    expect(((await refusedSave.json()) as { required: string }).required).toBe('doc.edit');
    expect(blobs.get(`workspaces/${id}/files/there.md`)).toBe('edited\n');
    // A path that was created IS existing afterwards: the second write is a save.
    const second = await call('alan', 'PUT', `/api/workspaces/${id}/files/fresh.md`, 'again\n');
    expect(second.status).toBe(403);
    expect(((await second.json()) as { required: string }).required).toBe('doc.edit');
    blobs.clear();
  });

  it('U329: the five built-in roles behave against the real endpoints, and no refusal changes stored state', async () => {
    const id = await createWorkspace('ada', 'Matrix');
    const files = () => [...blobs.keys()].filter((b) => b.startsWith(`workspaces/${id}/files/`)).sort();
    const sidecar = `/api/workspaces/${id}/files/doc.md.comments.json`;

    /**
     * PRD 007 Req 14+17: what one role can actually do, endpoint by endpoint
     * and one at a time — each attempt is issued only after the previous
     * one's outcome is known, so what a role may do is never confused with
     * what raced ahead of it. The document is re-seeded per role, and each
     * role's create/rename targets carry its own name.
     */
    const allowed = async (user: string, tag: string): Promise<string[]> => {
      await call('ada', 'PUT', `/api/workspaces/${id}/files/doc.md`, 'seed\n');
      const attempts: Array<readonly [string, () => Promise<Response>]> = [
        ['read', () => call(user, 'GET', `/api/workspaces/${id}/files/doc.md`)],
        ['comment', () => call(user, 'PUT', sidecar, '{"version":1,"comments":[]}')],
        ['save', () => call(user, 'PUT', `/api/workspaces/${id}/files/doc.md`, 'theirs\n')],
        ['create', () => call(user, 'PUT', `/api/workspaces/${id}/files/${tag}.md`, 'new\n')],
        ['delete', () => call(user, 'DELETE', `/api/workspaces/${id}/files/${tag}.md`)],
        [
          'rename',
          () =>
            call(user, 'POST', `/api/workspaces/${id}/move-file`, JSON.stringify({ from: 'doc.md', to: `${tag}-moved.md` })),
        ],
        ['folder', () => call(user, 'POST', `/api/workspaces/${id}/folders`, JSON.stringify({ path: `${tag}-dir` }))],
        ['members', () => call(user, 'PUT', `/api/workspaces/${id}/everyone`, JSON.stringify({ enabled: false }))],
      ];
      const out: string[] = [];
      for (const [name, run] of attempts) {
        const res = await run();
        if (res.ok) out.push(name);
        else {
          expect(res.status, `${user} ${name}`).toBe(403);
          // Req 13: a refusal always names one catalog verb.
          expect(PERMISSIONS).toContain(((await res.json()) as { required: string }).required);
        }
      }
      return out;
    };

    await addMember(id, 'mock-grace', 'Commenter');
    // A Commenter opens the doc and writes a comment — and nothing else.
    expect(await allowed('grace', 'Commenter')).toEqual(['read', 'comment']);
    // Req 17: nothing they were refused landed. The document still holds the
    // seed, and the only blob that appeared is the sidecar they may write.
    expect(blobs.get(`workspaces/${id}/files/doc.md`)).toBe('seed\n');
    expect(files()).toEqual([`workspaces/${id}/files/doc.md`, `workspaces/${id}/files/doc.md.comments.json`]);

    const reRole = (role: string) =>
      call('ada', 'PUT', `/api/workspaces/${id}/members/mock-grace`, JSON.stringify({ role }));

    await reRole('Viewer');
    expect(await allowed('grace', 'Viewer')).toEqual(['read']);
    expect(blobs.get(`workspaces/${id}/files/doc.md`)).toBe('seed\n');

    await reRole('Contributor');
    // Contributor creates and edits; deleting, renaming and folders are not theirs.
    expect(await allowed('grace', 'Contributor')).toEqual(['read', 'comment', 'save', 'create']);

    await reRole('Editor');
    // Editor does all doc/file/folder/comment work and no workspace.* at all.
    expect(await allowed('grace', 'Editor')).toEqual(['read', 'comment', 'save', 'create', 'delete', 'rename', 'folder']);

    // Owner: everything, the membership endpoint included.
    expect(await allowed('ada', 'Owner')).toEqual([
      'read',
      'comment',
      'save',
      'create',
      'delete',
      'rename',
      'folder',
      'members',
    ]);
    blobs.clear();
  });
});

// PRD 017 Req 4: the implicit admin union is inherited by the HTTP layer —
// requirePermission and the listing's access flag — with no per-route change:
// the same createApp, wired with an MM_ADMINS-style admin set.
describe('PRD 017 Req 4 admin union over HTTP', () => {
  const { provider } = createMemoryStorage();
  const auth = createMockAuthProvider();
  let server: Server;
  let base = '';
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    server = createServer(
      createApp(
        '/nonexistent-static',
        { auth, storage: provider, directory: createMockDirectoryProvider() },
        'local',
        undefined,
        new Set(['mock-katherine']),
      ),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const username of ['ada', 'katherine']) {
      const result = await auth.signIn({ username });
      if (result?.kind !== 'token') throw new Error('mock sign-in failed');
      tokens[username] = result.token;
    }
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const call = (user: string, method: string, path: string, body?: string): Promise<Response> =>
    fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${tokens[user]}` }, body });

  it('U961: an admin non-member reads, administers and is listed with access — but cannot write', async () => {
    const res = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ name: 'Admin proof' }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    // Katherine is no member, yet her listing row says openable…
    const listing = (await (await call('katherine', 'GET', '/api/workspaces')).json()) as {
      id: string;
      access: boolean;
    }[];
    expect(listing.find((row) => row.id === id)?.access).toBe(true);
    // …the doc.read gate admits her…
    expect((await call('katherine', 'GET', `/api/workspaces/${id}/manifest`)).status).toBe(200);
    // …and so does a workspace.settings write (the whole-manifest PUT).
    const { manifest } = (await (await call('katherine', 'GET', `/api/workspaces/${id}/manifest`)).json()) as {
      manifest: WorkspaceManifest;
    };
    expect(
      (await call('katherine', 'PUT', `/api/workspaces/${id}/manifest`, JSON.stringify(manifest))).status,
    ).toBe(200);
    // No write verb is implicit: creating a file still 403s naming its verb.
    const denied = await call('katherine', 'PUT', `/api/workspaces/${id}/files/notes/a.md`, '# hi');
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'forbidden', required: 'file.create' });
    // Cleanup: the Owner deletes the workspace (shared server, shared suite).
    expect((await call('ada', 'DELETE', `/api/workspaces/${id}`)).status).toBe(200);
  });
});

// The reference provider the HTTP layer above runs on is held to the shared
// seam contract (tests/unit/storage-contract.ts). U374–U382 is this run's
// block of ids.
describeStorageContract({
  label: 'the in-memory reference provider',
  firstId: 374,
  create: () => createMemoryStorage().provider,
});
