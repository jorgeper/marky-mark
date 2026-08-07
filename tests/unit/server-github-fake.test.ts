import { Buffer } from 'node:buffer';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { LANE_FAKE_PORT, LANE_SERVER_PORT } from '../../server/e2eGithubLane';
import { createGitHubAppAuth } from '../../server/providers/github/auth';
import { createGitHubFake } from '../../server/providers/github/fake';

// PRD 010 Req 4: the local GitHub API fake — the only GitHub the repo's tests
// talk to. These pin the surfaces later issues (#100+) build on: seedable
// state, deterministic SHAs, the auth contract it enforces, the injectable
// clock, the scripted rate-limit/5xx answers, and the two shapes it is
// usable in (injectable `fetch` and a `node:http` listener).

const { privateKey: PRIVATE_KEY_PEM, publicKey: PUBLIC_KEY_PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const PUBLIC_KEY = createPublicKey(PUBLIC_KEY_PEM);
const APP_ID = '424242';
const BASE = 'https://api.example.test';
const CLOCK = Date.parse('2026-08-07T12:00:00Z');

function fakeWith(now: () => number = () => CLOCK) {
  return createGitHubFake({
    appId: APP_ID,
    publicKey: PUBLIC_KEY,
    now,
    installations: [
      {
        id: 7,
        account: 'marky-org',
        repos: [
          { owner: 'marky-org', repo: 'docs', files: { 'README.md': '# hello\n', 'notes/one.md': 'one\n' } },
        ],
      },
    ],
  });
}

async function appJwt(now = CLOCK, appId = APP_ID): Promise<string> {
  const iat = Math.floor(now / 1000) - 30;
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(appId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 540)
    .sign(createPrivateKey(PRIVATE_KEY_PEM));
}

/** Mint a live installation token through the fake's own App-JWT path. */
async function mint(fake: ReturnType<typeof fakeWith>, now = CLOCK): Promise<string> {
  const res = await fake.fetch(`${BASE}/app/installations/7/access_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await appJwt(now)}` },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { token: string }).token;
}

describe('PRD 010 Req 4 GitHub API fake: installations, contents, refs, commits', () => {
  it('U365: seeded contents read back base64 with a deterministic git blob sha, and a ref/commits pair answers the seeded head', async () => {
    const fake = fakeWith();
    const token = await mint(fake);
    const auth = { Authorization: `Bearer ${token}` };

    const read = await fake.fetch(`${BASE}/repos/marky-org/docs/contents/README.md`, { headers: auth });
    expect(read.status).toBe(200);
    const body = (await read.json()) as { content: string; encoding: string; sha: string; path: string };
    expect(body.encoding).toBe('base64');
    expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe('# hello\n');
    // The real git blob hash of "# hello\n" — deterministic, never random.
    expect(body.sha).toBe('8954bb97349bfe2a7799e6a7a64c6f747c635d6c');

    const ref = await fake.fetch(`${BASE}/repos/marky-org/docs/git/ref/heads/main`, { headers: auth });
    const refBody = (await ref.json()) as { ref: string; object: { sha: string } };
    expect(refBody.ref).toBe('refs/heads/main');
    const commits = await fake.fetch(`${BASE}/repos/marky-org/docs/commits`, { headers: auth });
    const log = (await commits.json()) as Array<{ sha: string }>;
    expect(log[0].sha).toBe(refBody.object.sha);
    // A second fake seeded the same way produces the same SHAs.
    const twin = fakeWith();
    const twinRef = await twin.fetch(`${BASE}/repos/marky-org/docs/git/ref/heads/main`, {
      headers: { Authorization: `Bearer ${await mint(twin)}` },
    });
    expect(((await twinRef.json()) as { object: { sha: string } }).object.sha).toBe(refBody.object.sha);

    // An unknown ref is a 404, not a silent fallback to the default branch.
    const wrongRef = await fake.fetch(`${BASE}/repos/marky-org/docs/contents/README.md?ref=nope`, { headers: auth });
    expect(wrongRef.status).toBe(404);
  });

  it('U366: PUT creates and updates against the read sha (409 on a stale one), DELETE removes, and each write appends a commit', async () => {
    const fake = fakeWith();
    const auth = { Authorization: `Bearer ${await mint(fake)}` };
    const put = (path: string, content: string, sha?: string) =>
      fake.fetch(`${BASE}/repos/marky-org/docs/contents/${path}`, {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({
          message: `write ${path}`,
          content: Buffer.from(content, 'utf8').toString('base64'),
          ...(sha ? { sha } : {}),
        }),
      });
    const read = async <T>(route: string): Promise<T> => {
      const res = await fake.fetch(`${BASE}/repos/marky-org/docs/${route}`, { headers: auth });
      return (await res.json()) as T;
    };

    const created = await put('guide.md', 'guide\n');
    expect(created.status).toBe(201);
    expect(fake.file('marky-org', 'docs', 'guide.md')).toBe('guide\n');
    const createdSha = ((await created.json()) as { content: { sha: string } }).content.sha;

    // An update without the SHA it read, or with a stale one, is a conflict.
    expect((await put('guide.md', 'v2\n')).status).toBe(409);
    expect((await put('guide.md', 'v2\n', 'deadbeef')).status).toBe(409);
    expect((await put('guide.md', 'v2\n', createdSha)).status).toBe(200);
    expect(fake.file('marky-org', 'docs', 'guide.md')).toBe('v2\n');

    const updatedSha = (await read<{ sha: string }>('contents/guide.md')).sha;
    const removed = await fake.fetch(`${BASE}/repos/marky-org/docs/contents/guide.md`, {
      method: 'DELETE',
      headers: auth,
      body: JSON.stringify({ message: 'drop guide', sha: updatedSha }),
    });
    expect(removed.status).toBe(200);
    expect(fake.file('marky-org', 'docs', 'guide.md')).toBeUndefined();

    const log = await read<Array<{ commit: { message: string } }>>('commits');
    expect(log.map((c) => c.commit.message)).toEqual(['drop guide', 'write guide.md', 'write guide.md', 'seed']);
  });

  it('U367: enforces the auth contract — no token, an App JWT on a repo endpoint, an expired token, and a foreign App all answer 401', async () => {
    let clock = CLOCK;
    const fake = fakeWith(() => clock);
    const contents = (headers: Record<string, string>) =>
      fake.fetch(`${BASE}/repos/marky-org/docs/contents/README.md`, { headers });

    expect((await contents({})).status).toBe(401);
    expect((await contents({ Authorization: `Bearer ${await appJwt(clock)}` })).status).toBe(401);
    expect((await contents({ Authorization: 'Bearer ghs_7_nope' })).status).toBe(401);

    const token = await mint(fake, clock);
    expect((await contents({ Authorization: `Bearer ${token}` })).status).toBe(200);
    // The fake honours the expires_at it stamped: past it, the same token dies.
    clock += 3601 * 1000;
    expect((await contents({ Authorization: `Bearer ${token}` })).status).toBe(401);

    // App endpoints refuse an installation token, and a JWT from another App.
    const withInstallationToken = await fake.fetch(`${BASE}/app/installations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(withInstallationToken.status).toBe(401);
    const foreign = await fake.fetch(`${BASE}/app/installations`, {
      headers: { Authorization: `Bearer ${await appJwt(clock, '999999')}` },
    });
    expect(foreign.status).toBe(401);
    // An expired App JWT is refused too.
    const stale = await fake.fetch(`${BASE}/app/installations`, {
      headers: { Authorization: `Bearer ${await appJwt(CLOCK)}` },
    });
    expect(stale.status).toBe(401);
  });

  it('U368: answers a scripted rate limit (403 + headers) and a transient 5xx on demand', async () => {
    const fake = fakeWith();
    const auth = { Authorization: `Bearer ${await mint(fake)}` };
    fake.queueRateLimit();
    const limited = await fake.fetch(`${BASE}/repos/marky-org/docs/contents/README.md`, { headers: auth });
    expect(limited.status).toBe(403);
    expect(limited.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(Number(limited.headers.get('x-ratelimit-reset'))).toBeGreaterThan(CLOCK / 1000);

    fake.queueServerError();
    expect((await fake.fetch(`${BASE}/repos/marky-org/docs/contents/README.md`, { headers: auth })).status).toBe(502);
    // Only the scripted answers were injected — the next call is normal again.
    expect((await fake.fetch(`${BASE}/repos/marky-org/docs/contents/README.md`, { headers: auth })).status).toBe(200);
  });

  it('U369: the same implementation serves a node:http listener, so an e2e lane can point a real server process at it', async () => {
    const fake = fakeWith();
    const token = await mint(fake);
    const server = await fake.listen();
    try {
      const res = await fetch(`${server.url}/repos/marky-org/docs/contents/notes/one.md`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { content: string; path: string };
      expect(body.path).toBe('notes/one.md');
      expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe('one\n');
      // Same enforcement over HTTP as through the injected fetch.
      expect((await fetch(`${server.url}/repos/marky-org/docs/contents/notes/one.md`)).status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('U370: no source in server/ names a GitHub host except the one API base constant, and no test names the API host at all', () => {
    // Built from parts so this guard is not itself a hit.
    const host = ['github', 'com'].join('.');
    const pattern = new RegExp(host.replace('.', '\\.'), 'g');
    const apiHost = new RegExp(`api\\.${host.replace('.', '\\.')}`, 'g');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx|mts|mjs)$/.test(entry)) out.push(full);
      }
      return out;
    };
    const hits = (dir: string, re: RegExp) =>
      walk(path.join(root, dir)).flatMap((file) => {
        const matches = readFileSync(file, 'utf8').match(re) ?? [];
        return matches.map(() => path.relative(root, file));
      });
    // Two occurrences, in ONE file: the default API base URL constant and —
    // PRD 010 Req 16 — the web host the connect-your-repo wizard's install
    // URL is built on, which is a browser page and not an API call. The rule
    // is unchanged and deliberately not weakened to a count or a substring:
    // every GitHub host string in `server/` lives in that one module.
    expect(hits('server', pattern)).toEqual([
      'server/providers/github/auth.ts',
      'server/providers/github/auth.ts',
    ]);
    // No test names the API host — the fake is the only GitHub tests talk to.
    // (Release-download and About-dialog URLs elsewhere in tests/ are the
    // web host, not the API, and are none of this issue's business.)
    expect(hits('tests', apiHost)).toEqual([]);
  });
});

// PRD 010 Req 18+19: the two mutators this issue needed — losing an
// installation (connection loss) and deleting a file out of band — in the
// style of the existing seams, with the scripted-failure and counting seams
// untouched.
describe('PRD 010 Req 18 the fake can lose an installation', () => {
  it('U473: uninstalling makes the App unreachable there; count/rate-limit/5xx seams keep working', async () => {
    const fake = createGitHubFake({
      appId: APP_ID,
      installations: [{ id: 3, account: 'ada', repos: [{ owner: 'ada', repo: 'handbook', files: { 'a.md': 'x' } }] }],
    });
    const auth = createGitHubAppAuth({ appId: APP_ID, privateKey: PRIVATE_KEY_PEM, apiBase: BASE, fetchImpl: fake.fetch });
    await expect(auth.installationForRepo('ada', 'handbook')).resolves.toMatchObject({ id: 3 });

    // Losing one repo's grant is not losing the installation.
    fake.uninstall(3, { owner: 'ada', repo: 'handbook' });
    await expect(auth.installationForRepo('ada', 'handbook')).rejects.toThrowError(/failed: 404/);
    await expect(auth.listInstallations()).resolves.toHaveLength(1);
    // Losing the installation itself is.
    fake.uninstall(3);
    await expect(auth.listInstallations()).resolves.toHaveLength(0);

    // The other seams are unaffected by any of it.
    const before = fake.count('GET', '/app/installations');
    fake.queueRateLimit();
    await expect(auth.listInstallations()).rejects.toThrowError(/rate limit/i);
    fake.queueServerError(503);
    await expect(auth.listInstallations()).rejects.toThrowError(/503/);
    expect(fake.count('GET', '/app/installations')).toBe(before + 2);
  });

  it('U474: removeFile deletes out of band and moves the branch head, like a real push', () => {
    const fake = createGitHubFake({
      appId: APP_ID,
      installations: [{ id: 4, account: 'ada', repos: [{ owner: 'ada', repo: 'notes', files: { 'a.md': 'x' } }] }],
    });
    const before = fake.commits('ada', 'notes').length;
    fake.removeFile('ada', 'notes', 'a.md');
    expect(fake.file('ada', 'notes', 'a.md')).toBeUndefined();
    expect(fake.commits('ada', 'notes').length).toBe(before + 1);
    expect(() => fake.removeFile('ada', 'nope', 'a.md')).toThrowError(/no such repo in the fake/);
  });
});

// PRD 010 Req 22: what the GitHub-backed e2e lane needed the fake to answer —
// the one WEB page the connect-your-repo flow visits, and a branch that has a
// history, because the lane is the first place two writers race on one repo.
describe('PRD 010 Req 22 the fake as a whole "GitHub" for a browser', () => {
  it('U475: the App install page is served as a page, with no credential, and only at the App path', async () => {
    const fake = fakeWith();
    const res = await fake.fetch(`${BASE}/apps/marky-mark-e2e/installations/new?state=abc`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('marky-mark-e2e');
    // It is a web page, not an API route: nothing else under /apps is served,
    // and the API routes still demand their credential.
    expect((await fake.fetch(`${BASE}/apps/marky-mark-e2e/settings`)).status).toBe(404);
    expect((await fake.fetch(`${BASE}/repos/marky-org/docs/contents/README.md`)).status).toBe(401);
  });

  it('U476: a tree and a blob a later commit superseded still read back at their own sha', async () => {
    const fake = fakeWith();
    const token = await mint(fake);
    const headers = { Authorization: `Bearer ${token}` };
    const before = (await (await fake.fetch(`${BASE}/repos/marky-org/docs/git/ref/heads/main`, { headers })).json()) as {
      object: { sha: string };
    };
    const oldBlob = (
      (await (await fake.fetch(`${BASE}/repos/marky-org/docs/contents/notes/one.md`, { headers })).json()) as {
        sha: string;
      }
    ).sha;

    // A second writer moves the branch on: a new file and a changed one.
    fake.setFile('marky-org', 'docs', 'notes/two.md', 'two\n');
    fake.setFile('marky-org', 'docs', 'notes/one.md', 'one, edited\n');

    // The tree of the sha read a moment ago is what that commit held — this is
    // exactly the read a listing makes after another writer got in first.
    const tree = (await (
      await fake.fetch(`${BASE}/repos/marky-org/docs/git/trees/${before.object.sha}?recursive=1`, { headers })
    ).json()) as { sha: string; tree: { path: string }[] };
    expect(tree.sha).toBe(before.object.sha);
    expect(tree.tree.map((e) => e.path)).not.toContain('notes/two.md');
    // …while the branch name always answers the head.
    const head = (await (
      await fake.fetch(`${BASE}/repos/marky-org/docs/git/trees/main?recursive=1`, { headers })
    ).json()) as { tree: { path: string }[] };
    expect(head.tree.map((e) => e.path)).toContain('notes/two.md');

    // Contents at that ref, and the superseded blob by its own sha, likewise:
    // the same sha is the same bytes forever.
    const pinned = (await (
      await fake.fetch(`${BASE}/repos/marky-org/docs/contents/notes/one.md?ref=${before.object.sha}`, { headers })
    ).json()) as { content: string };
    expect(Buffer.from(pinned.content, 'base64').toString('utf8')).toBe('one\n');
    const blob = (await (await fake.fetch(`${BASE}/repos/marky-org/docs/git/blobs/${oldBlob}`, { headers })).json()) as {
      content: string;
    };
    expect(Buffer.from(blob.content, 'base64').toString('utf8')).toBe('one\n');

    // A ref this repo never had is still a 404, and history is not writable.
    expect((await fake.fetch(`${BASE}/repos/marky-org/docs/git/trees/deadbeef`, { headers })).status).toBe(404);
    const write = await fake.fetch(`${BASE}/repos/marky-org/docs/contents/notes/one.md?ref=${before.object.sha}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ message: 'rewrite history', content: Buffer.from('nope').toString('base64') }),
    });
    expect(write.status).toBe(422);
  });
});

// PRD 010 Req 22: the no-network rule, over every file the lane is made of.
// U370 already covers the two under `server/` (and `tests/` for the API host
// alone); the Playwright config, the package.json script and the spec are
// outside anything it scans, so the whole lane is listed here by name. A
// future test or boot script that points at the real GitHub API fails the
// unit suite rather than the CI network.
describe('PRD 010 Req 22 the GitHub-backed e2e lane is offline by construction', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
  const LANE_FILES = [
    'server/e2eGithub.ts',
    'server/e2eGithubLane.ts',
    'playwright.config.ts',
    'package.json',
    'tests/e2e/github-storage.spec.ts',
  ];

  it('U477: no file the lane boots from names a GitHub host, and the server is pointed at the fake it started', () => {
    // Built from parts so this guard is not itself a hit.
    const host = new RegExp(['github', 'com'].join('\\.'));
    for (const file of LANE_FILES) {
      expect(host.test(read(file)), `${file} must name no GitHub host`).toBe(false);
    }
    // The positive half: the boot script's API and web bases are the URL its
    // OWN fake listener resolved to, so there is nothing else they could be.
    const boot = read('server/e2eGithub.ts');
    expect(boot).toContain("import { createGitHubFake } from './providers/github/fake.ts'");
    expect(boot).toMatch(/MM_GITHUB_API_BASE \?\?= listener\.url;/);
    expect(boot).toMatch(/MM_GITHUB_WEB_BASE \?\?= listener\.url;/);
    // And it is a repo command, not a manual step: one npm script runs it.
    expect(JSON.parse(read('package.json')).scripts['server:github']).toBe('tsx server/e2eGithub.ts');
  });

  it('U478: the lane is a webServer entry like the Azurite one — same command, its own loopback port', async () => {
    const config = (await import('../../playwright.config')).default;
    const servers = config.webServer as { command: string; url: string }[];
    const lane = servers.find((s) => s.command === 'npm run server:github');
    expect(lane, 'playwright.config.ts must boot the GitHub lane').toBeDefined();
    expect(lane!.url).toBe(`http://localhost:${LANE_SERVER_PORT}/`);
    // Every lane is loopback, and no two share a port.
    const ports = servers.map((s) => new URL(s.url).port);
    expect(new Set(ports).size).toBe(ports.length);
    expect(ports).toContain(String(LANE_SERVER_PORT));
    expect(LANE_FAKE_PORT).not.toBe(LANE_SERVER_PORT);
    for (const server of servers) expect(new URL(server.url).hostname).toBe('localhost');
  });
});
