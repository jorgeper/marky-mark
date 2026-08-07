import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeJwt, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { createGitHubAppAuth, GitHubApiError, normalizeGitHubPrivateKey } from '../../server/providers/github/auth';
import { createGitHubFake } from '../../server/providers/github/fake';

// PRD 010 Req 4: the GitHub App auth layer — App JWT minting, installation
// tokens, the cache's expiry/refresh rules, and the never-log contract. Every
// call goes through the local fake (`server/providers/github/fake.ts`); no
// test here touches a network.

// A GitHub App key downloads as PKCS#1 (`BEGIN RSA PRIVATE KEY`), which is
// exactly what the module must accept, so the fixture generates that shape.
const { privateKey: PRIVATE_KEY_PEM, publicKey: PUBLIC_KEY_PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const PUBLIC_KEY = createPublicKey(PUBLIC_KEY_PEM);
const APP_ID = '424242';
const API_BASE = 'https://api.example.test';

function seededFake(now: () => number, tokenTtlSeconds?: number) {
  return createGitHubFake({
    appId: APP_ID,
    publicKey: PUBLIC_KEY,
    now,
    tokenTtlSeconds,
    installations: [
      {
        id: 7,
        account: 'marky-org',
        repos: [{ owner: 'marky-org', repo: 'docs', files: { 'README.md': '# hello\n' } }],
      },
    ],
  });
}

describe('PRD 010 Req 4 GitHub App JWT', () => {
  it('U358: signs an RS256 App JWT whose iss is the App id, iat is backdated, and exp is inside GitHub 10-minute ceiling', async () => {
    const clock = Date.parse('2026-08-07T12:00:00Z');
    const auth = createGitHubAppAuth({
      appId: APP_ID,
      privateKey: PRIVATE_KEY_PEM,
      apiBase: API_BASE,
      fetchImpl: seededFake(() => clock).fetch,
      now: () => clock,
    });
    const jwt = await auth.appJwt();
    const { payload, protectedHeader } = await jwtVerify(jwt, PUBLIC_KEY, {
      currentDate: new Date(clock),
    });
    expect(protectedHeader.alg).toBe('RS256');
    expect(payload.iss).toBe(APP_ID);
    const iat = payload.iat!;
    const exp = payload.exp!;
    expect(iat).toBeLessThan(clock / 1000); // backdated for clock skew
    expect(exp - iat).toBeLessThanOrEqual(600);
    expect(exp * 1000).toBeGreaterThan(clock);
  });

  it('U359: accepts a PEM with literal newlines and the same PEM \\n-escaped, and rejects a non-PEM value without echoing it', async () => {
    const escaped = PRIVATE_KEY_PEM.replace(/\n/g, '\\n');
    expect(normalizeGitHubPrivateKey(escaped)).toBe(PRIVATE_KEY_PEM.trim());
    expect(normalizeGitHubPrivateKey(PRIVATE_KEY_PEM)).toBe(PRIVATE_KEY_PEM.trim());
    // An escaped key still signs — the App Service app-setting shape works.
    const clock = Date.parse('2026-08-07T12:00:00Z');
    const auth = createGitHubAppAuth({
      appId: APP_ID,
      privateKey: escaped,
      apiBase: API_BASE,
      fetchImpl: seededFake(() => clock).fetch,
      now: () => clock,
    });
    expect(decodeJwt(await auth.appJwt()).iss).toBe(APP_ID);
    expect(() => normalizeGitHubPrivateKey('hunter2')).toThrowError(/PEM private key/);
    expect(() => normalizeGitHubPrivateKey('hunter2')).not.toThrowError(/hunter2/);
  });
});

describe('PRD 010 Req 4 installation tokens', () => {
  it('U360: mints an installation token with the App JWT and sends it on installation-scoped calls', async () => {
    const clock = Date.parse('2026-08-07T12:00:00Z');
    const fake = seededFake(() => clock);
    const auth = createGitHubAppAuth({
      appId: APP_ID,
      privateKey: PRIVATE_KEY_PEM,
      apiBase: API_BASE,
      fetchImpl: fake.fetch,
      now: () => clock,
    });
    const installation = await auth.installationForRepo('marky-org', 'docs');
    expect(installation).toEqual({ id: 7, account: 'marky-org' });
    expect(await auth.listInstallations()).toEqual([{ id: 7, account: 'marky-org' }]);

    const token = await auth.installationToken(installation.id);
    expect(token).toBe(fake.mintedTokens[0]);
    // The fake answers repo endpoints ONLY for a live installation token, so
    // a 200 here is proof the module sent it as the Authorization credential.
    const res = await auth.requestAsInstallation(installation.id, '/repos/marky-org/docs/contents/README.md');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: string; encoding: string };
    expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe('# hello\n');
  });

  it('U361: a cached token is reused until it nears expiry, then re-minted — the fake rejects the stale one and accepts the fresh one', async () => {
    let clock = Date.parse('2026-08-07T12:00:00Z');
    const fake = seededFake(() => clock, 300); // 5-minute tokens
    const auth = createGitHubAppAuth({
      appId: APP_ID,
      privateKey: PRIVATE_KEY_PEM,
      apiBase: API_BASE,
      fetchImpl: fake.fetch,
      now: () => clock,
    });
    const first = await auth.installationToken(7);
    expect(await auth.installationToken(7)).toBe(first);
    expect(fake.count('POST', '/access_tokens')).toBe(1); // cache hit, no second mint

    // Inside the 60s safety margin the cached token is treated as dead.
    clock += 250_000;
    const second = await auth.installationToken(7);
    expect(second).not.toBe(first);
    expect(fake.count('POST', '/access_tokens')).toBe(2);

    // The old token really is rejected by the fake, and the new one works —
    // this is a real expiry, not a stubbed clock alone.
    clock += 60_000; // now past the first token's expires_at
    const stale = await fake.fetch(`${API_BASE}/repos/marky-org/docs/contents/README.md`, {
      headers: { Authorization: `Bearer ${first}` },
    });
    expect(stale.status).toBe(401);
    const fresh = await auth.requestAsInstallation(7, '/repos/marky-org/docs/contents/README.md');
    expect(fresh.status).toBe(200);
  });

  it('U362: two concurrent callers share one mint rather than issuing two access_tokens requests', async () => {
    const clock = Date.parse('2026-08-07T12:00:00Z');
    const fake = seededFake(() => clock);
    const auth = createGitHubAppAuth({
      appId: APP_ID,
      privateKey: PRIVATE_KEY_PEM,
      apiBase: API_BASE,
      fetchImpl: fake.fetch,
      now: () => clock,
    });
    const [a, b, c] = await Promise.all([
      auth.installationToken(7),
      auth.installationToken(7),
      auth.installationToken(7),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(fake.count('POST', '/access_tokens')).toBe(1);
    expect(fake.mintedTokens).toHaveLength(1);
  });
});

describe('PRD 010 Req 4 no credential is ever logged', () => {
  it('U363: the module has no console call site and no PAT-shaped credential is read anywhere in server/', () => {
    const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
    const source = read('server/providers/github/auth.ts');
    expect(source).not.toMatch(/console\./);
    // PRD 010 Req 4: App ID + private key are the only credential inputs.
    const serverSources = [
      'server/config.ts',
      'server/app.ts',
      'server/index.ts',
      'server/workspaces.ts',
      'server/userFiles.ts',
      'server/providers/index.ts',
      'server/providers/github/auth.ts',
      'server/providers/github/fake.ts',
    ].map(read);
    for (const text of serverSources) {
      expect(text).not.toMatch(/GITHUB_TOKEN|GH_TOKEN|personal access token|ghp_/i);
    }
  });

  it('U364: 401/403/404/rate-limit/5xx surface as actionable errors naming status and operation, with no key, JWT or token in the message', async () => {
    const clock = Date.parse('2026-08-07T12:00:00Z');
    const fake = seededFake(() => clock);
    const auth = createGitHubAppAuth({
      appId: APP_ID,
      privateKey: PRIVATE_KEY_PEM,
      apiBase: API_BASE,
      fetchImpl: fake.fetch,
      now: () => clock,
    });
    const jwt = await auth.appJwt();
    const token = await auth.installationToken(7);
    const secrets = [PRIVATE_KEY_PEM.trim(), PRIVATE_KEY_PEM.split('\n')[1], jwt, token];
    const messages: string[] = [];

    // 404: an installation lookup for a repo the App is not installed on.
    await expect(auth.installationForRepo('someone', 'elsewhere')).rejects.toThrowError(
      /GitHub installation lookup for someone\/elsewhere failed: 404/,
    );
    messages.push(await capture(() => auth.installationForRepo('someone', 'elsewhere')));

    // 401: the App credentials rejected outright.
    const wrongApp = createGitHubAppAuth({
      appId: '999999',
      privateKey: PRIVATE_KEY_PEM,
      apiBase: API_BASE,
      fetchImpl: fake.fetch,
      now: () => clock,
    });
    const unauthorized = await capture(() => wrongApp.listInstallations());
    expect(unauthorized).toMatch(/GitHub installation list failed: 401/);
    expect(unauthorized).toMatch(/MM_GITHUB_APP_ID/);
    messages.push(unauthorized);

    // 403 + rate-limit headers: named as a rate limit, with no retry loop.
    fake.queueRateLimit();
    const limited = await capture(() => auth.listInstallations());
    expect(limited).toMatch(/failed: 403/);
    expect(limited).toMatch(/rate limit exceeded, resets at .*no retry/);
    messages.push(limited);

    // 5xx: surfaced, not retried silently.
    fake.queueServerError();
    const unavailable = await capture(() => auth.installationToken(9));
    expect(unavailable).toMatch(/GitHub installation token mint for installation 9 failed: 502/);
    expect(unavailable).toMatch(/no retry was attempted/);
    messages.push(unavailable);

    // 403 without rate-limit headers still names the operation.
    fake.queueServerError(403);
    messages.push(await capture(() => auth.listInstallations()));

    expect(messages).toHaveLength(5);
    for (const message of messages) {
      for (const secret of secrets) {
        expect(message).not.toContain(secret);
      }
    }
  });
});

/** The thrown message, so a batch of error paths can be checked at once. */
async function capture(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(GitHubApiError);
    return (err as Error).message;
  }
  throw new Error('expected the call to reject');
}
