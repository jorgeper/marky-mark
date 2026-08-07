import { createServer, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { backendRecordPath, createWorkspaceBackends, parseWorkspaceBackend } from '../../server/backends';
import { loadConfig } from '../../server/config';
import {
  MANIFEST_REPO_PATH,
  METADATA_DIR,
  workspaceRepoPath,
  workspaceSeamPath,
} from '../../server/providers/github/byo';
import { createGitHubFake } from '../../server/providers/github/fake';
import { createProviders, createRepoConnector } from '../../server/providers/index';
import { createMockAuthProvider } from '../../server/providers/mock/auth';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import { StoragePathError, type StorageProvider } from '../../server/providers/types';
import { createMemoryStorage } from './storage-contract';

// PRD 010 Req 17: bring your own repo — the server-side connection record
// becoming a live backend, and the human-readable layout it serves through.
// A BYO workspace's documents are normal markdown files at the connected
// branch+root; only `<root>/.marky-mark/` is app metadata. Every GitHub call
// here goes to server/providers/github/fake.ts: nothing in this file touches
// the network, and the suite passes offline.

const { privateKey: PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const APP_ID = '424242';
const BASE = 'https://api.example.test';
const OWNER = 'ada';
const REPO = 'handbook';

/**
 * A blob-default deployment that nonetheless has the App section configured —
 * exactly the coexistence case Req 17 asks for. No `MM_STORAGE_BACKEND`, no
 * `MM_GITHUB_DEFAULT_REPO`: BYO does not depend on either.
 */
const BYO_ENV = {
  MM_GITHUB_APP_ID: APP_ID,
  MM_GITHUB_PRIVATE_KEY: PEM,
  MM_GITHUB_API_BASE: BASE,
};

type GitHubFake = ReturnType<typeof createGitHubFake>;

/** A fake holding the user's own repo, seeded with content they already had. */
function fakeWith(options: { permissions?: Record<string, string> } = {}): GitHubFake {
  return createGitHubFake({
    appId: APP_ID,
    installations: [
      {
        id: 11,
        account: OWNER,
        ...(options.permissions ? { permissions: options.permissions } : {}),
        repos: [
          { owner: OWNER, repo: REPO, files: { 'README.md': '# handbook\n', 'docs/existing.md': '# already here\n' } },
        ],
      },
    ],
  });
}

/** The `connect` hook as `server/index.ts` builds it, aimed at the fake. */
const connectorFor = (fake: GitHubFake) => createRepoConnector(loadConfig(BYO_ENV), { fetchImpl: fake.fetch })!;

const repoRecord = (root?: string) =>
  ({ kind: 'repo', owner: OWNER, repo: REPO, branch: 'main', ...(root === undefined ? {} : { root }) }) as const;

describe('PRD 010 Req 17 the seam→repo path mapping', () => {
  const id = 'ws-0000';

  it('U415: a document maps to its plain repo path, the manifest to .marky-mark/, and both map back', () => {
    // The human-readable half: no id in the path, no files/ segment, no
    // mangling, no encoding.
    expect(workspaceRepoPath(id, `workspaces/${id}/files/plan.md`)).toBe('plan.md');
    expect(workspaceRepoPath(id, `workspaces/${id}/files/notes/2026/plan.md`)).toBe('notes/2026/plan.md');
    expect(workspaceRepoPath(id, `workspaces/${id}/files/.mmkeep`)).toBe('.mmkeep');
    // App metadata, all of it under one directory at the connected root.
    expect(workspaceRepoPath(id, `workspaces/${id}/manifest.json`)).toBe(MANIFEST_REPO_PATH);
    expect(MANIFEST_REPO_PATH).toBe(`${METADATA_DIR}/manifest.json`);

    // Bidirectional and total, so a listing can answer in seam paths.
    for (const seam of [
      `workspaces/${id}/files/plan.md`,
      `workspaces/${id}/files/notes/2026/plan.md`,
      `workspaces/${id}/files/.mmkeep`,
      `workspaces/${id}/manifest.json`,
    ]) {
      expect(workspaceSeamPath(id, workspaceRepoPath(id, seam))).toBe(seam);
    }
    expect(workspaceSeamPath(id, 'notes/plan.md')).toBe(`workspaces/${id}/files/notes/plan.md`);
    expect(workspaceSeamPath(id, MANIFEST_REPO_PATH)).toBe(`workspaces/${id}/manifest.json`);

    // Only `<root>/.marky-mark/` is metadata: one deeper in the tree is an
    // ordinary file path, mapped and listed like any other.
    expect(workspaceRepoPath(id, `workspaces/${id}/files/sub/${METADATA_DIR}/notes.md`)).toBe(
      `sub/${METADATA_DIR}/notes.md`,
    );
    expect(workspaceSeamPath(id, `sub/${METADATA_DIR}/notes.md`)).toBe(
      `workspaces/${id}/files/sub/${METADATA_DIR}/notes.md`,
    );
  });

  it('U416: an out-of-workspace or root-escaping path is refused, never mapped into the repo', () => {
    for (const seam of [
      'users/u-ada/settings.json', // per-user files are the deployment default's
      'workspaces/other-ws/files/a.md', // another workspace's prefix
      backendRecordPath(id), // the backend record itself
      `workspaces/${id}/files/../../escape.md`,
      `workspaces/${id}/files//a.md`,
      `workspaces/${id}/files/./a.md`,
      `workspaces/${id}/files/`,
      // `.marky-mark/` at the connected root is metadata, not a document.
      `workspaces/${id}/files/${METADATA_DIR}`,
      `workspaces/${id}/files/${METADATA_DIR}/manifest.json`,
      `workspaces/${id}/files/${METADATA_DIR}/anything`,
    ]) {
      expect(() => workspaceRepoPath(id, seam), seam).toThrowError(StoragePathError);
    }
  });
});

describe('PRD 010 Req 17 a repo connection becomes a live backend', () => {
  it('U417: a connected workspace stores documents as plain files at the root, one commit each', async () => {
    const fake = fakeWith();
    const connect = connectorFor(fake);
    const id = 'ws-live';
    const provider = (await connect(repoRecord('docs'), id)) as StorageProvider;
    await provider.init?.();

    await provider.write(`workspaces/${id}/manifest.json`, '{"name":"Handbook"}');
    await provider.write(`workspaces/${id}/files/notes/plan.md`, '# plan\n');

    // The document a user sees as notes/plan.md is committed at
    // <root>/notes/plan.md — readable on GitHub as ordinary markdown.
    expect(fake.file(OWNER, REPO, 'docs/notes/plan.md')).toBe('# plan\n');
    expect(fake.file(OWNER, REPO, `docs/${MANIFEST_REPO_PATH}`)).toBe('{"name":"Handbook"}');
    // Nothing in the repo is named after the workspace — not a path, not a
    // commit message. The id stays app-side.
    for (const commit of fake.commits(OWNER, REPO)) expect(commit.message).not.toContain(id);

    // Existing repo content IS workspace content, by design.
    const listed = (await provider.list(`workspaces/${id}/files/`)).map((f) => f.path).sort();
    expect(listed).toEqual([`workspaces/${id}/files/existing.md`, `workspaces/${id}/files/notes/plan.md`]);
    expect((await provider.read(`workspaces/${id}/files/existing.md`))?.content).toBe('# already here\n');
    // …and only under the connected root: README.md is outside `docs/`.
    expect(listed).not.toContain(`workspaces/${id}/files/README.md`);
  });

  it('U418: an empty root means the whole repo, and .marky-mark/ stays out of the file listing', async () => {
    const fake = fakeWith();
    const id = 'ws-rootless';
    const provider = (await connectorFor(fake)(repoRecord(), id)) as StorageProvider;
    await provider.write(`workspaces/${id}/manifest.json`, '{}');

    expect(fake.file(OWNER, REPO, MANIFEST_REPO_PATH)).toBe('{}');
    const files = (await provider.list(`workspaces/${id}/files/`)).map((f) => f.path).sort();
    expect(files).toEqual([`workspaces/${id}/files/README.md`, `workspaces/${id}/files/docs/existing.md`]);
    // The manifest is reachable by its own seam path, and the sweep behind
    // DELETE (which lists the whole workspace prefix) still sees it.
    const all = (await provider.list(`workspaces/${id}/`)).map((f) => f.path);
    expect(all).toContain(`workspaces/${id}/manifest.json`);
  });

  it('U419: resolving the same workspace repeatedly reuses the connection instead of rebuilding it', async () => {
    const fake = fakeWith();
    const connect = connectorFor(fake);
    const id = 'ws-cached';
    const first = (await connect(repoRecord(), id)) as StorageProvider;
    await first.init?.();
    await first.read(`workspaces/${id}/files/README.md`);
    const after = fake.requests.length;
    expect(after).toBeGreaterThan(0);

    // Ten more resolutions of the same workspace: the installation token and
    // the branch snapshot are #100's and shared, so the request count does
    // not grow with the number of resolutions.
    for (let i = 0; i < 10; i += 1) {
      const again = (await connect(repoRecord(), id)) as StorageProvider;
      await again.read(`workspaces/${id}/files/README.md`);
    }
    expect(fake.requests.length).toBe(after);
  });

  it('U434: the merge capability survives the mapping, so a BYO workspace merges rather than 412s', async () => {
    const fake = fakeWith();
    const id = 'ws-merge';
    const provider = (await connectorFor(fake)(repoRecord('docs'), id)) as StorageProvider;
    const seam = `workspaces/${id}/files/plan.md`;

    // PRD 010 Req 12+14: `server/workspaces.ts` decides "can this workspace
    // merge?" by whether the resolved provider offers `readAtVersion` and by
    // nothing else — so a view that dropped it would silently answer every
    // stale conditional save with a 412, on precisely the git-backed
    // workspaces the merge exists for.
    expect(provider.readAtVersion).toBeDefined();

    await provider.write(seam, '# v1\n');
    const loaded = await provider.read(seam);
    await provider.write(seam, '# v2\n');

    // The version the client loaded is still fetchable however far the branch
    // has moved — through the seam path, mapped to `docs/plan.md`.
    expect(await provider.readAtVersion!(seam, loaded!.etag)).toBe('# v1\n');
    // …and the mapping is enforced here too: another workspace's prefix is a
    // refusal, not a read of someone else's repo path. It refuses the way
    // every other mapped method does — at the mapping, before any I/O.
    expect(() => provider.readAtVersion!(`workspaces/other-ws/files/plan.md`, loaded!.etag)).toThrowError(
      StoragePathError,
    );
  });

  it('U420: a repo record on a deployment with no App configuration keeps the named refusal', async () => {
    // No MM_GITHUB_* at all: nothing to connect with, and saying so is the
    // point — never a silent fallback to the deployment default.
    expect(createRepoConnector(loadConfig({}))).toBeUndefined();
    const { provider: deploymentDefault } = createMemoryStorage();
    const backends = createWorkspaceBackends({ deploymentDefault });
    await backends.remember('ws-orphan', repoRecord());
    await expect(backends.forWorkspace('ws-orphan')).rejects.toThrowError(
      'workspace ws-orphan names a repo backend this deployment cannot connect to',
    );
  });
});

describe('PRD 010 Req 17 BYO and default workspaces over HTTP', () => {
  const fake = fakeWith();
  const { provider: deploymentDefault, blobs } = createMemoryStorage();
  const auth = createMockAuthProvider();
  const backends = createWorkspaceBackends({ deploymentDefault, connect: connectorFor(fake) });
  let server: Server;
  let base = '';
  let token = '';

  beforeAll(async () => {
    server = createServer(
      createApp(
        '/nonexistent-static',
        { auth, storage: deploymentDefault, directory: createMockDirectoryProvider() },
        'local',
        backends,
      ),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const result = await auth.signIn({ username: 'ada' });
    if (result?.kind !== 'token') throw new Error('mock sign-in failed');
    token = result.token;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const call = (method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...headers }, body });

  const create = async (body: unknown): Promise<{ status: number; id?: string }> => {
    const res = await call('POST', '/api/workspaces', JSON.stringify(body));
    const parsed = (await res.json()) as { id?: string; error?: string };
    return { status: res.status, ...parsed };
  };

  it('U421: creating with a repo connection records it server-side and lands the manifest in the repo', async () => {
    const before = fake.commits(OWNER, REPO).length;
    const created = await create({ name: 'Handbook', storage: repoRecord('docs') });
    expect(created.status).toBe(201);
    const id = created.id!;

    // The id is an opaque UUID: nothing about owner/repo/branch/root is in it.
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    for (const part of [OWNER, REPO, 'main', 'docs']) expect(id).not.toContain(part);
    // …and the 201 carries no connection details.
    const body = (await (await call('GET', `/api/workspaces/${id}/manifest`)).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['id', 'manifest']);
    expect(JSON.stringify(body)).not.toContain(REPO);

    // The record went to the deployment default first; the manifest is the
    // repo's, at <root>/.marky-mark/, as one commit.
    expect(parseWorkspaceBackend(blobs.get(backendRecordPath(id))!)).toEqual({ ok: true, record: repoRecord('docs') });
    expect(await deploymentDefault.read(`workspaces/${id}/manifest.json`)).toBeNull();
    expect(fake.file(OWNER, REPO, `docs/${MANIFEST_REPO_PATH}`)).toContain('"name": "Handbook"');
    expect(fake.commits(OWNER, REPO).length).toBe(before + 1);

    // A document saved through the ordinary route lands at the plain repo
    // path, as one commit, with the same opaque ETag round trip as any
    // workspace — and a stale If-Match is still a 412 (merging is #102's).
    const saved = await call('PUT', `/api/workspaces/${id}/files/notes/plan.md`, '# plan\n');
    expect(saved.status).toBe(200);
    expect(fake.file(OWNER, REPO, 'docs/notes/plan.md')).toBe('# plan\n');
    const etag = ((await saved.json()) as { etag: string }).etag;
    expect((await call('PUT', `/api/workspaces/${id}/files/notes/plan.md`, '# v2\n', { 'If-Match': etag })).status).toBe(
      200,
    );
    expect((await call('PUT', `/api/workspaces/${id}/files/notes/plan.md`, '# v3\n', { 'If-Match': etag })).status).toBe(
      412,
    );

    // A file that was already in the repo opens as a workspace document.
    const listed = (await (await call('GET', `/api/workspaces/${id}/files`)).json()) as Array<{ path: string }>;
    expect(listed.map((f) => f.path).sort()).toEqual(['existing.md', 'notes/plan.md']);
    const opened = await (await call('GET', `/api/workspaces/${id}/files/existing.md`)).json();
    expect(opened).toMatchObject({ path: 'existing.md', content: '# already here\n' });

    // `.marky-mark/` is app metadata: never a workspace file, and not
    // reachable — read, written or deleted — through the files routes.
    expect(listed.map((f) => f.path)).not.toContain(`${METADATA_DIR}/manifest.json`);
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await call(
        method,
        `/api/workspaces/${id}/files/${METADATA_DIR}/manifest.json`,
        method === 'PUT' ? 'x' : undefined,
      );
      expect(res.status, `${method} ${METADATA_DIR}`).toBe(400);
    }
    expect(fake.file(OWNER, REPO, `docs/${MANIFEST_REPO_PATH}`)).toContain('"name": "Handbook"');

    // PRD 010 Req 9 unchanged: an empty folder is its `.mmkeep` marker, an
    // ordinary committed file at the plain repo path like any other.
    expect((await call('POST', `/api/workspaces/${id}/folders`, JSON.stringify({ path: 'archive' }))).status).toBe(201);
    expect(fake.file(OWNER, REPO, 'docs/archive/.mmkeep')).toBe('');
    const withFolder = (await (await call('GET', `/api/workspaces/${id}/files`)).json()) as Array<{ path: string }>;
    expect(withFolder.map((f) => f.path)).toContain('archive/.mmkeep');
  });

  it('U422: a malformed connection is a 400 naming the field, and creates nothing', async () => {
    const recorded = blobs.size;
    const commits = fake.commits(OWNER, REPO).length;
    for (const [storage, error] of [
      [{ kind: 'repo', owner: OWNER, branch: 'main' }, /storage: backend record repo must be a non-empty string/],
      [{ kind: 'gist', owner: OWNER }, /storage: backend record kind must be/],
      ['ada/handbook', /storage: backend record must be an object/],
      [{ kind: 'repo', owner: OWNER, repo: REPO, branch: 'main', root: 7 }, /storage: backend record root must be/],
    ] as const) {
      const res = await call('POST', '/api/workspaces', JSON.stringify({ name: 'Nope', storage }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(error);
    }
    expect(blobs.size).toBe(recorded);
    expect(fake.commits(OWNER, REPO).length).toBe(commits);
  });

  it('U423: an unwritable or unreachable repo answers an actionable failure with nothing written', async () => {
    const recorded = blobs.size;
    const commits = fake.commits(OWNER, REPO).length;

    // Reachable, but the installation grants only contents: read.
    const readOnly = createWorkspaceBackends({
      deploymentDefault,
      connect: connectorFor(fakeWith({ permissions: { contents: 'read', metadata: 'read' } })),
    });
    await expect(
      readOnly.connect(repoRecord(), 'ws-x').then((p) => p.init?.()),
    ).rejects.toThrowError(/is not writable: the App installation grants contents: read/);

    // Unreachable: the App is not installed on that repo — over HTTP, a 400
    // from `githubFailureDetail`'s existing vocabulary.
    const missing = await call(
      'POST',
      '/api/workspaces',
      JSON.stringify({ name: 'Nope', storage: { kind: 'repo', owner: OWNER, repo: 'not-mine', branch: 'main' } }),
    );
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toMatch(
      /installation lookup for ada\/not-mine failed: 404 — not found, or the App is not installed/,
    );

    // GitHub itself failing is a 502, not a 400 — and still writes nothing.
    fake.queueServerError(503);
    const unavailable = await call('POST', '/api/workspaces', JSON.stringify({ name: 'Nope', storage: repoRecord() }));
    expect(unavailable.status).toBe(502);
    expect(((await unavailable.json()) as { error: string }).error).toMatch(/503 — GitHub is unavailable/);

    // No record, no manifest, no commit left behind by any of the three.
    expect(blobs.size).toBe(recorded);
    expect(fake.commits(OWNER, REPO).length).toBe(commits);
  });

  it('U424: BYO and default workspaces coexist — both listed, opened, saved and deleted', async () => {
    const plain = await create({ name: 'On the default store' });
    const byo = await create({ name: 'On my repo', storage: repoRecord('team') });
    expect([plain.status, byo.status]).toEqual([201, 201]);

    // The listing is the union of the manifest scan and the backend records:
    // the BYO workspace has no manifest in the deployment default at all.
    const rows = (await (await call('GET', '/api/workspaces')).json()) as Array<{ id: string; name: string }>;
    const named = new Map(rows.map((r) => [r.id, r.name]));
    expect(named.get(plain.id!)).toBe('On the default store');
    expect(named.get(byo.id!)).toBe('On my repo');

    // Each is saved into its own store, and neither touches the other's.
    await call('PUT', `/api/workspaces/${plain.id}/files/a.md`, '# default');
    await call('PUT', `/api/workspaces/${byo.id}/files/a.md`, '# repo');
    expect((await deploymentDefault.read(`workspaces/${plain.id}/files/a.md`))?.content).toBe('# default');
    expect(fake.file(OWNER, REPO, 'team/a.md')).toBe('# repo');
    expect(await deploymentDefault.read(`workspaces/${byo.id}/files/a.md`)).toBeNull();

    // Deleting the BYO workspace sweeps the connected root (files and its
    // `.marky-mark/`) and forgets the record — and touches nothing outside
    // that root: `docs/` and `README.md` survive untouched.
    expect((await call('DELETE', `/api/workspaces/${byo.id}`)).status).toBe(200);
    expect(fake.file(OWNER, REPO, 'team/a.md')).toBeUndefined();
    expect(fake.file(OWNER, REPO, `team/${MANIFEST_REPO_PATH}`)).toBeUndefined();
    expect(fake.file(OWNER, REPO, 'README.md')).toBe('# handbook\n');
    expect(blobs.get(backendRecordPath(byo.id!))).toBeUndefined();

    // The default one is untouched by that, and deletes normally itself.
    const left = (await (await call('GET', '/api/workspaces')).json()) as Array<{ id: string }>;
    expect(left.map((r) => r.id)).toContain(plain.id);
    expect((await call('DELETE', `/api/workspaces/${plain.id}`)).status).toBe(200);
    expect(blobs.get(backendRecordPath(plain.id!))).toBeUndefined();
    expect(await deploymentDefault.read(`workspaces/${plain.id}/files/a.md`)).toBeNull();
  });

  it('U425: per-user files and the legacy /api/files scaffold stay on the deployment default', async () => {
    await call('PUT', '/api/me/files/settings.json', '{"theme":"dark"}');
    expect((await deploymentDefault.read('users/mock-ada/settings.json'))?.content).toBe('{"theme":"dark"}');
    // Nothing of theirs reached the connected repo.
    expect(fake.file(OWNER, REPO, 'users/mock-ada/settings.json')).toBeUndefined();
    // …and the deployment default itself is still the blob-backed store.
    const providers = createProviders(loadConfig(BYO_ENV), { fetchImpl: fake.fetch });
    expect(providers.storage.kind).toBe('azure-blob');
  });
});
