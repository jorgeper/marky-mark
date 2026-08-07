// PRD 010 Req 4: GitHub App authentication — the ONLY credential path this
// server has to GitHub. The deployment registers one App; the operator
// configures its App ID and private key; this module signs a short-lived App
// JWT with that key and exchanges it for per-installation tokens on demand.
// No PAT, no long-lived repo token: nothing here reads the environment or
// accepts a caller-supplied token. Nothing credential-shaped is ever logged
// (this file has no logging call site at all — U363 pins that) or carried in
// a thrown message.
// The fetch function and the API base URL are injected exactly the way
// `createGraphDirectoryProvider(fetchImpl)` takes its fetch, so the unit
// suite pins every URL shape and cache decision against the local fake
// (`./fake.ts`) with no network.

import { createPrivateKey, type KeyObject } from 'node:crypto';
import { SignJWT } from 'jose';

/**
 * PRD 010 Req 4: the ONE place a GitHub host name appears in `server/`.
 * Every other call site takes the base URL as an argument, the same way
 * `blob.ts` is the only importer of `@azure/storage-blob`.
 */
export const GITHUB_API_BASE = 'https://api.github.com';

/** GitHub rejects an App JWT whose lifetime exceeds ten minutes. */
const APP_JWT_TTL_SECONDS = 540;

/** `iat` is backdated so a slightly fast server clock is still accepted. */
const APP_JWT_BACKDATE_SECONDS = 30;

/**
 * A cached installation token this close to its `expires_at` is treated as
 * already expired, so a token never dies mid-request.
 */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GitHubAppAuthOptions {
  /** Numeric GitHub App id (`MM_GITHUB_APP_ID`). */
  appId: string;
  /** PEM private key, PKCS#1 or PKCS#8 (`MM_GITHUB_PRIVATE_KEY`). */
  privateKey: string;
  /** API root; defaults to {@link GITHUB_API_BASE}. */
  apiBase?: string;
  /** Injected for tests — the local fake, never the network. */
  fetchImpl?: FetchLike;
  /** Injected clock (epoch ms) so expiry/refresh is testable without sleeping. */
  now?: () => number;
}

export interface GitHubInstallation {
  id: number;
  /** Login of the account (user or org) the App is installed on. */
  account: string;
}

export interface GitHubAppAuth {
  readonly kind: 'github-app';
  readonly apiBase: string;
  /** A freshly signed App JWT — used only for the App-level endpoints below. */
  appJwt(): Promise<string>;
  listInstallations(): Promise<GitHubInstallation[]>;
  installationForRepo(owner: string, repo: string): Promise<GitHubInstallation>;
  /** A valid installation token, minted or served from cache. */
  installationToken(installationId: number): Promise<string>;
  /** `fetch` against the API base authenticated as that installation. */
  requestAsInstallation(installationId: number, path: string, init?: RequestInit): Promise<Response>;
}

/**
 * PRD 010 Req 4: an API failure the operator can act on — status and
 * operation named, credential redacted. Mirrors how `server/app.ts` reports
 * vendor failures: a message, never a dump of the request.
 */
export class GitHubApiError extends Error {
  readonly status: number;
  readonly operation: string;
  constructor(status: number, operation: string, detail: string) {
    super(`GitHub ${operation} failed: ${status} — ${detail}`);
    this.name = 'GitHubApiError';
    this.status = status;
    this.operation = operation;
  }
}

/**
 * PRD 010 Req 4: App Service app settings cannot hold literal newlines, so a
 * PEM arrives `\n`-escaped there and with real newlines everywhere else —
 * both are accepted. Throws (without echoing the key) when the value is not
 * a readable PEM; `loadConfig` turns that into a message naming the variable.
 */
export function normalizeGitHubPrivateKey(raw: string): string {
  const pem = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  const trimmed = pem.trim();
  // GitHub App keys download as PKCS#1 (`BEGIN RSA PRIVATE KEY`), which
  // jose's importPKCS8 cannot parse — node:crypto reads both encodings and
  // its KeyObject is what SignJWT signs with.
  try {
    createPrivateKey(trimmed);
  } catch {
    throw new Error('not a readable PEM private key (expected a BEGIN [RSA] PRIVATE KEY block)');
  }
  return trimmed;
}

/**
 * PRD 010 Req 4: constructing performs no I/O and does not even parse the key
 * (it is read on first use, mirroring `createEntraAuthProvider`'s lazy JWKS),
 * so wiring this in costs nothing until a GitHub call is actually made.
 */
export function createGitHubAppAuth(options: GitHubAppAuthOptions): GitHubAppAuth {
  const { appId, privateKey } = options;
  const apiBase = (options.apiBase ?? GITHUB_API_BASE).replace(/\/+$/, '');
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;

  // PRD 010 Req 4: every secret this module has ever held, so a message
  // assembled from a GitHub response can be scrubbed before it is thrown.
  // Belt and braces — nothing below deliberately interpolates a credential.
  const secrets = new Set<string>([privateKey]);

  let key: KeyObject | null = null;
  const signingKey = (): KeyObject => {
    if (!key) {
      const pem = normalizeGitHubPrivateKey(privateKey);
      secrets.add(pem);
      key = createPrivateKey(pem);
    }
    return key;
  };
  const redact = (text: string): string => {
    let out = text;
    for (const secret of secrets) {
      if (secret && out.includes(secret)) out = out.split(secret).join('[redacted]');
    }
    return out;
  };

  const cache = new Map<number, { token: string; expiresAtMs: number }>();
  // PRD 010 Req 4: mints in flight, keyed by installation — two concurrent
  // callers share one `access_tokens` request instead of racing two.
  const inFlight = new Map<number, Promise<string>>();

  async function fail(res: Response, operation: string): Promise<never> {
    // Only the status, the operation and GitHub's own short `message` are
    // surfaced: no headers (which carry the Authorization we sent), no body
    // dump, and the whole string is scrubbed of known secrets.
    let detail: string;
    if (res.status === 401) {
      detail = 'the App credentials were rejected — check MM_GITHUB_APP_ID and MM_GITHUB_PRIVATE_KEY';
    } else if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = res.headers.get('x-ratelimit-reset');
      const at = reset ? new Date(Number(reset) * 1000).toISOString() : 'an unknown time';
      detail = `rate limit exceeded, resets at ${at} — no retry was attempted`;
    } else if (res.status === 403) {
      detail = 'the App installation does not grant access to that resource';
    } else if (res.status === 404) {
      detail = 'not found, or the App is not installed on that repository';
    } else if (res.status >= 500) {
      detail = 'GitHub is unavailable — no retry was attempted';
    } else {
      let message = '';
      try {
        const body = (await res.json()) as { message?: unknown };
        if (typeof body.message === 'string') message = body.message;
      } catch {
        // A non-JSON error body tells us nothing worth surfacing.
      }
      detail = message || 'unexpected response';
    }
    throw new GitHubApiError(res.status, operation, redact(detail));
  }

  async function appRequest(path: string, init: RequestInit, operation: string): Promise<Response> {
    const jwt = await appJwt();
    const res = await fetchImpl(`${apiBase}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${jwt}`,
      },
    });
    if (!res.ok) await fail(res, operation);
    return res;
  }

  async function appJwt(): Promise<string> {
    // PRD 010 Req 4: RS256, `iss` = the App id, `iat` backdated for clock
    // skew, `exp` well inside GitHub's ten-minute ceiling.
    const iat = Math.floor(now() / 1000) - APP_JWT_BACKDATE_SECONDS;
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(appId)
      .setIssuedAt(iat)
      .setExpirationTime(iat + APP_JWT_TTL_SECONDS)
      .sign(signingKey());
    secrets.add(jwt);
    return jwt;
  }

  async function mintInstallationToken(installationId: number): Promise<string> {
    const res = await appRequest(
      `/app/installations/${installationId}/access_tokens`,
      { method: 'POST' },
      `installation token mint for installation ${installationId}`,
    );
    const body = (await res.json()) as { token?: unknown; expires_at?: unknown };
    if (typeof body.token !== 'string' || typeof body.expires_at !== 'string') {
      throw new GitHubApiError(res.status, `installation token mint for installation ${installationId}`,
        'the response carried no token');
    }
    const expiresAtMs = Date.parse(body.expires_at);
    secrets.add(body.token);
    cache.set(installationId, {
      token: body.token,
      expiresAtMs: Number.isNaN(expiresAtMs) ? now() : expiresAtMs,
    });
    return body.token;
  }

  async function installationToken(installationId: number): Promise<string> {
    const cached = cache.get(installationId);
    // PRD 010 Req 4: refreshed BEFORE expiry — a token inside the safety
    // margin is treated as already dead rather than sent and rejected.
    if (cached && cached.expiresAtMs - TOKEN_REFRESH_MARGIN_MS > now()) return cached.token;
    const pending = inFlight.get(installationId);
    if (pending) return pending;
    const mint = mintInstallationToken(installationId).finally(() => inFlight.delete(installationId));
    inFlight.set(installationId, mint);
    return mint;
  }

  return {
    kind: 'github-app',
    apiBase,
    appJwt,
    installationToken,
    async listInstallations(): Promise<GitHubInstallation[]> {
      const res = await appRequest('/app/installations', {}, 'installation list');
      const body = (await res.json()) as Array<{ id: number; account?: { login?: string } }>;
      return body.map((i) => ({ id: i.id, account: i.account?.login ?? '' }));
    },
    async installationForRepo(owner: string, repo: string): Promise<GitHubInstallation> {
      const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`;
      const res = await appRequest(path, {}, `installation lookup for ${owner}/${repo}`);
      const body = (await res.json()) as { id: number; account?: { login?: string } };
      return { id: body.id, account: body.account?.login ?? '' };
    },
    async requestAsInstallation(installationId: number, path: string, init: RequestInit = {}): Promise<Response> {
      const token = await installationToken(installationId);
      return fetchImpl(`${apiBase}${path}`, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.headers as Record<string, string> | undefined),
          // PRD 010 Req 4: installation-scoped calls carry the installation
          // token, never the App JWT.
          Authorization: `Bearer ${token}`,
        },
      });
    },
  };
}
