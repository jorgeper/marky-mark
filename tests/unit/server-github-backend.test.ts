import { createServer, type Server } from 'node:http';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import {
  backendRecordPath,
  createWorkspaceBackends,
  serializeWorkspaceBackend,
  validateWorkspaceBackend,
} from '../../server/backends';
import { loadConfig } from '../../server/config';
import { createGitHubAppAuth } from '../../server/providers/github/auth';
import { createGitHubFake } from '../../server/providers/github/fake';
import { assertRepoIsWritable } from '../../server/providers/github/storage';
import { createProviders } from '../../server/providers/index';
import { createMockAuthProvider } from '../../server/providers/mock/auth';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import type { WorkspaceManifest } from '../../src/lib/hostedWorkspace';
import { createMemoryStorage } from './storage-contract';

// PRD 010 Req 1+3+5+6: the last wire — the deployment default reached through
// the backend knob, the per-workspace record request handling resolves through,
// and the startup check that refuses to serve from a repo the App cannot write.
// Every GitHub call here goes to server/providers/github/fake.ts: no test in
// this file touches the network, and the suite passes offline.

const { privateKey: PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const APP_ID = '424242';
const BASE = 'https://api.example.test';
const OWNER = 'marky-org';
const REPO = 'workspace-store';

/** The github backend's environment, with the API base aimed at the fake. */
const GITHUB_ENV = {
  MM_STORAGE_BACKEND: 'github',
  MM_GITHUB_APP_ID: APP_ID,
  MM_GITHUB_PRIVATE_KEY: PEM,
  MM_GITHUB_DEFAULT_REPO: `${OWNER}/${REPO}`,
  MM_GITHUB_API_BASE: BASE,
};
const AZURE_ENV = { MM_MODE: 'azure', ENTRA_TENANT_ID: 't', ENTRA_CLIENT_ID: 'c' };

/** A fake holding the default repo, optionally with a narrowed grant. */
function fakeWith(options: { repos?: boolean; permissions?: Record<string, string> } = {}): ReturnType<
  typeof createGitHubFake
> {
  return createGitHubFake({
    appId: APP_ID,
    installations: [
      {
        id: 7,
        account: OWNER,
        ...(options.permissions ? { permissions: options.permissions } : {}),
        repos: options.repos === false ? [] : [{ owner: OWNER, repo: REPO, files: { 'README.md': '# store\n' } }],
      },
    ],
  });
}

describe('PRD 010 Req 5 wiring the deployment default', () => {
  it('U404: a github-backend config with no storage connection string wires the GitHub provider, mode-driven auth intact', () => {
    const fake = fakeWith();
    // No AZURE_STORAGE_CONNECTION_STRING in either environment: were the blob
    // client still built unconditionally, wiring would fail before the config
    // error could ever be reached.
    const local = createProviders(loadConfig(GITHUB_ENV), { fetchImpl: fake.fetch });
    expect([local.auth.kind, local.storage.kind, local.directory.kind]).toEqual(['mock', 'github-repo', 'mock']);
    const azure = createProviders(loadConfig({ ...AZURE_ENV, ...GITHUB_ENV }), { fetchImpl: fake.fetch });
    expect([azure.auth.kind, azure.storage.kind, azure.directory.kind]).toEqual(['entra', 'github-repo', 'graph']);
    // Constructing performs no I/O — auth and directory selection are still
    // MM_MODE's alone, and neither backend has spoken to GitHub yet.
    expect(fake.requests).toEqual([]);
  });

  it('U405: the default repo mirrors today\'s layout on one branch — workspaces/<uuid>/… and users/… under the root', async () => {
    const fake = fakeWith();
    const providers = createProviders(loadConfig({ ...GITHUB_ENV, MM_GITHUB_DEFAULT_ROOT: '/store/' }), {
      fetchImpl: fake.fetch,
    });
    await providers.storage.init?.();
    const id = randomUUID();
    await providers.storage.write(`workspaces/${id}/manifest.json`, '{"name":"Docs"}');
    await providers.storage.write(`workspaces/${id}/files/notes/a.md`, '# hi\n');
    await providers.storage.write('users/u-ada/settings.json', '{}');
    // The seam path IS the repo path under the configured root: no per-
    // workspace branch, no path mangling, no id translation.
    expect(fake.file(OWNER, REPO, `store/workspaces/${id}/manifest.json`)).toBe('{"name":"Docs"}');
    expect(fake.file(OWNER, REPO, `store/workspaces/${id}/files/notes/a.md`)).toBe('# hi\n');
    expect(fake.file(OWNER, REPO, 'store/users/u-ada/settings.json')).toBe('{}');
    // One branch for all of it — every commit landed on main.
    expect(fake.commits(OWNER, REPO).length).toBe(4);
  });
});

describe('PRD 010 Req 6 startup validation of the default repo', () => {
  /** Startup as `server/index.ts` performs it: init() before any listener. */
  const startup = (fake: ReturnType<typeof createGitHubFake>, env: Record<string, string> = GITHUB_ENV) =>
    createProviders(loadConfig(env), { fetchImpl: fake.fetch }).storage.init?.();

  /** The same check, called directly — no server, no provider in between. */
  const validate = (fake: ReturnType<typeof createGitHubFake>) =>
    assertRepoIsWritable(
      createGitHubAppAuth({ appId: APP_ID, privateKey: PEM, apiBase: BASE, fetchImpl: fake.fetch }),
      OWNER,
      REPO,
    );

  it('U406: a reachable repo whose installation grants contents write starts, and asks GitHub once', async () => {
    const fake = fakeWith();
    await expect(startup(fake)).resolves.toBeUndefined();
    expect(fake.count('GET', `/repos/${OWNER}/${REPO}/installation`)).toBe(1);
  });

  it('U407: an absent repo (or an App not installed on it) fails fast, naming the repo and never a credential', async () => {
    const fake = fakeWith({ repos: false });
    const error = await validate(fake).then(
      () => new Error('expected startup to refuse an unreachable repo'),
      (err: Error) => err,
    );
    expect(error.message).toMatch(`installation lookup for ${OWNER}/${REPO} failed: 404`);
    expect(error.message).toMatch(/not found, or the App is not installed on that repository/);
    // No App JWT, no installation token, no key material in the message.
    expect(error.message).not.toContain(PEM.split('\n')[1]);
    for (const token of fake.mintedTokens) expect(error.message).not.toContain(token);
  });

  it('U408: an installation granting only contents: read fails fast, saying what to grant', async () => {
    const fake = fakeWith({ permissions: { contents: 'read', metadata: 'read' } });
    const error = await validate(fake).then(
      () => new Error('expected startup to refuse a read-only installation'),
      (err: Error) => err,
    );
    expect(error.message).toBe(
      `GitHub default repository ${OWNER}/${REPO} is not writable: the App installation grants ` +
        'contents: read — grant it Repository permissions → Contents: Read and write, ' +
        'then accept the updated permissions on the installation',
    );
  });

  it('U409: a transient GitHub 5xx fails fast rather than starting anyway', async () => {
    const fake = fakeWith();
    fake.queueServerError(503);
    await expect(validate(fake)).rejects.toThrowError(/failed: 503 — GitHub is unavailable/);
  });

  it('U410: the blob backend makes ZERO GitHub requests at startup', async () => {
    const fake = fakeWith();
    // The App section is configured and simply not selected — the knob, not
    // the credentials, is what decides.
    const providers = createProviders(loadConfig({ ...GITHUB_ENV, MM_STORAGE_BACKEND: 'blob' }), {
      fetchImpl: fake.fetch,
    });
    // Its init() is Azurite's container check, which needs a storage
    // emulator this suite deliberately does not run; what matters here is
    // that nothing on the blob path can reach GitHub at all — no GitHub
    // provider is constructed, so no request can exist to log.
    expect(providers.storage.kind).toBe('azure-blob');
    expect(fake.requests).toEqual([]);
  });
});

describe('PRD 010 Req 3 the per-workspace backend record', () => {
  it('U411: the record is parsed by a typed validator that rejects malformed data by name', () => {
    expect(validateWorkspaceBackend({ kind: 'deployment-default' })).toEqual({
      ok: true,
      record: { kind: 'deployment-default' },
    });
    // The shape #103 fills in validates too — this issue creates none.
    expect(validateWorkspaceBackend({ kind: 'repo', owner: 'o', repo: 'r', branch: 'main', root: 'docs' })).toEqual({
      ok: true,
      record: { kind: 'repo', owner: 'o', repo: 'r', branch: 'main', root: 'docs' },
    });
    for (const [value, error] of [
      ['blob', /must be an object/],
      [{}, /kind must be 'deployment-default' or 'repo', got undefined/],
      [{ kind: 'gist' }, /got 'gist'/],
      [{ kind: 'repo', owner: 'o', branch: 'main' }, /repo must be a non-empty string/],
      [{ kind: 'repo', owner: 'o', repo: 'r', branch: 'main', root: 7 }, /root must be a string/],
    ] as const) {
      const result = validateWorkspaceBackend(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(error);
    }
  });

  it('U412: a record naming another backend is served from it; no record is the deployment default', async () => {
    const { provider: deploymentDefault, blobs: defaultBlobs } = createMemoryStorage();
    const { provider: elsewhere, blobs: otherBlobs } = createMemoryStorage();
    let connected = 0;
    const backends = createWorkspaceBackends({
      deploymentDefault,
      // The seam #103 supplies a connection through — no new plumbing there.
      connect: (record, id) => {
        expect(record).toEqual({ kind: 'repo', owner: OWNER, repo: REPO, branch: 'main' });
        expect(id).toBe('byo');
        connected += 1;
        return elsewhere;
      },
    });
    await backends.remember('byo', { kind: 'repo', owner: OWNER, repo: REPO, branch: 'main' });
    await backends.remember('here', { kind: 'deployment-default' });
    expect(await backends.forWorkspace('byo')).toBe(elsewhere);
    expect(await backends.forWorkspace('here')).toBe(deploymentDefault);
    // Every workspace an existing deployment already has: no record at all.
    expect(await backends.forWorkspace('legacy')).toBe(deploymentDefault);
    expect(connected).toBe(1);
    // The record lives in the deployment default, never in the workspace's
    // own store — it has to be readable before that store is known.
    expect([...defaultBlobs.keys()].sort()).toEqual([backendRecordPath('byo'), backendRecordPath('here')]);
    expect([...otherBlobs.keys()]).toEqual([]);
    // A damaged record is refused, not coerced into the default.
    await deploymentDefault.write(backendRecordPath('broken'), '{oops');
    await expect(backends.forWorkspace('broken')).rejects.toThrowError(
      /corrupt workspace backend record: backend record is not valid JSON/,
    );
    await backends.forget('byo');
    expect(await backends.forWorkspace('byo')).toBe(deploymentDefault);
  });
});

describe('PRD 010 Req 3 the backend record over HTTP', () => {
  const { provider: deploymentDefault, blobs } = createMemoryStorage();
  const { provider: elsewhere } = createMemoryStorage();
  const auth = createMockAuthProvider();
  const backends = createWorkspaceBackends({ deploymentDefault, connect: () => elsewhere });
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

  const call = (method: string, path: string, body?: string): Promise<Response> =>
    fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, body });

  it('U413: creating a workspace records its backend outside files/, and nothing in the client can see it', async () => {
    const created = await call('POST', '/api/workspaces', JSON.stringify({ name: 'Records' }));
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    expect(blobs.get(backendRecordPath(id))).toBe(serializeWorkspaceBackend({ kind: 'deployment-default' }));

    // Not in the file listing (it is outside files/), not a row of its own in
    // the workspace listing, and not reachable through the files routes.
    await call('PUT', `/api/workspaces/${id}/files/a.md`, '# hi');
    expect(await (await call('GET', `/api/workspaces/${id}/files`)).json()).toEqual([
      expect.objectContaining({ path: 'a.md' }),
    ]);
    const rows = (await (await call('GET', '/api/workspaces')).json()) as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.id)).toEqual([id]);
    // No API response gains a backend field.
    expect(Object.keys(rows[0]).sort()).toEqual(['access', 'created', 'id', 'modified', 'name', 'owners']);
    const manifest = (await (await call('GET', `/api/workspaces/${id}/manifest`)).json()) as {
      manifest: WorkspaceManifest;
    };
    expect(Object.keys(manifest.manifest)).not.toContain('backend');
    for (const path of ['backend.json', '..%2Fbackend.json', '../backend.json']) {
      expect((await call('GET', `/api/workspaces/${id}/files/${path}`)).status).not.toBe(200);
    }

    // Deleting the workspace takes the record with it — nothing orphaned.
    expect((await call('DELETE', `/api/workspaces/${id}`)).status).toBe(200);
    expect([...blobs.keys()]).toEqual([]);
  });

  it('U414: a workspace whose record names another backend is served entirely from that backend', async () => {
    // The record is the ONLY thing in the deployment default: the manifest and
    // the files are the other backend's, and requests still answer normally.
    const id = 'elsewhere-1';
    await backends.remember(id, { kind: 'repo', owner: OWNER, repo: REPO, branch: 'main' });
    const built = await call('POST', '/api/workspaces', JSON.stringify({ name: 'Seed' }));
    const seededId = ((await built.json()) as { id: string }).id;
    const seeded = await (await call('GET', `/api/workspaces/${seededId}/manifest`)).json();
    await elsewhere.write(
      `workspaces/${id}/manifest.json`,
      JSON.stringify((seeded as { manifest: WorkspaceManifest }).manifest),
    );
    await call('PUT', `/api/workspaces/${id}/files/only-here.md`, '# elsewhere');

    expect(await (await call('GET', `/api/workspaces/${id}/files`)).json()).toEqual([
      expect.objectContaining({ path: 'only-here.md' }),
    ]);
    expect((await elsewhere.read(`workspaces/${id}/files/only-here.md`))?.content).toBe('# elsewhere');
    expect(await deploymentDefault.read(`workspaces/${id}/files/only-here.md`)).toBeNull();
    // Per-user files stay on the deployment default whatever a workspace says.
    await call('PUT', '/api/me/files/settings.json', '{"theme":"dark"}');
    expect((await deploymentDefault.read('users/mock-ada/settings.json'))?.content).toBe('{"theme":"dark"}');
  });
});
