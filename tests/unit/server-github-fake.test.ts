import { Buffer } from 'node:buffer';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
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
    // One occurrence, in one file: the default API base URL constant.
    expect(hits('server', pattern)).toEqual(['server/providers/github/auth.ts']);
    // No test names the API host — the fake is the only GitHub tests talk to.
    // (Release-download and About-dialog URLs elsewhere in tests/ are the
    // web host, not the API, and are none of this issue's business.)
    expect(hits('tests', apiHost)).toEqual([]);
  });
});
