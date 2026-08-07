import { generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { createGitHubByo } from '../../server/githubByo';
import { createGitHubAppAuth } from '../../server/providers/github/auth';
import { createGitHubFake } from '../../server/providers/github/fake';
import { createMockAuthProvider } from '../../server/providers/mock/auth';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import { createMemoryStorage } from './storage-contract';

// PRD 010 Req 2+4+16: the server surface the connect-your-GitHub-repo wizard
// reads GitHub through, proven at the HTTP layer against the local fake — the
// availability answer, the install URL, the return resolving into a wizard
// session, the installation's repos and a repo's branches. Nothing here
// reaches github.com: the fake is injected as the App auth's fetch.
//
// The properties this pins beyond the happy path: the 401 guard, and that no
// route hands a caller an installation their own session does not name.

const { privateKey: PRIVATE_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const APP_ID = '424242';
const API_BASE = 'https://api.example.test';
const WEB_BASE = 'https://web.example.test';

describe('PRD 010 Req 2+4+16 connect-your-repo wizard: the server routes it talks to', () => {
  const fake = createGitHubFake({
    appId: APP_ID,
    installations: [
      {
        id: 7,
        account: 'marky-org',
        repos: [
          { owner: 'marky-org', repo: 'docs', branch: 'trunk', files: { 'README.md': '# hi\n' } },
          { owner: 'marky-org', repo: 'handbook', files: { 'index.md': 'x\n' } },
        ],
      },
      // A second installation nobody in this test completed a round trip for:
      // what the enumeration bound must refuse to describe.
      { id: 9, account: 'other-org', repos: [{ owner: 'other-org', repo: 'secrets' }] },
    ],
  });
  const auth = createMockAuthProvider();
  let server: Server;
  let base = '';
  const tokens: Record<string, string> = {};
  let sessions = 0;

  beforeAll(async () => {
    const byo = createGitHubByo({
      auth: createGitHubAppAuth({
        appId: APP_ID,
        privateKey: PRIVATE_KEY,
        apiBase: API_BASE,
        fetchImpl: fake.fetch,
      }),
      appSlug: 'marky-mark',
      webBase: WEB_BASE,
      newSessionId: () => `sess-${++sessions}`,
    });
    server = createServer(
      createApp(
        '/nonexistent-static',
        { auth, storage: createMemoryStorage().provider, directory: createMockDirectoryProvider() },
        'local',
        undefined,
        byo,
      ),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const username of ['ada', 'grace']) {
      const result = await auth.signIn({ username });
      if (result?.kind !== 'token') throw new Error('mock sign-in failed');
      tokens[username] = result.token;
    }
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const call = (user: string | null, method: string, path: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${path}`, {
      method,
      headers: user ? { Authorization: `Bearer ${tokens[user]}` } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** Start a session and complete the return leg, as the wizard's steps do. */
  async function connected(user: string, installationId = 7): Promise<string> {
    const started = (await (await call(user, 'POST', '/api/github/byo/session')).json()) as { session: string };
    const returned = await call(user, 'POST', '/api/github/byo/return', {
      session: started.session,
      installationId,
      setupAction: 'install',
    });
    expect(returned.status).toBe(200);
    return started.session;
  }

  it('U446: every wizard route sits behind the same 401 guard as the rest of /api', async () => {
    for (const [method, path] of [
      ['GET', '/api/github/byo'],
      ['POST', '/api/github/byo/session'],
      ['POST', '/api/github/byo/return'],
      ['GET', '/api/github/byo/repos?session=sess-1'],
      ['GET', '/api/github/byo/branches?session=sess-1&owner=o&repo=r'],
    ] as const) {
      const res = await call(null, method, path);
      expect([method, path, res.status]).toEqual([method, path, 401]);
    }
  });

  it('U447: a configured deployment reports the choice available and hands back an install URL naming the App', async () => {
    const available = await call('ada', 'GET', '/api/github/byo');
    expect(available.status).toBe(200);
    expect(await available.json()).toEqual({ available: true });

    const started = await call('ada', 'POST', '/api/github/byo/session');
    expect(started.status).toBe(200);
    const body = (await started.json()) as { session: string; installUrl: string };
    expect(body.session).toMatch(/^sess-\d+$/);
    // The URL is the deployment's own App install page, carrying the opaque
    // state GitHub echoes back — that echo is what makes the return matchable.
    expect(body.installUrl).toBe(`${WEB_BASE}/apps/marky-mark/installations/new?state=${body.session}`);
  });

  it('U448: the return resolves into the session, and its repos and branches read back', async () => {
    const session = await connected('ada');

    const repos = await call('ada', 'GET', `/api/github/byo/repos?session=${session}&installation=7`);
    expect(repos.status).toBe(200);
    const repoBody = (await repos.json()) as { repos: { fullName: string; defaultBranch: string }[] };
    expect(repoBody.repos.map((r) => r.fullName).sort()).toEqual(['marky-org/docs', 'marky-org/handbook']);
    // Only the repos of the session's OWN installation — never the other one.
    expect(repoBody.repos.some((r) => r.fullName.startsWith('other-org/'))).toBe(false);
    expect(repoBody.repos.find((r) => r.fullName === 'marky-org/docs')?.defaultBranch).toBe('trunk');

    const branches = await call(
      'ada',
      'GET',
      `/api/github/byo/branches?session=${session}&installation=7&owner=marky-org&repo=docs`,
    );
    expect(branches.status).toBe(200);
    // PRD 010 Req 16: the branch default is the repo's own default branch.
    expect(await branches.json()).toEqual({ defaultBranch: 'trunk', branches: ['trunk'] });
  });

  it('U449: no caller is handed an installation their own wizard session does not name', async () => {
    const session = await connected('ada');

    // The other installation is real and reachable to the deployment's App —
    // and still refused, by name, because this session did not come back
    // from it (PRD 010 Req 2: enumeration is bounded).
    const other = await call('ada', 'GET', `/api/github/byo/repos?session=${session}&installation=9`);
    expect(other.status).toBe(403);
    expect(((await other.json()) as { error: string }).error).toMatch(/not the one this connection was started for/i);

    // Another signed-in user cannot borrow the session id, and neither can a
    // session this server never issued.
    const borrowed = await call('grace', 'GET', `/api/github/byo/repos?session=${session}&installation=7`);
    expect(borrowed.status).toBe(404);
    const unknown = await call('ada', 'GET', '/api/github/byo/repos?session=nope&installation=7');
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: string }).error).toMatch(/no longer in progress/i);

    // A session that has not come back from GitHub has no installation at all.
    const fresh = (await (await call('ada', 'POST', '/api/github/byo/session')).json()) as { session: string };
    const early = await call('ada', 'GET', `/api/github/byo/repos?session=${fresh.session}`);
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: string }).error).toMatch(/has not come back from GitHub/i);
  });

  it('U450: a return the App cannot confirm, and a cancelled one, are named refusals rather than a bound session', async () => {
    const started = (await (await call('ada', 'POST', '/api/github/byo/session')).json()) as { session: string };
    const invented = await call('ada', 'POST', '/api/github/byo/return', {
      session: started.session,
      installationId: 4242,
      setupAction: 'install',
    });
    expect(invented.status).toBe(404);
    expect(((await invented.json()) as { error: string }).error).toMatch(/not installed there/i);
    // …and the session stayed unbound, so it cannot read that installation.
    const after = await call('ada', 'GET', `/api/github/byo/repos?session=${started.session}&installation=4242`);
    expect(after.status).toBe(409);

    const cancelled = await call('ada', 'POST', '/api/github/byo/return', {
      session: started.session,
      setupAction: 'cancel',
    });
    expect(cancelled.status).toBe(400);
    expect(((await cancelled.json()) as { error: string }).error).toMatch(/cancelled/i);

    const stale = await call('ada', 'POST', '/api/github/byo/return', {
      session: 'sess-does-not-exist',
      installationId: 7,
      setupAction: 'install',
    });
    expect(stale.status).toBe(404);
  });

  it('U451: a GitHub failure surfaces as an actionable message, never a hung step or a leaked dump', async () => {
    const session = await connected('ada');
    fake.queueRateLimit();
    const limited = await call('ada', 'GET', `/api/github/byo/repos?session=${session}&installation=7`);
    expect(limited.status).toBe(400);
    const { error } = (await limited.json()) as { error: string };
    expect(error).toMatch(/rate limit exceeded/i);
    expect(error).toMatch(/nothing was created/);
    // Nothing credential-shaped comes back: no token, no JWT, no header dump.
    expect(error).not.toMatch(/ghs_|Bearer|authorization/i);

    fake.queueServerError(503);
    const down = await call('ada', 'GET', `/api/github/byo/repos?session=${session}&installation=7`);
    expect(down.status).toBe(502);
    expect(((await down.json()) as { error: string }).error).toMatch(/unavailable/i);
  });

  it('U452: an unmatched wizard route is a 404, not a 500', async () => {
    expect((await call('ada', 'GET', '/api/github/byo/nope')).status).toBe(404);
  });
});

describe('PRD 010 Req 15 connect-your-repo: a deployment that cannot connect one', () => {
  const auth = createMockAuthProvider();
  let server: Server;
  let base = '';
  let token = '';

  beforeAll(async () => {
    // No GitHub App at all — createApp's default wizard, exactly what an
    // existing blob deployment wires today.
    server = createServer(
      createApp(
        '/nonexistent-static',
        { auth, storage: createMemoryStorage().provider, directory: createMockDirectoryProvider() },
        'local',
      ),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const result = await auth.signIn({ username: 'ada' });
    if (result?.kind !== 'token') throw new Error('mock sign-in failed');
    token = result.token;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('U453: availability says why the choice is unavailable, and the other routes refuse by name', async () => {
    const res = await fetch(`${base}/api/github/byo`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean; reason: string };
    expect(body.available).toBe(false);
    // A one-line reason an operator can act on — never a dead end or a 500.
    expect(body.reason).toMatch(/MM_GITHUB_APP_ID/);

    const started = await fetch(`${base}/api/github/byo/session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(started.status).toBe(409);
    expect(((await started.json()) as { error: string }).error).toMatch(/no GitHub App configured/i);
  });
});
