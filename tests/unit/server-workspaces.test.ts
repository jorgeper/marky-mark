import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { createMockAuthProvider } from '../../server/providers/mock/auth';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import type { FileStat, StorageProvider } from '../../server/providers/types';
import type { WorkspaceManifest } from '../../src/lib/hostedWorkspace';

// PRD 007 Req 7+13: the workspace API's blob layout and permission
// enforcement, proven offline at the HTTP layer — createApp wired to an
// in-memory storage seam and the mock auth provider, no network beyond
// the OS loopback and no Azure anything. The same behaviour runs against
// real Azurite blobs in tests/e2e/hosted.spec.ts (E172+).

/** An in-memory StorageProvider — the seam contract, no Azure. */
function createMemoryStorage(): { provider: StorageProvider; blobs: Map<string, string> } {
  const blobs = new Map<string, string>();
  // PRD 007 Req 8: blobs written as bytes keep their bytes and media type;
  // the text view decodes them, exactly as a real blob store behaves.
  const binaries = new Map<string, { data: Uint8Array; contentType: string }>();
  let stamp = 0;
  // PRD 007 Req 20: every write mints a NEW etag for that path, exactly as a
  // blob store does — that is what makes the conditional write meaningful
  // rather than a formula both sides can guess.
  const etags = new Map<string, string>();
  const stampPath = (path: string): string => {
    const etag = `e${++stamp}`;
    etags.set(path, etag);
    return etag;
  };
  const provider: StorageProvider = {
    kind: 'memory',
    async read(path) {
      const content = blobs.get(path);
      return content === undefined ? null : { content, etag: etags.get(path) ?? '' };
    },
    async write(path, content) {
      binaries.delete(path);
      blobs.set(path, content);
      return { etag: stampPath(path) };
    },
    async writeIfMatch(path, content, ifMatch) {
      if (!blobs.has(path) || etags.get(path) !== ifMatch) return null;
      binaries.delete(path);
      blobs.set(path, content);
      return { etag: stampPath(path) };
    },
    async readBytes(path) {
      const raw = binaries.get(path);
      if (raw) return { ...raw, etag: etags.get(path) ?? '' };
      const content = blobs.get(path);
      return content === undefined
        ? null
        : {
            data: new TextEncoder().encode(content),
            contentType: 'text/plain; charset=utf-8',
            etag: etags.get(path) ?? '',
          };
    },
    async writeBytes(path, data, contentType) {
      binaries.set(path, { data, contentType });
      // The text view decodes the same bytes — a blob store has ONE copy.
      blobs.set(path, new TextDecoder().decode(data));
      return { etag: stampPath(path) };
    },
    async delete(path) {
      binaries.delete(path);
      etags.delete(path);
      return blobs.delete(path);
    },
    async list(prefix) {
      const out: FileStat[] = [];
      for (const [path, content] of blobs) {
        if (path.startsWith(prefix)) {
          out.push({ path, size: content.length, lastModified: '2026-08-05T00:00:00.000Z', etag: 'e' });
        }
      }
      return out;
    },
  };
  return { provider, blobs };
}

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

  it('U263: creating a workspace writes exactly one manifest blob under its own prefix, creator as Owner', async () => {
    const id = await createWorkspace('ada', 'Layout proof');
    // Blob layout (Req 7): the manifest is at workspaces/<id>/manifest.json —
    // a per-workspace prefix in the container, and nothing else was written.
    expect([...blobs.keys()]).toEqual([`workspaces/${id}/manifest.json`]);
    const read = await call('ada', 'GET', `/api/workspaces/${id}/manifest`);
    expect(read.status).toBe(200);
    const { manifest } = (await read.json()) as { manifest: WorkspaceManifest };
    expect(manifest.name).toBe('Layout proof');
    expect(manifest.members).toEqual([{ id: 'mock-ada', role: 'Owner' }]);
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

  it('U269: raw workspace blobs round-trip bytes, are served with an extension-derived type, and stay permission-checked', async () => {
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

  it('U270: an <img>-shaped GET authenticates with ?access_token=, but a write with one stays 401', async () => {
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

  it('U271: per-user blobs are scoped to the token, invisible to other users and to the /api/files scaffold', async () => {
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

  it('U301: move/rename routes each check exactly one verb, carry a folder\'s contents, and never clobber', async () => {
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

  it('U302: an empty folder survives as a placeholder blob, and deleting one needs folder.manage', async () => {
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

  it('U303: upload and download check their own verb, and the server re-applies the size/type rule', async () => {
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

  it('U304: a save carrying a stale ETag is refused 412 with the stored content untouched', async () => {
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
});
