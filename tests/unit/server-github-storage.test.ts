import { Buffer } from 'node:buffer';
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createGitHubAppAuth } from '../../server/providers/github/auth';
import { createGitHubFake, type FakeCommit } from '../../server/providers/github/fake';
import { APP_COMMIT_IDENTITY, createGitHubStorageProvider } from '../../server/providers/github/storage';
import type { AuthUser, StorageProvider } from '../../server/providers/types';
import { FOLDER_PLACEHOLDER } from '../../server/workspaces';
import { describeStorageContract, PNG_BYTES } from './storage-contract';

// PRD 010 Req 2+7+8+9+10+11: the GitHub-backed StorageProvider. Every
// assertion here runs against the local fake (server/providers/github/fake.ts)
// — no test in this file touches the network, and the suite passes offline.

const { privateKey: PRIVATE_KEY_PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const APP_ID = '424242';
const BASE = 'https://api.example.test';
const OWNER = 'marky-org';
const REPO = 'workspace-store';
const BRANCH = 'main';
const ROOT = 'store';
const CLOCK = Date.parse('2026-08-07T12:00:00Z');
const CACHE_TTL_MS = 5_000;

const ADA: AuthUser = { id: 'u-ada', username: 'ada@marky.test', displayName: 'Ada Lovelace' };
const GRACE: AuthUser = { id: 'u-grace', username: 'grace@marky.test', displayName: 'Grace Hopper' };

/** A fake repo plus a provider pointed at it, sharing one injectable clock. */
function setup(): {
  fake: ReturnType<typeof createGitHubFake>;
  provider: StorageProvider;
  tick: (ms: number) => void;
  repoPath: (path: string) => string;
} {
  let clock = CLOCK;
  const now = (): number => clock;
  const fake = createGitHubFake({
    appId: APP_ID,
    now,
    installations: [
      { id: 7, account: OWNER, repos: [{ owner: OWNER, repo: REPO, branch: BRANCH, files: { 'README.md': '# store\n' } }] },
    ],
  });
  const auth = createGitHubAppAuth({
    appId: APP_ID,
    privateKey: PRIVATE_KEY_PEM,
    apiBase: BASE,
    fetchImpl: fake.fetch,
    now,
  });
  const provider = createGitHubStorageProvider({
    owner: OWNER,
    repo: REPO,
    branch: BRANCH,
    root: ROOT,
    auth,
    now,
    cacheTtlMs: CACHE_TTL_MS,
  });
  return { fake, provider, tick: (ms) => (clock += ms), repoPath: (path) => `${ROOT}/${path}` };
}

/** The commits a mutation added, newest last. */
function commitsSince(fake: ReturnType<typeof createGitHubFake>, before: number): FakeCommit[] {
  return fake.commits(OWNER, REPO).slice(before);
}

// PRD 010 Req 22: the seam contract, unchanged, over a GitHub repo branch.
// U383–U391 is this run's block of ids.
describeStorageContract({
  label: 'the GitHub repo provider',
  firstId: 383,
  create: () => setup().provider,
});

describe('PRD 010 Req 2 the GitHub provider behind the existing seam', () => {
  it('U392: constructing performs no I/O, and seam paths land under the configured root without leaking the repo', async () => {
    const { fake, provider, repoPath } = setup();
    // Nothing was dialled by the factory itself — not even an installation
    // lookup — so wiring the provider in costs nothing until it is used.
    expect(fake.requests).toEqual([]);
    expect(provider.kind).toBe('github-repo');

    const id = '8f1e2d3c-0000-4444-8888-abcdefabcdef';
    await provider.write(`workspaces/${id}/manifest.json`, '{"id":"x"}\n');
    await provider.write(`workspaces/${id}/files/notes.md`, '# notes\n');
    await provider.write('users/u-ada/recent.json', '[]\n');

    // The repo-relative paths are the seam's paths under the root prefix.
    expect(fake.file(OWNER, REPO, repoPath(`workspaces/${id}/files/notes.md`))).toBe('# notes\n');
    expect(fake.file(OWNER, REPO, repoPath('users/u-ada/recent.json'))).toBe('[]\n');

    // And what comes back out carries no owner, repo, branch or root.
    const listed = (await provider.list('')).map((f) => f.path).sort();
    expect(listed).toEqual([`users/u-ada/recent.json`, `workspaces/${id}/files/notes.md`, `workspaces/${id}/manifest.json`]);
    for (const path of listed) {
      expect(path.startsWith(`${ROOT}/`)).toBe(false);
      expect(path).not.toContain(OWNER);
      expect(path).not.toContain(REPO);
    }
    // A file outside the root is none of the seam's business.
    expect(await provider.read('README.md')).toBeNull();
  });
});

describe('PRD 010 Req 7 one commit per mutation, attributed to the acting user', () => {
  it('U393: a save, an upload, a folder marker and a delete each land exactly one commit naming the action and the path', async () => {
    const { fake, provider, repoPath } = setup();
    const asAda = provider.asUser!(ADA);
    const before = fake.commits(OWNER, REPO).length;

    await asAda.write('workspaces/w1/files/notes.md', '# notes\n');
    expect(commitsSince(fake, before)).toHaveLength(1);

    await asAda.writeBytes('workspaces/w1/files/assets/shot.png', PNG_BYTES, 'image/png');
    expect(commitsSince(fake, before)).toHaveLength(2);

    // PRD 010 Req 9: an empty folder is the same `.mmkeep` marker as on blob
    // storage — an ordinary committed file, no GitHub-specific marker.
    await asAda.write(`workspaces/w1/files/empty/${FOLDER_PLACEHOLDER}`, '');
    expect(commitsSince(fake, before)).toHaveLength(3);

    await asAda.delete('workspaces/w1/files/notes.md');
    const added = commitsSince(fake, before);
    expect(added).toHaveLength(4);

    expect(added.map((c) => c.message)).toEqual([
      `Save ${repoPath('workspaces/w1/files/notes.md')}`,
      `Upload ${repoPath('workspaces/w1/files/assets/shot.png')}`,
      `Save ${repoPath(`workspaces/w1/files/empty/${FOLDER_PLACEHOLDER}`)}`,
      `Delete ${repoPath('workspaces/w1/files/notes.md')}`,
    ]);
    // The signed-in user authored every one; the app committed them.
    for (const commit of added) {
      expect(commit.author).toEqual({ name: 'Ada Lovelace', email: 'ada@marky.test' });
      expect(commit.committer).toEqual(APP_COMMIT_IDENTITY);
    }
    // The marker is a real committed file at the folder path.
    expect(fake.file(OWNER, REPO, repoPath(`workspaces/w1/files/empty/${FOLDER_PLACEHOLDER}`))).toBe('');
  });

  it('U394: two concurrent writes by different users are never cross-attributed, and a call with no acting user still commits as the app', async () => {
    const { fake, provider } = setup();
    const before = fake.commits(OWNER, REPO).length;

    // PRD 010 Req 7: the acting user rides on the view, not on a module
    // global — so two writes in flight at once cannot swap identities.
    await Promise.all([
      provider.asUser!(ADA).write('workspaces/w1/files/ada.md', 'a\n'),
      provider.asUser!(GRACE).write('workspaces/w1/files/grace.md', 'g\n'),
      provider.asUser!(ADA).write('workspaces/w1/files/ada-two.md', 'a2\n'),
    ]);
    const byPath = new Map(commitsSince(fake, before).map((c) => [c.message.split('/').pop(), c.author?.name]));
    expect(byPath.get('ada.md')).toBe('Ada Lovelace');
    expect(byPath.get('ada-two.md')).toBe('Ada Lovelace');
    expect(byPath.get('grace.md')).toBe('Grace Hopper');

    // No acting user, and a user with no display name, both still commit.
    await provider.write('workspaces/w1/files/system.md', 's\n');
    await provider.asUser!({ id: 'u-x', username: 'x', displayName: '   ' }).write('workspaces/w1/files/anon.md', 'x\n');
    const tail = commitsSince(fake, before).slice(-2);
    expect(tail.map((c) => c.author)).toEqual([APP_COMMIT_IDENTITY, APP_COMMIT_IDENTITY]);
    expect(await provider.read('workspaces/w1/files/anon.md')).not.toBeNull();
  });
});

describe('PRD 010 Req 8 ETag semantics over a repo branch', () => {
  it('U395: the etag is the opaque blob sha GitHub adjudicates against — a stale conditional write answers null, an unconditional one overwrites', async () => {
    const { fake, provider, repoPath } = setup();
    const path = 'workspaces/w1/files/notes.md';
    const first = await provider.write(path, 'one\n');
    // Opaque to every caller, but it IS the blob sha GitHub stores — which
    // is what lets GitHub itself decide the conditional write.
    expect(first.etag).toMatch(/^[0-9a-f]{40}$/);

    // Changed out of band, exactly as another member's save would.
    fake.setFile(OWNER, REPO, repoPath(path), 'somebody else\n');
    const puts = fake.count('PUT', `contents/${repoPath(path)}`);
    expect(await provider.writeIfMatch(path, 'mine\n', first.etag)).toBeNull();
    // One PUT, refused by GitHub with a 409 — no retry that would overwrite.
    expect(fake.count('PUT', `contents/${repoPath(path)}`)).toBe(puts + 1);
    expect(fake.file(OWNER, REPO, repoPath(path))).toBe('somebody else\n');

    // The unconditional path is a deliberate overwrite and still lands.
    const forced = await provider.write(path, 'mine\n');
    expect(forced.etag).not.toBe(first.etag);
    expect(fake.file(OWNER, REPO, repoPath(path))).toBe('mine\n');
    // And a conditional write with the etag just written succeeds.
    expect(await provider.writeIfMatch(path, 'mine again\n', forced.etag)).not.toBeNull();
  });
});

describe('PRD 010 Req 9 folder markers, listings and byte fidelity', () => {
  it('U396: a listing carries populated stats for every blob including .mmkeep, and no repo directory leaks in as a file', async () => {
    const { fake, provider, repoPath } = setup();
    await provider.write('workspaces/w1/files/notes.md', '# notes\n');
    await provider.write(`workspaces/w1/files/empty/${FOLDER_PLACEHOLDER}`, '');
    await provider.writeBytes('workspaces/w1/files/assets/shot.png', PNG_BYTES, 'image/png');

    const listed = await provider.list('workspaces/w1/files/');
    expect(listed.map((f) => f.path).sort()).toEqual([
      'workspaces/w1/files/assets/shot.png',
      `workspaces/w1/files/empty/${FOLDER_PLACEHOLDER}`,
      'workspaces/w1/files/notes.md',
    ]);
    const png = listed.find((f) => f.path.endsWith('.png'))!;
    expect(png.size).toBe(PNG_BYTES.length);
    expect(png.etag).toMatch(/^[0-9a-f]{40}$/);
    expect(png.lastModified).toBe(new Date(CLOCK).toISOString());
    // The marker is a zero-byte file, not a special case.
    expect(listed.find((f) => f.path.endsWith(FOLDER_PLACEHOLDER))!.size).toBe(0);
    // `workspaces/w1/files/assets` is a tree in the repo and appears nowhere.
    expect(listed.some((f) => f.path === 'workspaces/w1/files/assets')).toBe(false);
    expect(listed.some((f) => f.path.endsWith('/'))).toBe(false);

    // PRD 010 Req 9: byte-identical, and the type comes from the extension
    // because GitHub stores none.
    const stored = await provider.readBytes('workspaces/w1/files/assets/shot.png');
    expect(Buffer.from(stored!.data).equals(Buffer.from(PNG_BYTES))).toBe(true);
    expect(stored!.contentType).toBe('image/png');
    expect([...fake.fileBytes(OWNER, REPO, repoPath('workspaces/w1/files/assets/shot.png'))!]).toEqual([...PNG_BYTES]);
  });
});

describe('PRD 010 Req 10 server-side caching without stale write decisions', () => {
  it('U397: a cache-hit read costs zero GitHub requests, a moved head stops the cache serving superseded content', async () => {
    const { fake, provider, tick, repoPath } = setup();
    const path = 'workspaces/w1/files/notes.md';
    await provider.write(path, 'one\n');
    expect((await provider.read(path))?.content).toBe('one\n');

    const primed = fake.requests.length;
    expect((await provider.read(path))?.content).toBe('one\n');
    expect((await provider.list('workspaces/w1/files/'))).toHaveLength(1);
    expect(fake.requests.length).toBe(primed);

    // The branch head moves behind the provider's back. Past the revalidation
    // window the ref comparison catches it and the superseded content goes.
    fake.setFile(OWNER, REPO, repoPath(path), 'somebody else\n');
    tick(CACHE_TTL_MS + 1);
    expect((await provider.read(path))?.content).toBe('somebody else\n');
  });

  it('U398: a conditional write is never decided from cache — a file changed behind the cache still answers null, and the next read shows the new head', async () => {
    const { fake, provider, repoPath } = setup();
    const path = 'workspaces/w1/files/notes.md';
    const first = await provider.write(path, 'one\n');
    // Prime the cache so it genuinely believes `first.etag` is current.
    expect((await provider.read(path))?.etag).toBe(first.etag);

    fake.setFile(OWNER, REPO, repoPath(path), 'somebody else\n');
    // Still inside the cache window: the cache is stale, the decision is not.
    expect(await provider.writeIfMatch(path, 'mine\n', first.etag)).toBeNull();
    expect(fake.file(OWNER, REPO, repoPath(path))).toBe('somebody else\n');
    // → 412 for the client, and the very next read reflects the new head.
    expect((await provider.read(path))?.content).toBe('somebody else\n');
  });
});

describe('PRD 010 Req 11 rate limits and transient failures', () => {
  it('U399: a rate limit and a transient 5xx throw promptly, name the status and the operation, leave the repo unchanged and leak no credential', async () => {
    const { fake, provider, repoPath } = setup();
    const path = 'workspaces/w1/files/notes.md';
    await provider.write(path, 'one\n');
    const commits = fake.commits(OWNER, REPO).length;

    // The call returns (throws) rather than hanging or retrying forever:
    // an unresolved promise here would fail this test by timeout.
    fake.queueRateLimit();
    const limited = await provider.write(path, 'two\n').catch((err: Error) => err);
    expect(limited).toBeInstanceOf(Error);
    expect((limited as Error).message).toContain('403');
    expect((limited as Error).message).toContain('rate limit');
    expect((limited as Error).message).toContain(repoPath(path));

    fake.queueServerError(502);
    const broken = await provider.write(path, 'two\n').catch((err: Error) => err);
    expect((broken as Error).message).toContain('502');
    expect((broken as Error).message).toContain('GitHub is unavailable');

    // Neither failure wrote anything, and neither is a silent success.
    expect(fake.file(OWNER, REPO, repoPath(path))).toBe('one\n');
    expect(fake.commits(OWNER, REPO)).toHaveLength(commits);

    // No credential of any kind appears in what the operator will read.
    for (const message of [(limited as Error).message, (broken as Error).message]) {
      for (const token of fake.mintedTokens) expect(message).not.toContain(token);
      expect(message).not.toContain('PRIVATE KEY');
      expect(message).not.toContain('Bearer');
    }

    // A failure is transient by definition: the next write works.
    await provider.write(path, 'two\n');
    expect(fake.file(OWNER, REPO, repoPath(path))).toBe('two\n');
  });
});
