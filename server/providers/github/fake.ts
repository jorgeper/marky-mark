// PRD 010 Req 4: the local fake of the GitHub REST API — the only "GitHub"
// any test in this repo talks to. It covers the surfaces the App auth layer
// and the later storage provider (#100+) need: installations, contents, refs
// and commits. It is seedable with initial repo state and produces
// deterministic SHAs (real git blob hashes), so a test can assert a SHA
// literal instead of a shape.
//
// One implementation, two shapes: `fetch` for direct injection into
// `createGitHubAppAuth`, and `handler`/`listen` for a future e2e lane that
// points a real server process at it. It enforces the auth contract it fakes
// — no token, a stale token, or an App JWT where an installation token is
// required all answer 401 — and can be told to answer a rate limit or a
// transient 5xx so the error pathway is testable.

import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { decodeJwt, jwtVerify } from 'jose';
import type { FetchLike } from './auth.ts';

/** Whatever `jose` accepts as a verification key — no key type is re-declared here. */
type VerifyKey = Parameters<typeof jwtVerify>[1];

/** Default lifetime the fake stamps on a minted installation token. */
const TOKEN_TTL_SECONDS = 3600;

export interface FakeRepoSeed {
  owner: string;
  repo: string;
  /** Default branch; `main` when omitted. */
  branch?: string;
  // PRD 010 Req 9: seeds may be utf8 text or raw bytes — the fake stores
  // bytes either way, so a PNG survives a round trip through it intact.
  /** Repo-relative path → utf8 content (or the bytes themselves). */
  files?: Record<string, string | Uint8Array>;
}

export interface FakeInstallationSeed {
  id: number;
  /** Login of the account the App is installed on. */
  account: string;
  repos: FakeRepoSeed[];
  /**
   * PRD 010 Req 6: what the installation grants, as the installation lookup
   * reports it. Defaults to the App's own ask — contents read/write — so a
   * seed only states this to model a misconfigured installation (e.g.
   * `{ contents: 'read' }`), which is what the startup check must refuse.
   */
  permissions?: Record<string, string>;
}

export interface GitHubFakeOptions {
  /** App id the fake expects in an App JWT's `iss`. */
  appId?: string;
  /**
   * When given, App JWTs must verify RS256 against it — otherwise only the
   * claims are checked, which is enough for the storage tests.
   */
  publicKey?: VerifyKey;
  installations?: FakeInstallationSeed[];
  /** Injected clock (epoch ms) so token expiry is testable without sleeping. */
  now?: () => number;
  tokenTtlSeconds?: number;
}

export interface FakeRequest {
  method: string;
  /** Path with query string, e.g. `/app/installations/7/access_tokens`. */
  path: string;
}

/** One side of a commit's attribution, as the Contents API carries it. */
export interface FakeCommitIdentity {
  name: string;
  email: string;
}

/** A commit as the fake recorded it — what PRD 010 Req 7 is asserted against. */
export interface FakeCommit {
  sha: string;
  message: string;
  date: string;
  author?: FakeCommitIdentity;
  committer?: FakeCommitIdentity;
}

export interface GitHubFake {
  /** Injectable `fetch` — the form the auth module and provider take. */
  fetch: FetchLike;
  /** `node:http` request listener — the form an e2e lane would mount. */
  handler: (req: IncomingMessage, res: ServerResponse) => void;
  /** Start a loopback listener; resolves the base URL to point a server at. */
  listen(port?: number): Promise<{ url: string; close: () => Promise<void> }>;
  /** Every request the fake has answered, in order. */
  requests: FakeRequest[];
  /** How many requests so far matched `method` and a path substring. */
  count(method: string, pathContains: string): number;
  /** The next request answers 403 with rate-limit headers (PRD 010 Req 11). */
  queueRateLimit(): void;
  /** The next request answers a transient 5xx. */
  queueServerError(status?: number): void;
  /** Current content of a seeded file, decoded as utf8, for asserting writes. */
  file(owner: string, repo: string, path: string): string | undefined;
  /** The same file as raw bytes — the byte-fidelity assertion (PRD 010 Req 9). */
  fileBytes(owner: string, repo: string, path: string): Uint8Array | undefined;
  /** The repo's commits, oldest first, with the attribution each carried. */
  commits(owner: string, repo: string): FakeCommit[];
  /**
   * PRD 010 Req 10: change the repo behind a provider's back — the
   * out-of-band edit a cache must not keep serving. Appends a commit, so the
   * branch head moves exactly as it would for a real push.
   */
  setFile(owner: string, repo: string, path: string, content: string | Uint8Array, message?: string): void;
  /** Tokens minted so far, oldest first — lets a test send a stale one. */
  mintedTokens: string[];
}

interface RepoState {
  branch: string;
  files: Map<string, Uint8Array>;
  commits: FakeCommit[];
}

interface InstallationState {
  id: number;
  account: string;
  permissions: Record<string, string>;
  repos: Map<string, RepoState>;
}

interface FakeResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** The real git blob object hash — deterministic, and what GitHub returns. */
function blobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** Seeded and written content is bytes; utf8 text is just one way to spell it. */
function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? new Uint8Array(Buffer.from(content, 'utf8')) : content;
}

function commitSha(repoKey: string, index: number, message: string): string {
  return createHash('sha1').update(`commit ${repoKey} ${index} ${message}`).digest('hex');
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): FakeResult {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(body),
  };
}

/** A GitHub-shaped error body — the fake answers failures the way GitHub does. */
function error(status: number, message: string, headers: Record<string, string> = {}): FakeResult {
  return json(status, { message }, headers);
}

/**
 * The three installation-scoped repo routes in one match: exactly one of
 * `path` (contents, possibly empty for the repo root), `branch` (a ref) and
 * `commits` participates, so the undefined ones say which route it was.
 */
const REPO_ROUTE =
  /^\/repos\/(?<owner>[^/]+)\/(?<repo>[^/]+)\/(?:contents\/(?<path>.*)|git\/ref\/heads\/(?<branch>.+)|git\/trees\/(?<tree>[^/]+)|git\/blobs\/(?<blob>[^/]+)|(?<commits>commits))$/;

interface RepoRouteGroups {
  owner: string;
  repo: string;
  path?: string;
  branch?: string;
  tree?: string;
  blob?: string;
  commits?: string;
}

class AuthFailure extends Error {}

export function createGitHubFake(options: GitHubFakeOptions = {}): GitHubFake {
  const appId = options.appId ?? '424242';
  const now = options.now ?? Date.now;
  const ttl = options.tokenTtlSeconds ?? TOKEN_TTL_SECONDS;
  const publicKey = options.publicKey;

  const installations = new Map<number, InstallationState>();
  for (const seed of options.installations ?? []) {
    const repos = new Map<string, RepoState>();
    for (const repo of seed.repos) {
      const key = `${repo.owner}/${repo.repo}`.toLowerCase();
      const files = new Map(Object.entries(repo.files ?? {}).map(([path, content]) => [path, toBytes(content)]));
      repos.set(key, {
        branch: repo.branch ?? 'main',
        files,
        // A seeded repo starts with one commit, so `git/ref` and `commits`
        // answer something deterministic before any write.
        commits: [{ sha: commitSha(key, 0, 'seed'), message: 'seed', date: '2026-01-01T00:00:00Z' }],
      });
    }
    installations.set(seed.id, {
      id: seed.id,
      account: seed.account,
      permissions: seed.permissions ?? { contents: 'write', metadata: 'read' },
      repos,
    });
  }

  const tokens = new Map<string, { installationId: number; expiresAtMs: number }>();
  const mintedTokens: string[] = [];
  const requests: FakeRequest[] = [];
  const scripted: FakeResult[] = [];

  const findRepo = (owner: string, repo: string): { installation: InstallationState; state: RepoState } | null => {
    const key = `${owner}/${repo}`.toLowerCase();
    for (const installation of installations.values()) {
      const state = installation.repos.get(key);
      if (state) return { installation, state };
    }
    return null;
  };

  const credential = (headers: Record<string, string>): string | null => {
    const raw = headers.authorization ?? '';
    const match = /^(?:Bearer|token)\s+(.+)$/i.exec(raw.trim());
    return match ? match[1] : null;
  };

  // PRD 010 Req 4: App-level endpoints accept ONLY a live App JWT — an
  // installation token here is a 401, exactly as on github.
  async function requireAppJwt(headers: Record<string, string>): Promise<void> {
    const value = credential(headers);
    if (!value) throw new AuthFailure('Requires authentication');
    if (tokens.has(value)) throw new AuthFailure('A JWT signed by the App is required for this endpoint');
    let claims: { iss?: unknown; exp?: unknown };
    try {
      claims = decodeJwt(value);
    } catch {
      throw new AuthFailure('A JWT could not be decoded');
    }
    if (publicKey) {
      try {
        await jwtVerify(value, publicKey, {
          algorithms: ['RS256'],
          currentDate: new Date(now()),
        });
      } catch {
        throw new AuthFailure('A JWT could not be verified');
      }
    }
    if (claims.iss !== appId) throw new AuthFailure('Integration not found');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now()) {
      throw new AuthFailure("'Expiration time' claim ('exp') must be a numeric value in the future");
    }
  }

  // PRD 010 Req 4: repo endpoints accept ONLY an unexpired installation
  // token, and only one scoped to an installation that holds the repo.
  function requireInstallationToken(headers: Record<string, string>, installationId: number): void {
    const value = credential(headers);
    if (!value) throw new AuthFailure('Requires authentication');
    const minted = tokens.get(value);
    if (!minted) throw new AuthFailure('Bad credentials');
    if (minted.expiresAtMs <= now()) throw new AuthFailure('Bad credentials');
    if (minted.installationId !== installationId) throw new AuthFailure('Resource not accessible by integration');
  }

  function mintToken(installationId: number): FakeResult {
    // Deterministic token strings: the Nth token for an installation is
    // always the same string, so a test can name the stale one.
    const token = `ghs_${installationId}_${mintedTokens.length + 1}`;
    const expiresAtMs = now() + ttl * 1000;
    tokens.set(token, { installationId, expiresAtMs });
    mintedTokens.push(token);
    return json(201, {
      token,
      expires_at: new Date(expiresAtMs).toISOString(),
      permissions: { contents: 'write', metadata: 'read' },
    });
  }

  function installationBody(installation: InstallationState): unknown {
    return {
      id: installation.id,
      account: { login: installation.account, type: 'Organization' },
      app_id: Number(appId),
      // PRD 010 Req 6: the grant the startup check reads.
      permissions: installation.permissions,
    };
  }

  function contentsBody(owner: string, repo: string, path: string, content: Uint8Array): unknown {
    return {
      type: 'file',
      name: path.split('/').pop(),
      path,
      sha: blobSha(content),
      size: content.length,
      encoding: 'base64',
      content: Buffer.from(content).toString('base64'),
      url: `/repos/${owner}/${repo}/contents/${path}`,
    };
  }

  /** Only a `{name, email}` pair is attribution; anything else is dropped. */
  function identity(raw: unknown): FakeCommitIdentity | undefined {
    const value = raw as { name?: unknown; email?: unknown } | undefined;
    if (!value || typeof value.name !== 'string' || typeof value.email !== 'string') return undefined;
    return { name: value.name, email: value.email };
  }

  // PRD 010 Req 7: every write appends a commit — so `git/ref` and `commits`
  // move with it — and the commit keeps the author/committer pair the write
  // carried, which is what the attribution assertions read back.
  function appendCommit(
    state: RepoState,
    repoKey: string,
    message: string,
    payload: { author?: unknown; committer?: unknown } = {},
  ): { sha: string; message: string } {
    const commit: FakeCommit = {
      sha: commitSha(repoKey, state.commits.length, message),
      message,
      date: new Date(now()).toISOString(),
      author: identity(payload.author),
      committer: identity(payload.committer),
    };
    state.commits.push(commit);
    return { sha: commit.sha, message: commit.message };
  }

  async function route(
    method: string,
    pathname: string,
    query: URLSearchParams,
    headers: Record<string, string>,
    body: string,
  ): Promise<FakeResult> {
    // --- installations (App JWT) ---------------------------------------
    const mint = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(pathname);
    if (mint && method === 'POST') {
      await requireAppJwt(headers);
      const id = Number(mint[1]);
      if (!installations.has(id)) return error(404, 'Not Found');
      return mintToken(id);
    }
    if (pathname === '/app/installations' && method === 'GET') {
      await requireAppJwt(headers);
      return json(200, [...installations.values()].map(installationBody));
    }
    const repoInstall = /^\/repos\/([^/]+)\/([^/]+)\/installation$/.exec(pathname);
    if (repoInstall && method === 'GET') {
      await requireAppJwt(headers);
      const found = findRepo(decodeURIComponent(repoInstall[1]), decodeURIComponent(repoInstall[2]));
      if (!found) return error(404, 'Not Found');
      return json(200, installationBody(found.installation));
    }

    // --- contents / refs / commits (installation token) -----------------
    const repoRoute = REPO_ROUTE.exec(pathname)?.groups as RepoRouteGroups | undefined;
    if (repoRoute) {
      const owner = decodeURIComponent(repoRoute.owner);
      const repo = decodeURIComponent(repoRoute.repo);
      const found = findRepo(owner, repo);
      if (!found) {
        // Still authenticate first: an unknown repo must not leak past a
        // missing token.
        if (!credential(headers)) throw new AuthFailure('Requires authentication');
        return error(404, 'Not Found');
      }
      requireInstallationToken(headers, found.installation.id);
      const { state } = found;
      const repoKey = `${owner}/${repo}`.toLowerCase();

      const head = () => state.commits[state.commits.length - 1];

      if (repoRoute.path !== undefined) {
        const path = decodeURIComponent(repoRoute.path);
        const ref = query.get('ref') ?? state.branch;
        // A commit sha is as valid a ref as the branch name, and reading a
        // path at an explicit head sha is how a caller pins a snapshot.
        if (ref !== state.branch && ref !== head().sha) {
          return error(404, 'No commit found for the ref ' + ref);
        }
        if (method === 'GET') {
          const existing = state.files.get(path);
          if (existing === undefined) {
            // A directory listing when anything lives under that prefix.
            const prefix = path === '' ? '' : `${path}/`;
            const children = [...state.files.keys()].filter((p) => p.startsWith(prefix) && prefix !== p);
            if (!children.length) return error(404, 'Not Found');
            return json(200, children.map((p) => contentsBody(owner, repo, p, state.files.get(p)!)));
          }
          return json(200, contentsBody(owner, repo, path, existing));
        }
        const payload = body
          ? (JSON.parse(body) as {
              message?: string;
              content?: string;
              sha?: string;
              author?: unknown;
              committer?: unknown;
            })
          : {};
        const current = state.files.get(path);
        if (method === 'PUT') {
          // The write contract the provider depends on: an update must send
          // the SHA it read, so a concurrent change is a 409, never a
          // silent overwrite.
          if (current !== undefined && payload.sha !== blobSha(current)) {
            return error(409, `${path} is at ${blobSha(current)} but expected ${payload.sha ?? 'nothing'}`);
          }
          // A sha for a path that holds nothing is equally a conflict: the
          // blob the caller conditioned on is gone (PRD 010 Req 8).
          if (current === undefined && payload.sha !== undefined) {
            return error(409, `${path} does not exist but ${payload.sha} was expected`);
          }
          const content = new Uint8Array(Buffer.from(payload.content ?? '', 'base64'));
          state.files.set(path, content);
          return json(current === undefined ? 201 : 200, {
            content: contentsBody(owner, repo, path, content),
            commit: appendCommit(state, repoKey, payload.message ?? '', payload),
          });
        }
        if (method === 'DELETE') {
          if (current === undefined) return error(404, 'Not Found');
          if (payload.sha !== blobSha(current)) return error(409, 'sha does not match');
          state.files.delete(path);
          return json(200, { content: null, commit: appendCommit(state, repoKey, payload.message ?? '', payload) });
        }
        return error(405, 'Method not allowed');
      }

      if (repoRoute.branch !== undefined && method === 'GET') {
        const branch = decodeURIComponent(repoRoute.branch);
        if (branch !== state.branch) return error(404, 'Not Found');
        return json(200, {
          ref: `refs/heads/${branch}`,
          object: { sha: head().sha, type: 'commit' },
        });
      }

      if (repoRoute.commits !== undefined && method === 'GET') {
        const commits = [...state.commits].reverse();
        return json(200, commits.map((c) => ({
          sha: c.sha,
          commit: {
            message: c.message,
            author: c.author ? { ...c.author, date: c.date } : { date: c.date },
            committer: c.committer ? { ...c.committer, date: c.date } : { date: c.date },
          },
        })));
      }

      // PRD 010 Req 9+10: the tree of a ref, which is how a listing is one
      // request instead of a walk — and, being keyed by the head sha, what
      // makes a cache invalidatable by ref comparison. Directories are real
      // `tree` entries here so a caller that leaks one into a file listing
      // is caught.
      if (repoRoute.tree !== undefined && method === 'GET') {
        const ref = decodeURIComponent(repoRoute.tree);
        if (ref !== state.branch && ref !== head().sha) return error(404, 'Not Found');
        const recursive = query.get('recursive');
        const paths = [...state.files.keys()].sort();
        const directories = new Set<string>();
        for (const path of paths) {
          const parts = path.split('/');
          for (let i = 1; i < parts.length; i += 1) directories.add(parts.slice(0, i).join('/'));
        }
        const entries = [
          ...paths.map((path) => {
            const content = state.files.get(path)!;
            return { path, mode: '100644', type: 'blob', sha: blobSha(content), size: content.length };
          }),
          // Nothing ever dereferences a directory's sha — only its `tree`
          // type is under test — so any deterministic filler serves.
          ...[...directories]
            .sort()
            .map((path) => ({ path, mode: '040000', type: 'tree', sha: commitSha(repoKey, -1, path) })),
        ];
        return json(200, {
          sha: head().sha,
          truncated: false,
          // Without `recursive`, GitHub answers the top level only.
          tree: recursive ? entries : entries.filter((e) => !e.path.includes('/')),
        });
      }

      // A blob is content-addressed: the same sha is the same bytes forever,
      // which is what lets the provider cache blob content unconditionally.
      if (repoRoute.blob !== undefined && method === 'GET') {
        const sha = decodeURIComponent(repoRoute.blob);
        for (const content of state.files.values()) {
          if (blobSha(content) !== sha) continue;
          return json(200, {
            sha,
            size: content.length,
            encoding: 'base64',
            content: Buffer.from(content).toString('base64'),
          });
        }
        return error(404, 'Not Found');
      }
    }

    return error(404, 'Not Found');
  }

  async function handle(
    method: string,
    rawUrl: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<FakeResult> {
    // A base only so a bare path parses; the fake never dials anything.
    const url = new URL(rawUrl, 'http://fake.invalid');
    requests.push({ method, path: url.pathname + url.search });
    const injected = scripted.shift();
    if (injected) return injected;
    try {
      return await route(method, url.pathname, url.searchParams, headers, body);
    } catch (err) {
      if (err instanceof AuthFailure) return error(401, err.message);
      throw err;
    }
  }

  function normalizeHeaders(init?: RequestInit): Record<string, string> {
    const out: Record<string, string> = {};
    const raw = init?.headers;
    if (!raw) return out;
    if (raw instanceof Headers) {
      raw.forEach((value, key) => (out[key.toLowerCase()] = value));
    } else if (Array.isArray(raw)) {
      for (const [key, value] of raw) out[key.toLowerCase()] = value;
    } else {
      for (const [key, value] of Object.entries(raw)) out[key.toLowerCase()] = String(value);
    }
    return out;
  }

  function handler(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers[key.toLowerCase()] = value;
      }
      handle(req.method ?? 'GET', req.url ?? '/', headers, Buffer.concat(chunks).toString('utf8'))
        .then((result) => {
          res.writeHead(result.status, result.headers);
          res.end(result.body);
        })
        .catch(() => {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end('{"message":"fake failure"}');
        });
    });
  }

  return {
    requests,
    mintedTokens,
    handler,
    async fetch(url: string, init?: RequestInit): Promise<Response> {
      const body = typeof init?.body === 'string' ? init.body : '';
      const result = await handle(init?.method ?? 'GET', url, normalizeHeaders(init), body);
      return new Response(result.body, { status: result.status, headers: result.headers });
    },
    listen(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
      const server = createServer(handler);
      return new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => {
          const address = server.address();
          const bound = typeof address === 'object' && address ? address.port : port;
          resolve({
            url: `http://127.0.0.1:${bound}`,
            close: () => new Promise<void>((done) => server.close(() => done())),
          });
        });
      });
    },
    count(method: string, pathContains: string): number {
      return requests.filter((r) => r.method === method && r.path.includes(pathContains)).length;
    },
    // PRD 010 Req 4: scripted failures — the rate-limit and transient-5xx
    // pathways later issues (Req 11) need, without a network to break.
    queueRateLimit(): void {
      scripted.push(
        error(403, 'API rate limit exceeded', {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(now() / 1000) + 600),
        }),
      );
    },
    queueServerError(status = 502): void {
      scripted.push(error(status, 'Server Error'));
    },
    file(owner: string, repo: string, path: string): string | undefined {
      const bytes = findRepo(owner, repo)?.state.files.get(path);
      return bytes === undefined ? undefined : Buffer.from(bytes).toString('utf8');
    },
    fileBytes(owner: string, repo: string, path: string): Uint8Array | undefined {
      return findRepo(owner, repo)?.state.files.get(path);
    },
    commits(owner: string, repo: string): FakeCommit[] {
      return [...(findRepo(owner, repo)?.state.commits ?? [])];
    },
    setFile(owner: string, repo: string, path: string, content: string | Uint8Array, message = `out-of-band ${path}`): void {
      const found = findRepo(owner, repo);
      if (!found) throw new Error(`no such repo in the fake: ${owner}/${repo}`);
      found.state.files.set(path, toBytes(content));
      appendCommit(found.state, `${owner}/${repo}`.toLowerCase(), message);
    },
  };
}
