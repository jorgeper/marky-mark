import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { createMockAuthProvider } from '../../server/providers/mock/auth';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import type { StorageProvider } from '../../server/providers/types';
import { scratchpadPointerBlob } from '../../server/workspaces';
import { DEPLOYMENT_SETTINGS_BLOB } from '../../src/lib/deploymentSettings';
import { parseWorkspaceManifest, type WorkspaceManifest } from '../../src/lib/hostedWorkspace';
import { createMemoryStorage } from './storage-contract';

// PRD 019 Reqs 5–7: the scratchpad resolve-or-create endpoint, proven
// offline at the HTTP layer exactly like server-workspaces.test.ts —
// createApp wired to the in-memory storage seam and the mock auth provider.

/** An opaque server-generated UUID (PRD 007 Req 7 / PRD 019 Req 6). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('PRD 019 Reqs 5–7 scratchpad resolution over HTTP', () => {
  const { provider, blobs } = createMemoryStorage();
  // PRD 019 Req 5's race, made deterministic: while a gate is armed, reads
  // of one path park until `expected` callers have all arrived, then every
  // parked read proceeds — so two concurrent resolves BOTH observe "no
  // record yet" and both take the create path. Released once; the loser's
  // reconciliation re-read passes straight through.
  let gate: { path: string; expected: number; waiting: (() => void)[] } | null = null;
  const storage: StorageProvider = {
    ...provider,
    read(path) {
      const armed = gate;
      if (armed && path === armed.path) {
        return new Promise((resolve) => {
          armed.waiting.push(() => resolve(provider.read(path)));
          if (armed.waiting.length === armed.expected) {
            gate = null;
            for (const release of armed.waiting) release();
          }
        });
      }
      return provider.read(path);
    },
  };
  const auth = createMockAuthProvider();
  let server: Server;
  let base = '';
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    server = createServer(
      createApp('/nonexistent-static', { auth, storage, directory: createMockDirectoryProvider() }, 'local'),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const username of ['ada', 'grace', 'alan', 'mary']) {
      const result = await auth.signIn({ username });
      if (result?.kind !== 'token') throw new Error('mock sign-in failed');
      tokens[username] = result.token;
    }
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const call = (user: string, method: string, path: string, body?: string): Promise<Response> =>
    fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${tokens[user]}` }, body });

  const resolveScratchpad = async (user: string): Promise<string> => {
    const res = await call(user, 'POST', '/api/me/scratchpad');
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    return id;
  };

  /** The manifests under workspaces/ whose sole member is `userId`. */
  const manifestsOwnedBy = (userId: string): { id: string; manifest: WorkspaceManifest }[] => {
    const out: { id: string; manifest: WorkspaceManifest }[] = [];
    for (const [path, content] of blobs) {
      const id = /^workspaces\/([^/]+)\/manifest\.json$/.exec(path)?.[1];
      if (!id) continue;
      const parsed = parseWorkspaceManifest(content);
      if (parsed.ok && parsed.manifest.members.some((m) => m.id === userId)) {
        out.push({ id, manifest: parsed.manifest });
      }
    }
    return out;
  };

  it('U1025: resolve-or-create is idempotent — two sequential calls answer one id, exactly one manifest exists', async () => {
    const first = await resolveScratchpad('grace');
    const second = await resolveScratchpad('grace');
    expect(second).toBe(first);
    // Exactly one workspace was created, and the id is recorded in the
    // caller's per-user storage (PRD 019 Req 5's users/<id>/… record).
    expect(manifestsOwnedBy('mock-grace').map((w) => w.id)).toEqual([first]);
    const pointer = blobs.get(scratchpadPointerBlob('mock-grace'));
    expect(pointer).toBeDefined();
    expect(JSON.parse(pointer!)).toEqual({ workspaceId: first });
    blobs.clear();
  });

  it('U1026: the scratchpad is a real workspace — opaque UUID id, normal manifest, caller as sole Owner, named Scratchpad', async () => {
    const id = await resolveScratchpad('ada');
    // Opaque server-generated UUID (PRD 019 Req 6), nothing user-derived.
    expect(id).toMatch(UUID_RE);
    const owned = manifestsOwnedBy('mock-ada');
    expect(owned.map((w) => w.id)).toEqual([id]);
    const { manifest } = owned[0];
    expect(manifest.name).toBe('Scratchpad');
    // Sole Owner, display name snapshotted from the caller's own token —
    // the same shape POST /api/workspaces stamps for a creator.
    expect(manifest.members).toEqual([{ id: 'mock-ada', role: 'Owner', displayName: 'Ada Lovelace' }]);
    // And the standard workspace API serves it like any other workspace.
    const read = await call('ada', 'GET', `/api/workspaces/${id}/manifest`);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { id: string }).id).toBe(id);
    blobs.clear();
  });

  it('U1027: two concurrent first calls yield exactly one scratchpad — same id, no orphan manifest', async () => {
    // Both resolves must read "no record yet" before either can write one:
    // the gate parks the two pointer reads until both have arrived.
    gate = { path: scratchpadPointerBlob('mock-alan'), expected: 2, waiting: [] };
    const [a, b] = await Promise.all([resolveScratchpad('alan'), resolveScratchpad('alan')]);
    expect(b).toBe(a);
    // Exactly one workspace survives — the loser deleted its orphan.
    expect(manifestsOwnedBy('mock-alan').map((w) => w.id)).toEqual([a]);
    expect(JSON.parse(blobs.get(scratchpadPointerBlob('mock-alan'))!)).toEqual({ workspaceId: a });
    blobs.clear();
  });

  it('U1028: resolution bypasses the deployment creation policy — a guest under `members` gets a scratchpad while regular creation stays 403', async () => {
    // PRD 017 Req 8's `members` policy denies guests a New Workspace…
    await provider.write(
      DEPLOYMENT_SETTINGS_BLOB,
      JSON.stringify({ version: 1, creation: { policy: 'members', allow: [] }, listing: { policy: 'everyone' } }),
    );
    try {
      const denied = await call('mary', 'POST', '/api/workspaces', JSON.stringify({ name: 'Nope' }));
      expect(denied.status).toBe(403);
      expect(((await denied.json()) as { required: string }).required).toBe('deployment.create');
      // …but scratchpad provisioning succeeds for the same caller (Req 7).
      const id = await resolveScratchpad('mary');
      const owned = manifestsOwnedBy('mock-mary');
      expect(owned.map((w) => w.id)).toEqual([id]);
      expect(owned[0].manifest.members).toEqual([{ id: 'mock-mary', role: 'Owner', displayName: 'Mary Jackson' }]);
    } finally {
      blobs.clear();
    }
  });
});
