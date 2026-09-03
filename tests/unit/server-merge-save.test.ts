import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { createMockAuthProvider } from '../../server/providers/mock/auth';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import type { StorageProvider } from '../../server/providers/types';
import { createMemoryStorage } from './storage-contract';
import { hostedFilesRoot } from '../../src/lib/hostedPaths';
import { storeToken } from '../../src/lib/hostedGate';
import { createHostedPlatform } from '../../src/platform/hosted';
import { SaveConflictError } from '../../src/lib/saveConflict';

// PRD 016 Reqs 7–9: the save route's merge decision, over HTTP, against the
// in-memory reference provider — the blob-backed shape, with no version
// history at all. The merge base rides in the request body, so no test in
// this file needs (or has) a backend that can resolve versions.

interface Harness {
  /** The test server's origin, for the hosted platform's relative fetches. */
  base: string;
  /** The signed-in session's bearer token. */
  token: string;
  call: (method: string, path: string, body?: string, headers?: Record<string, string>) => Promise<Response>;
  /** Create a workspace through the API and return its id. */
  workspace: () => Promise<string>;
  close: () => Promise<void>;
}

/** One app over the given storage provider (the memory reference by default). */
async function harness(storage?: StorageProvider): Promise<Harness> {
  const provider = storage ?? createMemoryStorage().provider;
  const auth = createMockAuthProvider();
  const server: Server = createServer(
    createApp('/nonexistent-static', { auth, storage: provider, directory: createMockDirectoryProvider() }, 'local'),
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
    async workspace() {
      const created = (await (await call('POST', '/api/workspaces', JSON.stringify({ name: 'Seed' }))).json()) as {
        id: string;
      };
      return created.id;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Save `text` conditionally on `etag`, the way the hosted platform does. */
const conditionalSave = (h: Harness, id: string, file: string, text: string, etag: string): Promise<Response> =>
  h.call('PUT', `/api/workspaces/${id}/files/${file}`, text, { 'If-Match': etag });

const readFile = async (h: Harness, id: string, file: string): Promise<{ content: string; etag: string }> =>
  (await (await h.call('GET', `/api/workspaces/${id}/files/${file}`)).json()) as { content: string; etag: string };

/** Save conditionally WITH the base text, the PRD 016 Req 7 JSON body. */
const conditionalSaveWithBase = (
  h: Harness,
  id: string,
  file: string,
  text: string,
  base: string,
  etag: string,
): Promise<Response> =>
  h.call('PUT', `/api/workspaces/${id}/files/${file}`, JSON.stringify({ content: text, base }), {
    'If-Match': etag,
    'Content-Type': 'application/json',
  });

describe('PRD 016 Reqs 7+8 merge-on-save with a client-supplied base', () => {
  let h: Harness;
  let id = '';
  beforeAll(async () => {
    h = await harness();
    id = await h.workspace();
  });
  afterAll(() => h.close());

  it('U792: a stale save that carries its base merges on the blob-shaped provider — 200 {path, etag, merged, content}', async () => {
    const file = 'notes.md';
    await h.call('PUT', `/api/workspaces/${id}/files/${file}`, 'alpha\nbeta\ngamma\n');
    const loaded = await readFile(h, id, file);

    // Someone else saves first — different line region.
    expect((await conditionalSave(h, id, file, 'alpha\nbeta\nGAMMA\n', loaded.etag)).status).toBe(200);

    const res = await conditionalSaveWithBase(h, id, file, 'ALPHA\nbeta\ngamma\n', loaded.content, loaded.etag);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; etag: string; merged?: boolean; content?: string };
    expect(body.merged).toBe(true);
    expect(body.path).toBe(file);
    expect(body.content).toBe('ALPHA\nbeta\nGAMMA\n');
    expect(body.etag).not.toBe(loaded.etag);

    // The merged text is what was stored, at the etag the answer carried.
    const now = await readFile(h, id, file);
    expect(now.content).toBe('ALPHA\nbeta\nGAMMA\n');
    expect(now.etag).toBe(body.etag);
  });

  it('U793: a conflicting merge and a guard-refused merge each answer 412 with the stored content untouched', async () => {
    const file = 'clash.md';
    await h.call('PUT', `/api/workspaces/${id}/files/${file}`, 'the shared line\n');
    const loaded = await readFile(h, id, file);
    expect((await conditionalSave(h, id, file, 'their line\n', loaded.etag)).status).toBe(200);

    const res = await conditionalSaveWithBase(h, id, file, 'my line\n', loaded.content, loaded.etag);
    expect(res.status).toBe(412);
    expect(await res.json()).toEqual({
      error: 'the file changed on the server since it was loaded',
      path: file,
    });
    expect((await readFile(h, id, file)).content).toBe('their line\n');

    // The structured-file guard: a clean LINE merge of a .json that no longer
    // parses is refused the same way, base or no base.
    const sidecar = 'doc.comments.json';
    await h.call('PUT', `/api/workspaces/${id}/files/${sidecar}`, '{\n  "a": 1,\n  "b": 2\n}\n');
    const jsonLoaded = await readFile(h, id, sidecar);
    const theirs = '{\n  "a": 10,\n  "b": 2\n}\n';
    expect((await conditionalSave(h, id, sidecar, theirs, jsonLoaded.etag)).status).toBe(200);
    const ours = '{\n  "a": 1,\n  "b": 2,\n}\n'; // a stray trailing comma
    const guarded = await conditionalSaveWithBase(h, id, sidecar, ours, jsonLoaded.content, jsonLoaded.etag);
    expect(guarded.status).toBe(412);
    expect((await readFile(h, id, sidecar)).content).toBe(theirs);
  });

  it('U794: the wire shape — a save without base still 412s stale, a JSON body without If-Match overwrites, malformed JSON is 400', async () => {
    const file = 'shape.md';
    await h.call('PUT', `/api/workspaces/${id}/files/${file}`, 'one\n');
    const loaded = await readFile(h, id, file);
    expect((await conditionalSave(h, id, file, 'two\n', loaded.etag)).status).toBe(200);

    // Stale bare-text save (no base anywhere): today's plain 412, verbatim.
    const bare = await conditionalSave(h, id, file, 'mine\n', loaded.etag);
    expect(bare.status).toBe(412);
    // Stale JSON save that omits base: the same 412 — base is optional, never guessed.
    const noBase = await h.call('PUT', `/api/workspaces/${id}/files/${file}`, JSON.stringify({ content: 'mine\n' }), {
      'If-Match': loaded.etag,
      'Content-Type': 'application/json',
    });
    expect(noBase.status).toBe(412);
    expect((await readFile(h, id, file)).content).toBe('two\n');

    // The JSON shape without If-Match is a deliberate overwrite like any other.
    const overwrite = await h.call(
      'PUT',
      `/api/workspaces/${id}/files/${file}`,
      JSON.stringify({ content: 'json overwrite\n', base: 'ignored\n' }),
      { 'Content-Type': 'application/json' },
    );
    expect(overwrite.status).toBe(200);
    expect(Object.keys((await overwrite.json()) as object).sort()).toEqual(['etag', 'path']);
    expect((await readFile(h, id, file)).content).toBe('json overwrite\n');

    // A JSON-typed body that is not {content: string} is refused, not stored.
    const before = await readFile(h, id, file);
    for (const bad of ['not json at all', JSON.stringify({ base: 'x\n' }), JSON.stringify({ content: 7 })]) {
      const res = await h.call('PUT', `/api/workspaces/${id}/files/${file}`, bad, {
        'Content-Type': 'application/json',
      });
      expect(res.status).toBe(400);
    }
    expect((await readFile(h, id, file)).content).toBe(before.content);
  });

  it('U795: a merged write that keeps losing the race stops at the bound and answers 412 — never an unconditional write', async () => {
    const inner = createMemoryStorage();
    let attempts = 0;
    // Every conditional write loses, so the merge loop can never land.
    const racy: StorageProvider = {
      ...inner.provider,
      kind: 'always-loses-blob',
      read: (path) => inner.provider.read(path),
      async writeIfMatch(): Promise<null> {
        attempts += 1;
        return null;
      },
    };
    const racyHarness = await harness(racy);
    const racyId = await racyHarness.workspace();
    await racyHarness.call('PUT', `/api/workspaces/${racyId}/files/race.md`, 'alpha\nbeta\n');
    const loaded = await readFile(racyHarness, racyId, 'race.md');

    const res = await conditionalSaveWithBase(racyHarness, racyId, 'race.md', 'ALPHA\nbeta\n', loaded.content, loaded.etag);
    expect(res.status).toBe(412);
    // One attempt for the original conditional write, then a bounded number
    // of merged writes — not an unbounded loop.
    expect(attempts).toBeGreaterThan(1);
    expect(attempts).toBeLessThanOrEqual(4);
    expect((await inner.provider.read(`workspaces/${racyId}/files/race.md`))?.content).toBe('alpha\nbeta\n');
    await racyHarness.close();
  });
});

describe('PRD 016 Req 9 the hosted platform’s handling of a merged save', () => {
  it('U796: the platform sends the base it loaded, so a stale save merges; a conflicting save still throws', async () => {
    const h = await harness();
    const id = await h.workspace();
    const file = `${hostedFilesRoot(id)}/notes.md`;
    await h.call('PUT', `/api/workspaces/${id}/files/notes.md`, 'alpha\nbeta\ngamma\n');

    // The hosted platform talks same-origin relative URLs to `fetch`, reads
    // its bearer token from localStorage, and takes the PRD 019 scratch-boot
    // signal from sessionStorage (empty here: no scratchpad visit) — the only
    // globals it needs, stubbed here and restored afterwards.
    const realFetch = globalThis.fetch;
    const realWindow = (globalThis as { window?: unknown }).window;
    const kv = new Map<string, string>();
    storeToken({ getItem: (k) => kv.get(k) ?? null, setItem: (k, v) => kv.set(k, v), removeItem: (k) => kv.delete(k) }, h.token);
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (k: string) => kv.get(k) ?? null, setItem: () => {}, removeItem: () => {} },
      sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
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
      // Reading arms both the version tag AND the base text.
      expect(await platform.readTextFile(file)).toBe('alpha\nbeta\ngamma\n');
      // Someone else saves first, on a different line region.
      const loaded = await readFile(h, id, 'notes.md');
      expect((await conditionalSave(h, id, 'notes.md', 'alpha\nbeta\nGAMMA\n', loaded.etag)).status).toBe(200);

      const written = await platform.writeTextFile(file, 'ALPHA\nbeta\ngamma\n');
      expect(written).toEqual({ merged: true, content: 'ALPHA\nbeta\nGAMMA\n' });
      // Both the etag and the base re-armed from what LANDED — the merged
      // text — so the next save is conditional on the merge and lands clean.
      const again = await platform.writeTextFile(file, 'ALPHA\nbeta\nGAMMA\nnew tail\n');
      expect(again).toBeUndefined();

      // A conflicting save still throws SaveConflictError — the dialog path.
      const now = await readFile(h, id, 'notes.md');
      expect((await conditionalSave(h, id, 'notes.md', 'ALPHA\nbeta\nGAMMA\ntheir tail\n', now.etag)).status).toBe(200);
      await expect(platform.writeTextFile(file, 'ALPHA\nbeta\nGAMMA\nmy tail\n')).rejects.toBeInstanceOf(
        SaveConflictError,
      );
      // And the refused save left the stored content untouched.
      expect((await readFile(h, id, 'notes.md')).content).toBe('ALPHA\nbeta\nGAMMA\ntheir tail\n');
    } finally {
      globalThis.fetch = realFetch;
      (globalThis as { window?: unknown }).window = realWindow;
      await h.close();
    }
  });
});
