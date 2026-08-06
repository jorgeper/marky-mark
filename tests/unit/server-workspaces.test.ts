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
  const provider: StorageProvider = {
    kind: 'memory',
    async read(path) {
      const content = blobs.get(path);
      return content === undefined ? null : { content, etag: `e${path.length}` };
    },
    async write(path, content) {
      binaries.delete(path);
      blobs.set(path, content);
      return { etag: `e${++stamp}` };
    },
    async readBytes(path) {
      const raw = binaries.get(path);
      if (raw) return { ...raw, etag: `b${path.length}` };
      const content = blobs.get(path);
      return content === undefined
        ? null
        : { data: new TextEncoder().encode(content), contentType: 'text/plain; charset=utf-8', etag: `e${path.length}` };
    },
    async writeBytes(path, data, contentType) {
      binaries.set(path, { data, contentType });
      blobs.set(path, `<${data.length} bytes>`);
      return { etag: `b${++stamp}` };
    },
    async delete(path) {
      binaries.delete(path);
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
    expect(first.members).toEqual([
      { id: 'mock-ada', role: 'Owner' },
      { id: 'mock-grace', role: 'Viewer' },
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
    expect(second.members[1]).toEqual({ id: 'mock-grace', role: 'Editor' });
    // Creation is immutable; the modification stamp is the server's.
    expect(second.created).toBe(first.created);
    expect(Date.parse(second.modified)).toBeGreaterThanOrEqual(Date.parse(first.created));
    expect((await call('grace', 'PUT', `/api/workspaces/${id}/files/a.md`, 'x')).status).toBe(200);

    const removed = await call('ada', 'DELETE', `/api/workspaces/${id}/members/mock-grace`);
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { manifest: WorkspaceManifest }).manifest.members).toEqual([
      { id: 'mock-ada', role: 'Owner' },
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
    expect(after.members[1]).toEqual({ id: 'mock-grace', role: 'Auditor' });
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
});
