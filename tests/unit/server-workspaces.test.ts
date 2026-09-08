import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { createMockAuthProvider } from '../../server/providers/mock/auth';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import { PERMISSIONS, type WorkspaceManifest } from '../../src/lib/hostedWorkspace';
import type { WorkspaceListing } from '../../src/lib/workspaceLifecycle';
import { migrateWorkspaceUniqueNames, WORKSPACE_ROUTE_PERMISSIONS } from '../../server/workspaces';
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

  it('U993: under members listing the admin’s ordinary listing is filtered like anyone else’s', async () => {
    // PRD 017 Req 11 (issue #191): cross-membership browsing lives in
    // Management only — under `members`, a row whose MANIFEST grants the
    // admin nothing is omitted from GET /api/workspaces, even though the
    // Req 4 union would let them open it by id.
    const created = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ name: 'Members only' }));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    try {
      const put = await call(
        'katherine',
        'PUT',
        '/api/admin/settings',
        JSON.stringify({ version: 1, creation: { policy: 'everyone', allow: [] }, listing: { policy: 'members' } }),
      );
      expect(put.status).toBe(200);
      const forKatherine = (await (await call('katherine', 'GET', '/api/workspaces')).json()) as { id: string }[];
      expect(forKatherine.map((row) => row.id)).not.toContain(id);
      // The member's own listing keeps the row, flag resolved as ever…
      const forAda = (await (await call('ada', 'GET', '/api/workspaces')).json()) as {
        id: string;
        access: boolean;
      }[];
      expect(forAda.find((row) => row.id === id)?.access).toBe(true);
      // …and Req 4 still opens the workspace itself by id.
      expect((await call('katherine', 'GET', `/api/workspaces/${id}/manifest`)).status).toBe(200);
    } finally {
      const restored = await call(
        'katherine',
        'PUT',
        '/api/admin/settings',
        JSON.stringify({ version: 1, creation: { policy: 'everyone', allow: [] }, listing: { policy: 'everyone' } }),
      );
      expect(restored.status).toBe(200);
      expect((await call('ada', 'DELETE', `/api/workspaces/${id}`)).status).toBe(200);
    }
  });
});

// The reference provider the HTTP layer above runs on is held to the shared
// seam contract (tests/unit/storage-contract.ts). U374–U383 is this run's
// block of ids.
describeStorageContract({
  label: 'the in-memory reference provider',
  firstId: 374,
  create: () => createMemoryStorage().provider,
});

// PRD 020 Reqs 1+3+4: unique names over HTTP — creation and rename enforce
// the shared rules (reserved words, case-insensitive collisions) with 4xx
// JSON errors the client shows verbatim, and the startup migration names
// every pre-existing workspace idempotently.
describe('PRD 020 Req 1+3+4 workspace unique names over HTTP', () => {
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
    for (const username of ['ada', 'grace']) {
      const result = await auth.signIn({ username });
      if (result?.kind !== 'token') throw new Error('mock sign-in failed');
      tokens[username] = result.token;
    }
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const call = (user: string, method: string, path: string, body?: string): Promise<Response> =>
    fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${tokens[user]}` }, body });

  const readManifest = async (id: string): Promise<WorkspaceManifest> => {
    const res = await call('ada', 'GET', `/api/workspaces/${id}/manifest`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { manifest: WorkspaceManifest }).manifest;
  };

  /** Create a workspace under `uniqueName` and return its id. */
  const create = async (uniqueName: string): Promise<string> => {
    const res = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ uniqueName }));
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };

  /**
   * PRD 026 Req 9: write a unique name straight into the stored blob, past
   * the create route's strict rule — how a workspace named under PRD 020's
   * wider charset (`Team_Docs`, `Design-Docs`) actually sits in a deployment.
   */
  const seedStoredName = async (id: string, uniqueName: string): Promise<void> => {
    const stored = await provider.read(`workspaces/${id}/manifest.json`);
    const manifest = JSON.parse(stored!.content) as WorkspaceManifest;
    await provider.write(`workspaces/${id}/manifest.json`, JSON.stringify({ ...manifest, uniqueName }, null, 2));
  };

  /** PUT the stored manifest back under a new unique name; answer what was stored. */
  const rename = async (id: string, uniqueName: string): Promise<WorkspaceManifest> => {
    const current = await readManifest(id);
    const res = await call('ada', 'PUT', `/api/workspaces/${id}/manifest`, JSON.stringify({ ...current, uniqueName }));
    expect(res.status).toBe(200);
    return readManifest(id);
  };

  it('U1053: creation stores both names and rejects reserved or case-insensitively colliding unique names verbatim', async () => {
    // PRD 026 Req 1: a chosen name is lowercase-dash.
    const created = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ uniqueName: 'design-docs', name: 'Design Docs' }));
    expect(created.status).toBe(201);
    const { id, manifest } = (await created.json()) as { id: string; manifest: WorkspaceManifest };
    expect(manifest.uniqueName).toBe('design-docs');
    expect(manifest.name).toBe('Design Docs');
    // Case-insensitive collision: a chosen lowercase name against a stored
    // mixed-case one (a grandfathered PRD 020 name, seeded straight into
    // storage) is a 409 whose message the dialog can show as-is.
    await seedStoredName(id, 'Design-Docs');
    const collided = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ uniqueName: 'design-docs' }));
    expect(collided.status).toBe(409);
    expect(((await collided.json()) as { error: string }).error).toBe('The unique name "design-docs" is already taken.');
    // Reserved names are refused with the shared module's own message.
    const reserved = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ uniqueName: 'api' }));
    expect(reserved.status).toBe(400);
    expect(((await reserved.json()) as { error: string }).error).toBe('"api" is a reserved name.');
    // A malformed one names the format problem.
    const spaced = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ uniqueName: 'no spaces' }));
    expect(spaced.status).toBe(400);
    // Only the one workspace landed.
    expect([...blobs.keys()]).toEqual([`workspaces/${id}/manifest.json`]);
    blobs.clear();
  });

  it('U1054: rename applies creation rules, takes effect immediately, and a friendly-name change never touches the unique name', async () => {
    const a = (await (await call('ada', 'POST', '/api/workspaces', JSON.stringify({ uniqueName: 'alpha' }))).json()) as { id: string };
    const b = (await (await call('ada', 'POST', '/api/workspaces', JSON.stringify({ uniqueName: 'beta' }))).json()) as { id: string };
    const manifest = await readManifest(b.id);

    // A unique-name change lands and subsequent reads show it (Req 4).
    const renamed = await call('ada', 'PUT', `/api/workspaces/${b.id}/manifest`, JSON.stringify({ ...manifest, uniqueName: 'gamma' }));
    expect(renamed.status).toBe(200);
    expect((await readManifest(b.id)).uniqueName).toBe('gamma');

    // Colliding with another workspace (case-insensitively — `a` is stored
    // as a seeded mixed-case `Alpha`) is a 409…
    await seedStoredName(a.id, 'Alpha');
    const collide = await call('ada', 'PUT', `/api/workspaces/${b.id}/manifest`, JSON.stringify({ ...manifest, uniqueName: 'alpha' }));
    expect(collide.status).toBe(409);
    expect(((await collide.json()) as { error: string }).error).toBe('The unique name "alpha" is already taken.');
    // …a reserved word is a 400…
    const reserved = await call('ada', 'PUT', `/api/workspaces/${b.id}/manifest`, JSON.stringify({ ...manifest, uniqueName: 'scratchpad' }));
    expect(reserved.status).toBe(400);
    expect(((await reserved.json()) as { error: string }).error).toBe('"scratchpad" is a reserved name.');
    // …and neither refusal changed the stored name.
    expect((await readManifest(b.id)).uniqueName).toBe('gamma');

    // A friendly-name change rides the same PUT and never touches the unique
    // name; a body omitting uniqueName entirely (a pre-#219 client) keeps it.
    const current = await readManifest(b.id);
    const friendly = await call('ada', 'PUT', `/api/workspaces/${b.id}/manifest`, JSON.stringify({ ...current, name: 'Beta Docs' }));
    expect(friendly.status).toBe(200);
    const { uniqueName: _drop, ...withoutUnique } = await readManifest(b.id);
    const stripped = await call('ada', 'PUT', `/api/workspaces/${b.id}/manifest`, JSON.stringify(withoutUnique));
    expect(stripped.status).toBe(200);
    const after = await readManifest(b.id);
    expect(after.name).toBe('Beta Docs');
    expect(after.uniqueName).toBe('gamma');

    // Req 4: no workspace.settings, no rename — the existing 403 names the verb.
    const forbidden = await call('grace', 'PUT', `/api/workspaces/${a.id}/manifest`, JSON.stringify(await readManifest(a.id)));
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as { required: string }).required).toBe('workspace.settings');
    blobs.clear();
  });

  it('U1236: a rename records the name given up, a case-only change records nothing, and renaming back reclaims it', async () => {
    // PRD 024 Req 1: a workspace that has never been renamed carries no
    // history at all — absent means none.
    const id = await create('hist-a');
    expect((await readManifest(id)).formerNames).toBeUndefined();

    // Req 2: the previous name is appended when the name really changes.
    expect((await rename(id, 'hist-b')).formerNames).toEqual(['hist-a']);
    // Req 2: a case-only change updates the current name as today and is not
    // a rename for history purposes. PRD 026 Req 1 means the mixed-case side
    // can only be the STORED one (a grandfathered name, seeded), so the
    // change runs `Hist-B` → `hist-b`.
    await seedStoredName(id, 'Hist-B');
    const cased = await rename(id, 'hist-b');
    expect(cased.uniqueName).toBe('hist-b');
    expect(cased.formerNames).toEqual(['hist-a']);
    // Req 4: chains are flat — one list, append order preserved, no old→new
    // mapping to follow.
    expect((await rename(id, 'hist-c')).formerNames).toEqual(['hist-a', 'hist-b']);
    // Req 3: the name becoming current leaves the list, and the one just
    // given up joins it — so the list never holds the current name.
    const back = await rename(id, 'hist-a');
    expect(back.uniqueName).toBe('hist-a');
    expect(back.formerNames).toEqual(['hist-b', 'hist-c']);

    // Req 3 at its simplest: after A → B → A the history is exactly [B].
    const pinged = await create('ping');
    await rename(pinged, 'pong');
    const reclaimed = await rename(pinged, 'ping');
    expect(reclaimed.uniqueName).toBe('ping');
    expect(reclaimed.formerNames).toEqual(['pong']);

    // Req 2: a friendly-name-only save records nothing…
    const current = await readManifest(pinged);
    const friendly = await call('ada', 'PUT', `/api/workspaces/${pinged}/manifest`, JSON.stringify({ ...current, name: 'Ping Docs' }));
    expect(friendly.status).toBe(200);
    expect((await readManifest(pinged)).formerNames).toEqual(['pong']);
    // …and neither does a body that omits `uniqueName` entirely.
    const { uniqueName: _drop, ...withoutUnique } = await readManifest(pinged);
    expect((await call('ada', 'PUT', `/api/workspaces/${pinged}/manifest`, JSON.stringify(withoutUnique))).status).toBe(200);
    const kept = await readManifest(pinged);
    expect(kept.uniqueName).toBe('ping');
    expect(kept.formerNames).toEqual(['pong']);
    blobs.clear();
  });

  it('U1237: a client-supplied formerNames on a manifest PUT is ignored, like created', async () => {
    // PRD 024 Req 1: the field is server-owned — the stored value is computed
    // from the existing manifest plus the rename that just happened.
    const id = await create('owned');
    const current = await readManifest(id);
    const smuggled = await call(
      'ada',
      'PUT',
      `/api/workspaces/${id}/manifest`,
      JSON.stringify({ ...current, formerNames: ['fabricated', 'also-fake'] }),
    );
    expect(smuggled.status).toBe(200);
    expect((await readManifest(id)).formerNames).toBeUndefined();
    // The same on a real rename: the body's value is discarded, and only the
    // name actually given up is recorded.
    const renamed = await call(
      'ada',
      'PUT',
      `/api/workspaces/${id}/manifest`,
      JSON.stringify({ ...current, uniqueName: 'owned-2', formerNames: ['fabricated'] }),
    );
    expect(renamed.status).toBe(200);
    expect((await readManifest(id)).formerNames).toEqual(['owned']);
    blobs.clear();
  });

  it('U1238: creation and rename take another workspace\u2019s former name and strip it from that workspace', async () => {
    // PRD 024 Req 6: a former name is not taken — creation with it succeeds
    // under exactly today's rules, no warning and no confirmation…
    const abandoned = await create('reclaim-me');
    await rename(abandoned, 'moved-on');
    expect((await readManifest(abandoned)).formerNames).toEqual(['reclaim-me']);
    const created = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ uniqueName: 'reclaim-me' }));
    expect(created.status).toBe(201);
    expect(((await created.json()) as { manifest: WorkspaceManifest }).manifest.uniqueName).toBe('reclaim-me');
    // …and Req 8: the old holder stops answering to it in the same request.
    expect((await readManifest(abandoned)).formerNames).toBeUndefined();

    // The same on rename, and only the reclaimed entry goes: the giver has
    // two former names and keeps the other one.
    const giver = await create('giver');
    await rename(giver, 'giver-2');
    await rename(giver, 'giver-3');
    expect((await readManifest(giver)).formerNames).toEqual(['giver', 'giver-2']);
    const taker = await create('taker');
    const took = await rename(taker, 'giver');
    expect(took.uniqueName).toBe('giver');
    expect(took.formerNames).toEqual(['taker']);
    expect((await readManifest(giver)).formerNames).toEqual(['giver-2']);
    blobs.clear();
  });

  it('U1239: listing rows carry the former names, an empty array when there are none', async () => {
    // PRD 024 Req 5: the field rides the same row as the unique name.
    const plain = await create('listed-plain');
    const moved = await create('listed-old');
    await rename(moved, 'listed-new');
    const res = await call('ada', 'GET', '/api/workspaces');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as WorkspaceListing[];
    const row = (id: string) => rows.find((r) => r.id === id);
    expect(row(plain)?.formerNames).toEqual([]);
    expect(row(moved)?.uniqueName).toBe('listed-new');
    expect(row(moved)?.formerNames).toEqual(['listed-old']);
    blobs.clear();
  });

  it('U1055: migration slugifies and dedupes legacy manifests, logs each, preserves the display name, and is idempotent', async () => {
    // Legacy workspaces: stored without unique names. Creation now mints one
    // even for a name-only body (PRD 020 Req 5, U1057), so a pre-#219
    // manifest is fabricated the way an old deployment actually holds it —
    // by dropping the field from the stored blob.
    const legacyWorkspace = async (name: string): Promise<{ id: string }> => {
      const { id } = (await (await call('ada', 'POST', '/api/workspaces', JSON.stringify({ name }))).json()) as {
        id: string;
      };
      const stored = await provider.read(`workspaces/${id}/manifest.json`);
      const { uniqueName: _minted, ...rest } = JSON.parse(stored!.content) as { uniqueName?: string };
      await provider.write(`workspaces/${id}/manifest.json`, JSON.stringify(rest, null, 2));
      return { id };
    };
    const w1 = await legacyWorkspace('Design Docs');
    const w2 = await legacyWorkspace('Design Docs');
    const w3 = await legacyWorkspace('Scratchpad');
    // One already migrated: its name is taken, and it must not be rewritten.
    await call('ada', 'POST', '/api/workspaces', JSON.stringify({ uniqueName: 'design-docs', name: 'Kept' }));

    const log: string[] = [];
    expect(await migrateWorkspaceUniqueNames(provider, (line) => log.push(line))).toBe(3);
    // Oldest-first dedupe past the taken name; the reserved word is skipped
    // over (PRD 020 Req 3) — Scratchpad lands on scratchpad-2.
    const m1 = await readManifest(w1.id);
    const m2 = await readManifest(w2.id);
    const m3 = await readManifest(w3.id);
    expect(new Set([m1.uniqueName, m2.uniqueName])).toEqual(new Set(['design-docs-2', 'design-docs-3']));
    expect(m3.uniqueName).toBe('scratchpad-2');
    // The original display name is preserved as the friendly name.
    expect(m1.name).toBe('Design Docs');
    expect(m3.name).toBe('Scratchpad');
    // Each migrated workspace was logged.
    expect(log.length).toBe(3);
    expect(log.some((l) => l.includes(w3.id) && l.includes('"scratchpad-2"'))).toBe(true);

    // Idempotent: a second run migrates nothing and rewrites no bytes.
    const before = new Map(blobs);
    expect(await migrateWorkspaceUniqueNames(provider, (line) => log.push(line))).toBe(0);
    expect(log.length).toBe(3);
    expect(blobs).toEqual(before);
    blobs.clear();
  });

  it('U1056: a provisioned scratch workspace carries a deduped unique name from birth — never a reserved word', async () => {
    const res = await call('ada', 'POST', '/api/me/scratchpad');
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const manifest = await readManifest(id);
    // PRD 020 Req 1+10 (issue #244): "My scratchpad" slugifies to
    // `my-scratchpad` — deduped deployment-wide, never a reserved word
    // (uniqueNameProblem holds).
    expect(manifest.uniqueName).toBe('my-scratchpad');
    expect(manifest.name).toBe('My scratchpad');
    blobs.clear();
  });

  it('U1057: a name-only creation mints a slugified deduped unique name, and listing rows carry it', async () => {
    // PRD 020 Req 5+6: every workspace has a canonical path URL, so creation
    // without an explicit unique name mints one from the display name —
    // slugified and deduped exactly like the Req 3 migration.
    // PRD 026 Req 2: the slugifier strips the trailing punctuation's dash,
    // so `Team Notes!` mints `team-notes` and the next one `team-notes-2`.
    const first = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ name: 'Team Notes!' }));
    expect(first.status).toBe(201);
    const a = (await first.json()) as { id: string; manifest: WorkspaceManifest };
    expect(a.manifest.uniqueName).toBe('team-notes');
    const second = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ name: 'Team Notes~' }));
    const b = (await second.json()) as { id: string; manifest: WorkspaceManifest };
    expect(b.manifest.uniqueName).toBe('team-notes-2');
    // PRD 026 Req 2: a display name with nothing usable slugifies to nothing;
    // the route supplies the `workspace` fallback and dedupes it.
    const bare = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ name: '!!!' }));
    expect(((await bare.json()) as { manifest: WorkspaceManifest }).manifest.uniqueName).toBe('workspace');
    const bare2 = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ name: '日本語' }));
    expect(((await bare2.json()) as { manifest: WorkspaceManifest }).manifest.uniqueName).toBe('workspace-2');
    // PRD 020 Req 5: the listing row carries the unique name — what the
    // client resolves a visited path against, and builds canonical URLs from.
    const listed = (await (await call('ada', 'GET', '/api/workspaces')).json()) as {
      id: string;
      uniqueName?: string;
    }[];
    expect(listed.find((r) => r.id === a.id)?.uniqueName).toBe('team-notes');
    expect(listed.find((r) => r.id === b.id)?.uniqueName).toBe('team-notes-2');
    blobs.clear();
  });

  it('U1320: PRD 026 Req 3 — creation refuses a name failing the lowercase-dash rule with the shared rule\u2019s own message', async () => {
    const charset = 'A unique name may only use lowercase letters, numbers and single dashes between them.';
    // Legal under PRD 020's charset, refused now: uppercase, underscore, dot,
    // edge and double dashes — each a 400 carrying exactly the text the New
    // Workspace dialog shows as you type.
    for (const bad of ['Design-Docs', 'team_docs', 'team.docs', '-team', 'team-', 'team--docs', 'Team Docs']) {
      const res = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ uniqueName: bad, name: 'Team Docs' }));
      expect(res.status, bad).toBe(400);
      expect(((await res.json()) as { error: string }).error, bad).toBe(charset);
    }
    // The empty and over-length refusals keep their own distinct messages.
    const empty = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ uniqueName: '', name: 'Team Docs' }));
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: string }).error).toBe('A unique name is required.');
    const long = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ uniqueName: 'a'.repeat(101) }));
    expect(((await long.json()) as { error: string }).error).toBe('A unique name must be at most 100 characters.');
    // Nothing landed.
    expect([...blobs.keys()]).toEqual([]);
    // And the well-formed one does.
    const ok = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ uniqueName: 'team-docs', name: 'Team Docs' }));
    expect(ok.status).toBe(201);
    blobs.clear();
  });

  it('U1321: PRD 026 Req 3+9 — a grandfathered name is untouched by a PUT that keeps it, and a rename must meet the strict rule', async () => {
    const charset = 'A unique name may only use lowercase letters, numbers and single dashes between them.';
    // A workspace named `Team_Docs` under PRD 020, seeded straight into
    // storage: it reads back fine (manifest validation keeps the legacy
    // charset)…
    const id = await create('placeholder');
    await seedStoredName(id, 'Team_Docs');
    const stored = await readManifest(id);
    expect(stored.uniqueName).toBe('Team_Docs');
    // …and a PUT that changes only the display name is never re-validated
    // against the strict rule: 200, and `Team_Docs` stays.
    const friendly = await call('ada', 'PUT', `/api/workspaces/${id}/manifest`, JSON.stringify({ ...stored, name: 'Team Docs (renamed)' }));
    expect(friendly.status).toBe(200);
    const after = await readManifest(id);
    expect(after.name).toBe('Team Docs (renamed)');
    expect(after.uniqueName).toBe('Team_Docs');
    expect(after.formerNames).toBeUndefined();
    // A body that omits the field keeps the stored name too.
    const { uniqueName: _drop, ...withoutUnique } = after;
    expect((await call('ada', 'PUT', `/api/workspaces/${id}/manifest`, JSON.stringify(withoutUnique))).status).toBe(200);
    expect((await readManifest(id)).uniqueName).toBe('Team_Docs');
    // A rename to a name that fails the strict rule is a 400 with the same
    // message the settings section shows — before any collision scan.
    for (const bad of ['Team_Notes', 'Team-Docs', 'team.docs', 'team--docs']) {
      const res = await call('ada', 'PUT', `/api/workspaces/${id}/manifest`, JSON.stringify({ ...after, uniqueName: bad }));
      expect(res.status, bad).toBe(400);
      expect(((await res.json()) as { error: string }).error, bad).toBe(charset);
    }
    expect((await readManifest(id)).uniqueName).toBe('Team_Docs');
    // Renaming the grandfathered workspace to its lowercase-dash form is a
    // 200 — and `Team_Docs` → `team-docs` is a real rename, so it is recorded.
    const renamed = await call('ada', 'PUT', `/api/workspaces/${id}/manifest`, JSON.stringify({ ...after, uniqueName: 'team-docs' }));
    expect(renamed.status).toBe(200);
    const lower = await readManifest(id);
    expect(lower.uniqueName).toBe('team-docs');
    expect(lower.formerNames).toEqual(['Team_Docs']);
    // Whereas a grandfathered `Other-Docs` → `other-docs` is a case-only change
    // (PRD 024 Req 2): 200, the name lowercased, nothing recorded.
    const other = await create('placeholder-2');
    await seedStoredName(other, 'Other-Docs');
    const cased = await call('ada', 'PUT', `/api/workspaces/${other}/manifest`, JSON.stringify({ ...(await readManifest(other)), uniqueName: 'other-docs' }));
    expect(cased.status).toBe(200);
    const casedAfter = await readManifest(other);
    expect(casedAfter.uniqueName).toBe('other-docs');
    expect(casedAfter.formerNames).toBeUndefined();
    blobs.clear();
  });

  it('U1322: PRD 026 Req 1+9 — a chosen lowercase name colliding case-insensitively with a seeded mixed-case stored name is a 409', async () => {
    const id = await create('placeholder');
    await seedStoredName(id, 'Mixed-Case');
    // Creation…
    const created = await call('ada', 'POST', '/api/workspaces', JSON.stringify({ uniqueName: 'mixed-case' }));
    expect(created.status).toBe(409);
    expect(((await created.json()) as { error: string }).error).toBe('The unique name "mixed-case" is already taken.');
    // …and rename both compare through `uniqueNameKey`, so the grandfathered
    // name keeps its claim on the lowercase-dash form.
    const other = await create('someone-else');
    const renamed = await call('ada', 'PUT', `/api/workspaces/${other}/manifest`, JSON.stringify({ ...(await readManifest(other)), uniqueName: 'mixed-case' }));
    expect(renamed.status).toBe(409);
    expect(((await renamed.json()) as { error: string }).error).toBe('The unique name "mixed-case" is already taken.');
    expect((await readManifest(other)).uniqueName).toBe('someone-else');
    blobs.clear();
  });
});
