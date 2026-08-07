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

/**
 * PRD 010 Req 16: the WEB host — where a repo admin is sent to install the
 * deployment's App (`/apps/<slug>/installations/new`), which is a browser
 * page and not an API call. It lives here, beside {@link GITHUB_API_BASE},
 * because the rule is one module for every GitHub host string in `server/`
 * (U370), not one constant.
 */
export const GITHUB_WEB_BASE = 'https://github.com';

/** GitHub rejects an App JWT whose lifetime exceeds ten minutes. */
const APP_JWT_TTL_SECONDS = 540;

/** `iat` is backdated so a slightly fast server clock is still accepted. */
const APP_JWT_BACKDATE_SECONDS = 30;

/**
 * A cached installation token this close to its `expires_at` is treated as
 * already expired, so a token never dies mid-request.
 */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/** Sent on every call; the credential and any per-call headers layer on top. */
const API_HEADERS: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * The caller's `init` plus the API headers and a bearer credential, which
 * always wins. Built through `Headers` rather than an object spread because
 * `init.headers` may legally be a `Headers` or an entry array, and a spread
 * would silently mangle either.
 */
function authorized(init: RequestInit, credential: string): RequestInit {
  const headers = new Headers(API_HEADERS);
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  headers.set('Authorization', `Bearer ${credential}`);
  return { ...init, headers };
}

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
  /**
   * PRD 010 Req 6: what the installation actually grants, resource → access
   * (`contents: 'write'`, …) — the thing startup validation checks before the
   * deployment accepts a single request. Empty when GitHub reported none.
   */
  permissions: Record<string, string>;
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

/** An installation as GitHub reports it, before it is read into shape. */
interface InstallationBody {
  id: number;
  account?: { login?: string };
  permissions?: Record<string, unknown>;
}

/** Only string-valued permissions are grants; anything else is not read. */
function readInstallation(body: InstallationBody): GitHubInstallation {
  const permissions: Record<string, string> = {};
  for (const [resource, access] of Object.entries(body.permissions ?? {})) {
    if (typeof access === 'string') permissions[resource] = access;
  }
  return { id: body.id, account: body.account?.login ?? '', permissions };
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
 * PRD 010 Req 4+11: the operator-facing reason a GitHub response failed,
 * status by status — the ONE mapping every module that turns a response into
 * a {@link GitHubApiError} builds its detail from, so the auth layer and the
 * storage provider cannot drift into two vocabularies for the same failure.
 * Only the status and GitHub's own short `message` are read: never a header
 * (they carry the Authorization we sent) and never a body dump.
 *
 * `consequence` is the clause appended where the operator's next question is
 * "so what happened to my request?" — a caller mid-write says so.
 */
export async function githubFailureDetail(res: Response, consequence = 'no retry was attempted'): Promise<string> {
  if (res.status === 401) {
    return 'the App credentials were rejected — check MM_GITHUB_APP_ID and MM_GITHUB_PRIVATE_KEY';
  }
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = res.headers.get('x-ratelimit-reset');
    const at = reset ? new Date(Number(reset) * 1000).toISOString() : 'an unknown time';
    return `rate limit exceeded, resets at ${at} — ${consequence}`;
  }
  if (res.status === 403) return 'the App installation does not grant access to that resource';
  if (res.status === 404) return 'not found, or the App is not installed on that repository';
  if (res.status >= 500) return `GitHub is unavailable — ${consequence}`;
  let message = '';
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === 'string') message = body.message;
  } catch {
    // A non-JSON error body tells us nothing worth surfacing.
  }
  return message || 'unexpected response';
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

  /**
   * The error a failed response becomes — thrown by the caller, so the
   * control flow stays visible at the call site. The detail comes from the
   * shared mapping above and is then scrubbed of every secret this module
   * has held, so not even GitHub's own `message` can echo one back.
   */
  async function apiError(res: Response, operation: string): Promise<GitHubApiError> {
    return new GitHubApiError(res.status, operation, redact(await githubFailureDetail(res)));
  }

  async function appRequest(path: string, init: RequestInit, operation: string): Promise<Response> {
    const jwt = await appJwt();
    const res = await fetchImpl(`${apiBase}${path}`, authorized(init, jwt));
    if (!res.ok) throw await apiError(res, operation);
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
    const operation = `installation token mint for installation ${installationId}`;
    const res = await appRequest(`/app/installations/${installationId}/access_tokens`, { method: 'POST' }, operation);
    const body = (await res.json()) as { token?: unknown; expires_at?: unknown };
    if (typeof body.token !== 'string' || typeof body.expires_at !== 'string') {
      throw new GitHubApiError(res.status, operation, 'the response carried no token');
    }
    const expiresAtMs = Date.parse(body.expires_at);
    secrets.add(body.token);
    cache.set(installationId, {
      // An unreadable `expires_at` caches the token as already expired, so it
      // is used for this call and re-minted for the next — never trusted.
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
      const body = (await res.json()) as InstallationBody[];
      return body.map(readInstallation);
    },
    async installationForRepo(owner: string, repo: string): Promise<GitHubInstallation> {
      const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`;
      const res = await appRequest(path, {}, `installation lookup for ${owner}/${repo}`);
      return readInstallation((await res.json()) as InstallationBody);
    },
    async requestAsInstallation(installationId: number, path: string, init: RequestInit = {}): Promise<Response> {
      // PRD 010 Req 4: installation-scoped calls carry the installation
      // token, never the App JWT.
      const token = await installationToken(installationId);
      return fetchImpl(`${apiBase}${path}`, authorized(init, token));
    },
  };
}
