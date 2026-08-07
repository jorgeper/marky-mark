import { createServer, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { createWorkspaceBackends } from '../../server/backends';
import { createGitHubAppAuth } from '../../server/providers/github/auth';
import { createGitHubFake } from '../../server/providers/github/fake';
import { createGitHubStorageProvider } from '../../server/providers/github/storage';
import { createMockAuthProvider } from '../../server/providers/mock/auth';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import type { StorageProvider } from '../../server/providers/types';
import type { WorkspaceManifest } from '../../src/lib/hostedWorkspace';
import { createMemoryStorage } from './storage-contract';
import { hostedFilesRoot } from '../../src/lib/hostedPaths';
import { storeToken } from '../../src/lib/hostedGate';
import { createHostedPlatform } from '../../src/platform/hosted';
import { SaveConflictError } from '../../src/lib/saveConflict';

// PRD 010 Req 12+14: the save route's merge decision, over HTTP. The
// git-backed half runs against server/providers/github/fake.ts — no test in
// this file touches the network — and the blob-backed half runs against the
// in-memory reference provider, which offers no merge capability at all.

const { privateKey: PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const APP_ID = '424242';
const BASE = 'https://api.example.test';
const OWNER = 'marky-org';
const REPO = 'workspace-store';
const BRANCH = 'main';

/** A GitHub-backed StorageProvider aimed at a local fake repo. */
function gitHubBacked(): StorageProvider {
  const fake = createGitHubFake({
    appId: APP_ID,
    installations: [
      { id: 7, account: OWNER, repos: [{ owner: OWNER, repo: REPO, branch: BRANCH, files: { 'README.md': '# store\n' } }] },
    ],
  });
  const auth = createGitHubAppAuth({ appId: APP_ID, privateKey: PEM, apiBase: BASE, fetchImpl: fake.fetch });
  return createGitHubStorageProvider({ owner: OWNER, repo: REPO, branch: BRANCH, auth });
}

interface Harness {
  /** The test server's origin, for the hosted platform's relative fetches. */
  base: string;
  /** The signed-in session's bearer token. */
  token: string;
  call: (method: string, path: string, body?: string, headers?: Record<string, string>) => Promise<Response>;
  /** Create a workspace served by `elsewhere`, and return its id. */
  workspaceOn: (elsewhere: StorageProvider, id: string) => Promise<string>;
  close: () => Promise<void>;
}

/** One app whose per-workspace backend is whatever the record names. */
async function harness(): Promise<Harness> {
  const { provider: deploymentDefault } = createMemoryStorage();
  const auth = createMockAuthProvider();
  const connections = new Map<string, StorageProvider>();
  const backends = createWorkspaceBackends({
    deploymentDefault,
    connect: (_record, id) => connections.get(id)!,
  });
  const server: Server = createServer(
    createApp(
      '/nonexistent-static',
      { auth, storage: deploymentDefault, directory: createMockDirectoryProvider() },
      'local',
      backends,
    ),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const signIn = await auth.signIn({ username: 'ada' });
  if (signIn?.kind !== 'token') throw new Error('mock sign-in failed');
  const token = signIn.token;

  const call: Harness['call'] = (method, path, body, headers) =>
    fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...headers }, body });

  return {
    base,
    token,
    call,
    async workspaceOn(elsewhere, id) {
      connections.set(id, elsewhere);
      await backends.remember(id, { kind: 'repo', owner: OWNER, repo: REPO, branch: BRANCH });
      // A real manifest, minted by the API and planted in the workspace's own
      // backend — the same shape U414 uses.
      const seededId = ((await (await call('POST', '/api/workspaces', JSON.stringify({ name: 'Seed' }))).json()) as {
        id: string;
      }).id;
      const seeded = (await (await call('GET', `/api/workspaces/${seededId}/manifest`)).json()) as {
        manifest: WorkspaceManifest;
      };
      await elsewhere.write(`workspaces/${id}/manifest.json`, JSON.stringify(seeded.manifest));
      return id;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Save `text` conditionally on `etag`, the way the hosted platform does. */
const conditionalSave = (h: Harness, id: string, file: string, text: string, etag: string): Promise<Response> =>
  h.call('PUT', `/api/workspaces/${id}/files/${file}`, text, { 'If-Match': etag });

const readFile = async (h: Harness, id: string, file: string): Promise<{ content: string; etag: string }> =>
  (await (await h.call('GET', `/api/workspaces/${id}/files/${file}`)).json()) as { content: string; etag: string };

describe('PRD 010 Req 12 merge-on-save over HTTP, git-backed', () => {
  let h: Harness;
  let id = '';
  beforeAll(async () => {
    h = await harness();
    id = await h.workspaceOn(gitHubBacked(), 'gh-merge');
  });
  afterAll(() => h.close());

  it('U426: a stale conditional save whose changes do not overlap is merged, committed and answered 200', async () => {
    const file = 'notes.md';
    await h.call('PUT', `/api/workspaces/${id}/files/${file}`, '# Notes\n\nalpha\nbeta\ngamma\n');
    const loaded = await readFile(h, id, file);

    // Someone else saves first — the version our client holds is now stale.
    const theirs = await conditionalSave(h, id, file, '# Notes\n\nalpha\nbeta\nGAMMA\n', loaded.etag);
    expect(theirs.status).toBe(200);

    // Our client saves against the version it loaded. Different line region:
    // the server merges rather than refusing.
    const res = await conditionalSave(h, id, file, '# Notes\n\nALPHA\nbeta\ngamma\n', loaded.etag);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; etag: string; merged?: boolean; content?: string };
    expect(body.merged).toBe(true);
    expect(body.path).toBe(file);
    // Both sides' changes are in the answer, and it carries the NEW token.
    expect(body.content).toBe('# Notes\n\nALPHA\nbeta\nGAMMA\n');
    expect(body.etag).not.toBe(loaded.etag);

    // The merged text is what was committed, and the token it answered with
    // is the one a fresh read now reports — so the next conditional save is
    // guarded against the merge, not against the version it superseded.
    const now = await readFile(h, id, file);
    expect(now.content).toBe('# Notes\n\nALPHA\nbeta\nGAMMA\n');
    expect(now.etag).toBe(body.etag);
  });

  it('U427: a stale conditional save that conflicts answers today’s 412, byte-for-byte', async () => {
    const file = 'clash.md';
    await h.call('PUT', `/api/workspaces/${id}/files/${file}`, '# Clash\n\nthe shared line\n');
    const loaded = await readFile(h, id, file);
    expect((await conditionalSave(h, id, file, '# Clash\n\ntheir line\n', loaded.etag)).status).toBe(200);

    const res = await conditionalSave(h, id, file, '# Clash\n\nmy line\n', loaded.etag);
    expect(res.status).toBe(412);
    // The client's existing dialog path keys off exactly this body.
    expect(await res.json()).toEqual({
      error: 'the file changed on the server since it was loaded',
      path: file,
    });
    // Nothing was written: the save that won is still what the repo holds.
    expect((await readFile(h, id, file)).content).toBe('# Clash\n\ntheir line\n');
  });

  it('U428: a version token the backend cannot resolve is a 412, never a guess', async () => {
    const file = 'unknown-base.md';
    await h.call('PUT', `/api/workspaces/${id}/files/${file}`, 'first\n');
    // A syntactically plausible sha that names no blob in the repo.
    const res = await conditionalSave(h, id, file, 'second\n', 'f'.repeat(40));
    expect(res.status).toBe(412);
    expect((await readFile(h, id, file)).content).toBe('first\n');
  });

  it('U429: a clean line merge whose result is not valid JSON is refused, not committed', async () => {
    // A LINE merge knows nothing about syntax. Here the two sides touch
    // different lines — clean by every rule the merge has — and the result
    // still does not parse. The comment sidecars are .json files
    // (src/lib/sidecar.ts), so committing this would leave a store the app
    // can no longer read; the guard turns it back into today's 412 instead.
    const file = 'sidecar.json';
    await h.call('PUT', `/api/workspaces/${id}/files/${file}`, '{\n  "a": 1,\n  "b": 2\n}\n');
    const loaded = await readFile(h, id, file);
    const theirs = '{\n  "a": 10,\n  "b": 2\n}\n';
    expect((await conditionalSave(h, id, file, theirs, loaded.etag)).status).toBe(200);

    const ours = '{\n  "a": 1,\n  "b": 2,\n}\n'; // a stray trailing comma
    const res = await conditionalSave(h, id, file, ours, loaded.etag);
    expect(res.status).toBe(412);
    expect((await readFile(h, id, file)).content).toBe(theirs);

    // The same merge on a path that is NOT structured lands, so the refusal
    // above is the guard and not the merge failing.
    const md = 'guard.md';
    await h.call('PUT', `/api/workspaces/${id}/files/${md}`, '{\n  "a": 1,\n  "b": 2\n}\n');
    const mdLoaded = await readFile(h, id, md);
    expect((await conditionalSave(h, id, md, theirs, mdLoaded.etag)).status).toBe(200);
    const mdRes = await conditionalSave(h, id, md, ours, mdLoaded.etag);
    expect(mdRes.status).toBe(200);
    expect(((await mdRes.json()) as { merged?: boolean }).merged).toBe(true);
  });

  it('U430: writes the merge must not touch — ?raw and a write with no If-Match — keep their own path', async () => {
    const file = 'raw.md';
    await h.call('PUT', `/api/workspaces/${id}/files/${file}`, 'one\n');
    // No If-Match: a deliberate overwrite (this is the user's Overwrite
    // choice). It lands as written, with no merged flag anywhere.
    const plain = await h.call('PUT', `/api/workspaces/${id}/files/${file}`, 'mine only\n');
    expect(plain.status).toBe(200);
    expect(Object.keys((await plain.json()) as object).sort()).toEqual(['etag', 'path']);
    expect((await readFile(h, id, file)).content).toBe('mine only\n');

    // The raw-bytes route writes bytes and answers path+etag, nothing else.
    const raw = await h.call('PUT', `/api/workspaces/${id}/files/${file}?raw`, 'raw bytes\n');
    expect(raw.status).toBe(200);
    expect(Object.keys((await raw.json()) as object).sort()).toEqual(['etag', 'path']);
  });
});

describe('PRD 010 Req 12 the bounded retry', () => {
  /**
   * A merge-capable provider whose conditional write ALWAYS loses. It exists
   * to prove the read-merge-write is bounded: the route must give up with a
   * 412 rather than loop, and must never fall back to an unconditional write.
   */
  function alwaysLoses(inner: StorageProvider, base: string): { provider: StorageProvider; attempts: () => number } {
    let attempts = 0;
    return {
      attempts: () => attempts,
      provider: {
        ...inner,
        kind: 'always-loses',
        read: (path) => inner.read(path),
        readAtVersion: async (_path, _version) => base,
        async writeIfMatch(): Promise<null> {
          attempts += 1;
          return null;
        },
      },
    };
  }

  it('U431: a merged commit that keeps losing the race stops at the bound and answers 412', async () => {
    const h = await harness();
    const { provider: memory } = createMemoryStorage();
    const racy = alwaysLoses(memory, 'alpha\nbeta\n');
    const id = await h.workspaceOn(racy.provider, 'racy');
    await h.call('PUT', `/api/workspaces/${id}/files/race.md`, 'alpha\nbeta\n');
    const loaded = await readFile(h, id, 'race.md');

    const res = await conditionalSave(h, id, 'race.md', 'ALPHA\nbeta\n', loaded.etag);
    expect(res.status).toBe(412);
    // One attempt for the original conditional write, then a BOUNDED number
    // of merged commits — not an unbounded loop.
    expect(racy.attempts()).toBeGreaterThan(1);
    expect(racy.attempts()).toBeLessThanOrEqual(4);
    // And the stored content is untouched — no unconditional fallback.
    expect((await memory.read(`workspaces/${id}/files/race.md`))?.content).toBe('alpha\nbeta\n');
    await h.close();
  });
});

describe('PRD 010 Req 14 blob-backed workspaces, verbatim', () => {
  it('U432: a provider with no merge capability answers every stale conditional save with a plain 412', async () => {
    const h = await harness();
    const { provider: memory } = createMemoryStorage();
    // The reference provider is the blob-backed shape: no readAtVersion.
    expect(memory.readAtVersion).toBeUndefined();
    const id = await h.workspaceOn(memory, 'blob-ws');
    const file = 'notes.md';
    await h.call('PUT', `/api/workspaces/${id}/files/${file}`, 'alpha\nbeta\ngamma\n');
    const loaded = await readFile(h, id, file);

    // The very edit that MERGES on a git-backed workspace (U426) — a
    // different line region entirely — is a plain 412 here.
    expect((await conditionalSave(h, id, file, 'alpha\nbeta\nGAMMA\n', loaded.etag)).status).toBe(200);
    const res = await conditionalSave(h, id, file, 'ALPHA\nbeta\ngamma\n', loaded.etag);
    expect(res.status).toBe(412);
    expect(await res.json()).toEqual({
      error: 'the file changed on the server since it was loaded',
      path: file,
    });
    // The merged flag never appears in any response on this backend.
    const ok = await h.call('PUT', `/api/workspaces/${id}/files/${file}`, 'unconditional\n');
    expect(Object.keys((await ok.json()) as object).sort()).toEqual(['etag', 'path']);
    await h.close();
  });
});

describe('PRD 010 Req 13 the hosted platform’s handling of a merged save', () => {
  it('U433: a merged 200 re-arms the tracked etag and reports the merged text; a 412 still throws', async () => {
    const h = await harness();
    const id = await h.workspaceOn(gitHubBacked(), 'gh-client');
    const file = `${hostedFilesRoot(id)}/notes.md`;
    await h.call('PUT', `/api/workspaces/${id}/files/notes.md`, 'alpha\nbeta\ngamma\n');

    // The hosted platform talks same-origin relative URLs to `fetch` and
    // reads its bearer token from localStorage — the only two globals it
    // needs, stubbed here and restored afterwards.
    const realFetch = globalThis.fetch;
    const realWindow = (globalThis as { window?: unknown }).window;
    const store = new Map<string, string>();
    storeToken({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, h.token);
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: () => {}, removeItem: () => {} },
      location: { search: `?workspace=${id}` },
    };
    // Relative (same-origin) paths get the test server's origin; anything
    // already absolute — the harness's own calls — passes straight through.
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      return realFetch(url.startsWith('http') ? url : `${h.base}${url}`, init);
    }) as typeof fetch;
    try {
      const platform = createHostedPlatform();
      // Reading arms the version tag this session will save against.
      expect(await platform.readTextFile(file)).toBe('alpha\nbeta\ngamma\n');
      // Someone else saves first, on a different line region.
      const loaded = await readFile(h, id, 'notes.md');
      expect((await conditionalSave(h, id, 'notes.md', 'alpha\nbeta\nGAMMA\n', loaded.etag)).status).toBe(200);

      const written = await platform.writeTextFile(file, 'ALPHA\nbeta\ngamma\n');
      expect(written).toEqual({ merged: true, content: 'ALPHA\nbeta\nGAMMA\n' });
      // The etag was re-armed from the MERGED version, so the next
      // conditional save is guarded against it and lands without merging.
      const again = await platform.writeTextFile(file, 'ALPHA\nbeta\nGAMMA\nnew tail\n');
      expect(again).toBeUndefined();

      // A conflicting save still throws SaveConflictError — the dialog path.
      const now = await readFile(h, id, 'notes.md');
      expect((await conditionalSave(h, id, 'notes.md', 'ALPHA\nbeta\nGAMMA\ntheir tail\n', now.etag)).status).toBe(200);
      await expect(platform.writeTextFile(file, 'ALPHA\nbeta\nGAMMA\nmy tail\n')).rejects.toBeInstanceOf(
        SaveConflictError,
      );
    } finally {
      globalThis.fetch = realFetch;
      (globalThis as { window?: unknown }).window = realWindow;
      await h.close();
    }
  });
});
