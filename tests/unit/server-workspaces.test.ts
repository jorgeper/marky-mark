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
  let stamp = 0;
  const provider: StorageProvider = {
    kind: 'memory',
    async read(path) {
      const content = blobs.get(path);
      return content === undefined ? null : { content, etag: `e${path.length}` };
    },
    async write(path, content) {
      blobs.set(path, content);
      return { etag: `e${++stamp}` };
    },
    async delete(path) {
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
});
