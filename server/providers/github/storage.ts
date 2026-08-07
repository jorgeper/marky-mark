// PRD 010 Req 2: the GitHub implementation of the PRD 007 storage seam — a
// peer of `azure/blob.ts`, not a fork of it. The same eight operations, the
// same paths (`workspaces/<uuid>/…`, `users/…`), the same opaque ETags; the
// callers in `server/app.ts`, `server/workspaces.ts` and `server/userFiles.ts`
// keep talking to `StorageProvider` and never learn there is a repo behind it.
// Nothing about the repo leaks into a path or an id the client can see.
//
// PRD 010 Req 4: the transport arrives injected — this module holds no
// credential and names no host. It talks to GitHub ONLY through the
// `GitHubAppAuth` it is handed, which was itself constructed with the `fetch`
// and API base URL to use (the unit suite hands it `github/fake.ts`), so
// `GITHUB_API_BASE` in `auth.ts` stays the one place a GitHub host is spelled.
// Constructing the provider performs no I/O.
//
// PRD 010 Req 11: this module has no logging call site at all, and every
// error it throws is assembled from a status, an operation name and GitHub's
// own short message — never a header, never a body dump. The credential is
// added by `auth.ts` after this module hands over the request, so there is
// nothing credential-shaped here to leak in the first place.

import { Buffer } from 'node:buffer';
import { contentTypeFor } from '../../contentTypes.ts';
import type { AuthUser, FileStat, StorageProvider, StoredBytes } from '../types.ts';
import {
  GitHubApiError,
  githubFailureDetail,
  type GitHubAppAuth,
  type GitHubInstallation,
} from './auth.ts';

/** A git commit's author or committer line. */
export interface CommitIdentity {
  name: string;
  email: string;
}

/**
 * PRD 010 Req 7: the committer of every commit this provider makes, and the
 * author of the ones it makes with no acting user. The ONE place the app's
 * git identity is spelled.
 *
 * The address is a `noreply` on a reserved domain rather than GitHub's own
 * `users.noreply` host, because `server/` names a GitHub host in exactly one
 * place — `GITHUB_API_BASE` — and U370 fails the build if a second appears.
 */
export const APP_COMMIT_IDENTITY: CommitIdentity = {
  name: 'Marky Mark',
  email: 'marky-mark@noreply.invalid',
};

/**
 * PRD 010 Req 10: how long a cached view of the branch may be served before
 * the head ref is re-checked. Reads inside the window cost zero GitHub
 * requests; a write decision never consults the cache at all, whatever this
 * is set to.
 */
const CACHE_TTL_MS = 5_000;

/**
 * How many blob bodies are held by sha before the oldest is dropped. They
 * are content-addressed, so an entry can never go stale — only take room.
 */
const BLOB_CACHE_LIMIT = 512;

export interface GitHubStorageOptions {
  /** Repo owner (user or org login). */
  owner: string;
  repo: string;
  /** The branch every read and commit targets. */
  branch: string;
  /** Optional repo-relative prefix everything is stored under. */
  root?: string;
  /** The App auth from PRD 010 Req 4 — and, through it, the fetch and API base. */
  auth: GitHubAppAuth;
  /** Injected clock (epoch ms) so cache expiry is testable without sleeping. */
  now?: () => number;
  /** Overrides {@link CACHE_TTL_MS} — the branch-head revalidation window. */
  cacheTtlMs?: number;
}

/**
 * PRD 010 Req 6: the startup check — is this repo actually usable as storage?
 * Exported so the unit suite can drive it against `github/fake.ts` without
 * booting a server; `init()` below is what runs it at startup, before
 * `server/index.ts` lets the HTTP listener accept a connection.
 *
 * One request: the installation lookup, which answers both questions at once
 * — an unreachable repo (or an App that is not installed on it) fails it, and
 * a reachable one reports the permissions it granted. The failure vocabulary
 * is `githubFailureDetail`'s, reached through `installationForRepo`'s own
 * {@link GitHubApiError}, so there is no second wording for "not found" here.
 * Nothing credential-shaped can appear in either message: the only inputs are
 * a status, GitHub's short message and the repo the operator configured.
 */
export async function assertRepoIsWritable(auth: GitHubAppAuth, owner: string, repo: string): Promise<void> {
  assertContentsWritable(await auth.installationForRepo(owner, repo), owner, repo);
}

/** The permission half of the check, on an installation already looked up. */
function assertContentsWritable(installation: GitHubInstallation, owner: string, repo: string): void {
  const contents = installation.permissions.contents ?? 'none';
  if (contents !== 'write') {
    throw new Error(
      `GitHub default repository ${owner}/${repo} is not writable: the App installation grants ` +
        `contents: ${contents} — grant it Repository permissions → Contents: Read and write, ` +
        'then accept the updated permissions on the installation',
    );
  }
}

/** One file in the branch's tree: the blob it points at, and its size. */
interface TreeEntry {
  sha: string;
  size: number;
}

/** A view of the branch at one commit — the unit the cache holds and drops. */
interface Snapshot {
  headSha: string;
  /** The head commit's date, which is the only "last modified" GitHub offers. */
  headDate: string;
  entries: Map<string, TreeEntry>;
  checkedAtMs: number;
}

/** Path segments are encoded individually — the slashes are structure. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function createGitHubStorageProvider(options: GitHubStorageOptions): StorageProvider {
  const { owner, repo, branch, auth } = options;
  const root = (options.root ?? '').replace(/^\/+|\/+$/g, '');
  const now = options.now ?? Date.now;
  const ttl = options.cacheTtlMs ?? CACHE_TTL_MS;

  // PRD 010 Req 2: the seam's path IS the repo path (under the configured
  // root). No mangling, no id translation — a workspace file is findable in
  // the repo at the path the app calls it.
  const repoPath = (path: string): string => (root ? `${root}/${path}` : path);
  const seamPath = (repoRelative: string): string => (root ? repoRelative.slice(root.length + 1) : repoRelative);
  const repoRoute = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  let installation: Promise<GitHubInstallation> | null = null;
  const currentInstallation = async (): Promise<GitHubInstallation> => {
    if (!installation) {
      // A failed lookup is not cached: the App may simply not be installed
      // yet, and the next call should ask again rather than fail forever.
      installation = auth.installationForRepo(owner, repo);
      installation.catch(() => {
        installation = null;
      });
    }
    return installation;
  };
  const installationId = async (): Promise<number> => (await currentInstallation()).id;

  async function call(method: string, suffix: string, payload?: unknown): Promise<Response> {
    const init: RequestInit = { method };
    if (payload !== undefined) {
      init.body = JSON.stringify(payload);
      init.headers = { 'content-type': 'application/json' };
    }
    return auth.requestAsInstallation(await installationId(), `${repoRoute}${suffix}`, init);
  }

  /**
   * PRD 010 Req 11: what a failed call becomes — a thrown error naming the
   * status and the operation, and saying what became of the request, from
   * the one failure vocabulary `auth.ts` also builds its errors from. It
   * reaches the client through the existing 500/notice pathway in
   * `server/app.ts`; it is never swallowed into a silent success, and
   * nothing here waits, so a save fails fast instead of hanging.
   */
  async function failure(res: Response, operation: string): Promise<GitHubApiError> {
    // Every call this module makes is part of serving a read or landing a
    // write, so the operator's question is always "did my change land?".
    const detail = await githubFailureDetail(res, 'nothing was written and no retry was attempted');
    return new GitHubApiError(res.status, operation, detail);
  }

  // --- the server-side cache (PRD 010 Req 10) --------------------------------

  let snapshot: Snapshot | null = null;
  /** The refresh in flight, tagged with the generation it started in. */
  let refreshing: { work: Promise<Snapshot>; generation: number } | null = null;
  /** Bumped by every mutation — see {@link invalidate}. */
  let generation = 0;
  const blobs = new Map<string, Uint8Array>();

  /**
   * Dropped after every mutation, so the next read re-derives from the head.
   * The generation bump is what makes that hold DURING a refresh too: a
   * refresh that began before the mutation is describing a head this write
   * has already superseded, so once it lands that refresh may neither be
   * published as the cache nor joined by a later reader.
   */
  const invalidate = (): void => {
    snapshot = null;
    generation += 1;
  };

  async function head(): Promise<{ sha: string; date: string }> {
    const operation = `branch head lookup for ${owner}/${repo}@${branch}`;
    const res = await call('GET', `/commits?sha=${encodeURIComponent(branch)}&per_page=1`);
    if (!res.ok) throw await failure(res, operation);
    const body = (await res.json()) as Array<{ sha?: string; commit?: { committer?: { date?: string } } }>;
    const top = Array.isArray(body) ? body[0] : undefined;
    if (!top || typeof top.sha !== 'string') {
      throw new GitHubApiError(res.status, operation, 'the branch carries no commits');
    }
    return { sha: top.sha, date: top.commit?.committer?.date ?? '' };
  }

  async function loadTree(headSha: string): Promise<Map<string, TreeEntry>> {
    const operation = `tree listing for ${owner}/${repo}@${branch}`;
    const res = await call('GET', `/git/trees/${encodeURIComponent(headSha)}?recursive=1`);
    if (!res.ok) throw await failure(res, operation);
    const body = (await res.json()) as {
      tree?: Array<{ path?: string; type?: string; sha?: string; size?: number }>;
    };
    const entries = new Map<string, TreeEntry>();
    for (const entry of body.tree ?? []) {
      // PRD 010 Req 9: only blobs are files. A `tree` entry is a directory —
      // git's own, not something the app stored — and never appears in a
      // listing as a file.
      if (entry.type !== 'blob' || typeof entry.path !== 'string' || typeof entry.sha !== 'string') continue;
      if (root && !entry.path.startsWith(`${root}/`)) continue;
      entries.set(entry.path, { sha: entry.sha, size: entry.size ?? 0 });
    }
    return entries;
  }

  /**
   * PRD 010 Req 10: the cache is anchored on the branch head sha, never on a
   * timer alone. Inside the TTL a read costs zero GitHub requests; past it
   * the head ref is re-read, and the tree is only re-fetched when the head
   * has actually moved — so an out-of-band push stops the cache serving the
   * content it superseded, while an idle branch stays nearly free.
   */
  async function currentSnapshot(): Promise<Snapshot> {
    const cached = snapshot;
    if (cached && now() - cached.checkedAtMs < ttl) return cached;
    // Concurrent readers share one refresh — but only one that no write has
    // outdated since it started.
    if (refreshing && refreshing.generation === generation) return refreshing.work;
    const startedIn = generation;
    const work = (async (): Promise<Snapshot> => {
      const { sha, date } = await head();
      const reusable = snapshot && snapshot.headSha === sha ? snapshot.entries : null;
      const fresh: Snapshot = {
        headSha: sha,
        headDate: date,
        entries: reusable ?? (await loadTree(sha)),
        checkedAtMs: now(),
      };
      if (generation === startedIn) snapshot = fresh;
      return fresh;
    })();
    refreshing = { work, generation: startedIn };
    try {
      return await work;
    } finally {
      // Only ever clear our own — a newer refresh may already hold the slot.
      if (refreshing?.work === work) refreshing = null;
    }
  }

  /**
   * A blob body by sha. Content-addressed, so a cached entry is correct
   * forever — the head moving changes which sha a path points at, never what
   * a sha contains.
   */
  async function blobBytesOrNull(sha: string, operation: string): Promise<Uint8Array | null> {
    const cached = blobs.get(sha);
    if (cached) return cached;
    const res = await call('GET', `/git/blobs/${encodeURIComponent(sha)}`);
    // 404 = no such object; 422 = not a sha at all. Both mean "this token
    // names nothing here", which is a null answer rather than a failure.
    if (res.status === 404 || res.status === 422) return null;
    if (!res.ok) throw await failure(res, operation);
    const body = (await res.json()) as { content?: string; encoding?: string };
    const bytes = new Uint8Array(
      Buffer.from(body.content ?? '', body.encoding === 'base64' ? 'base64' : 'utf8'),
    );
    if (blobs.size >= BLOB_CACHE_LIMIT) blobs.delete(blobs.keys().next().value!);
    blobs.set(sha, bytes);
    return bytes;
  }

  async function blobBytes(sha: string, operation: string): Promise<Uint8Array> {
    const found = await blobBytesOrNull(sha, operation);
    // The tree named this sha moments ago, so its absence is a real fault —
    // reported through the same failure vocabulary as any other bad response.
    if (!found) throw new GitHubApiError(404, operation, 'the tree names a blob the repository does not hold');
    return found;
  }

  /** The bytes at a seam path plus the blob sha that is its ETag, or null. */
  async function readEntry(path: string, operation: string): Promise<{ data: Uint8Array; etag: string } | null> {
    const snap = await currentSnapshot();
    const entry = snap.entries.get(repoPath(path));
    if (!entry) return null;
    return { data: await blobBytes(entry.sha, operation), etag: entry.sha };
  }

  // --- writes (PRD 010 Req 7 + 8) --------------------------------------------

  /**
   * PRD 010 Req 10: the sha a write conditions on is read FRESH, never taken
   * from the cache — a write decision is never made from state that may have
   * been superseded. (A conditional write does not even come here: it carries
   * the caller's own ETag, and GitHub adjudicates it.)
   */
  async function currentSha(repoRelative: string, operation: string): Promise<string | null> {
    const res = await call('GET', `/contents/${encodePath(repoRelative)}?ref=${encodeURIComponent(branch)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw await failure(res, operation);
    const body = (await res.json()) as { sha?: unknown };
    return typeof body.sha === 'string' ? body.sha : null;
  }

  /** The blob sha a successful Contents write answers with — the new ETag. */
  async function writtenEtag(res: Response, operation: string): Promise<string> {
    const body = (await res.json()) as { content?: { sha?: unknown } };
    const sha = body.content?.sha;
    if (typeof sha !== 'string') throw new GitHubApiError(res.status, operation, 'the write answered no blob sha');
    return sha;
  }

  function putBody(
    data: Uint8Array,
    message: string,
    sha: string | null,
    author: CommitIdentity,
  ): Record<string, unknown> {
    // PRD 010 Req 7: ONE Contents PUT — so exactly one commit — carrying the
    // acting user as author and the app as committer, and a message naming
    // the action and the path so the history reads without the app.
    return {
      message,
      branch,
      content: Buffer.from(data).toString('base64'),
      author,
      committer: APP_COMMIT_IDENTITY,
      ...(sha ? { sha } : {}),
    };
  }

  /**
   * An unconditional write: a deliberate overwrite that must land even if the
   * file changed since it was last read.
   *
   * PRD 010 Req 11: the retry is bounded to one extra attempt and cannot
   * double-commit — a 409 means GitHub wrote nothing at all, so the only
   * thing re-tried is a write that never happened. A second conflict is
   * reported rather than retried again.
   */
  async function overwrite(
    path: string,
    data: Uint8Array,
    action: string,
    author: CommitIdentity,
  ): Promise<{ etag: string }> {
    const repoRelative = repoPath(path);
    const operation = `${action.toLowerCase()} of ${repoRelative}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sha = await currentSha(repoRelative, operation);
      const res = await call(
        'PUT',
        `/contents/${encodePath(repoRelative)}`,
        putBody(data, `${action} ${repoRelative}`, sha, author),
      );
      invalidate();
      if (res.ok) return { etag: await writtenEtag(res, operation) };
      if (res.status !== 409) throw await failure(res, operation);
    }
    throw new GitHubApiError(
      409,
      operation,
      'the file kept changing on the branch — the write was abandoned rather than retried again',
    );
  }

  /**
   * PRD 010 Req 7: the acting user's display name goes on the author line.
   * When there is no acting user the commit still lands, authored by the app
   * — a missing display name must never fail or hang a save. The author
   * email is the user's sign-in address when it is one (that is what makes
   * the commit attributable on GitHub) and the app's `noreply` otherwise.
   */
  function authorFor(actor: AuthUser | null): CommitIdentity {
    const name = actor?.displayName?.trim();
    if (!name) return APP_COMMIT_IDENTITY;
    const username = actor?.username?.trim() ?? '';
    return { name, email: username.includes('@') ? username : APP_COMMIT_IDENTITY.email };
  }

  /**
   * PRD 010 Req 7: one view per acting user, each holding its author in a
   * closure argument — never in a shared mutable "current user". Two requests
   * in flight at once therefore cannot cross-attribute: they are two objects.
   * Everything expensive (the installation token, the snapshot, blob bodies)
   * is shared, because none of it depends on who is asking.
   */
  function view(actor: AuthUser | null): StorageProvider {
    const author = authorFor(actor);
    return {
      kind: 'github-repo',
      async init(): Promise<void> {
        // PRD 010 Req 6: fail fast. ONE lookup both resolves the installation
        // this provider will call as and proves the repo is reachable with
        // contents read/write — a deployment pointed at a repo it cannot
        // write never reaches its first save to find out. Same check as
        // {@link assertRepoIsWritable}, on the installation already fetched.
        assertContentsWritable(await currentInstallation(), owner, repo);
      },
      async read(path: string): Promise<{ content: string; etag: string } | null> {
        const found = await readEntry(path, `read of ${repoPath(path)}`);
        return found && { content: Buffer.from(found.data).toString('utf8'), etag: found.etag };
      },
      async write(path: string, content: string): Promise<{ etag: string }> {
        return overwrite(path, new Uint8Array(Buffer.from(content, 'utf8')), 'Save', author);
      },
      /**
       * PRD 010 Req 8: GitHub itself adjudicates the condition — the PUT
       * carries the very sha the caller read, so the check and the write are
       * one request and two savers cannot both win. A 409 (the blob moved
       * on) or a 404 (it was deleted meanwhile — `blob.ts` reads that the
       * same way) is "not the file you read": the answer is null with the
       * STORED CONTENT UNTOUCHED, which `server/workspaces.ts` turns into a
       * 412. Never a thrown 500, and never a retry — a retry here would
       * overwrite the save that won.
       *
       * PRD 010 Req 12: a null answer is no longer the end of the story —
       * `server/workspaces.ts` may follow it with a three-way merge, through
       * `readAtVersion` below. This method's own contract is unchanged: it
       * still never retries and never overwrites the save that won.
       */
      async writeIfMatch(path: string, content: string, ifMatch: string): Promise<{ etag: string } | null> {
        const repoRelative = repoPath(path);
        const operation = `conditional save of ${repoRelative}`;
        const res = await call(
          'PUT',
          `/contents/${encodePath(repoRelative)}`,
          putBody(new Uint8Array(Buffer.from(content, 'utf8')), `Save ${repoRelative}`, ifMatch, author),
        );
        invalidate();
        if (res.ok) return { etag: await writtenEtag(res, operation) };
        if (res.status === 409 || res.status === 404) return null;
        throw await failure(res, operation);
      },
      // PRD 010 Req 9: GitHub stores bytes and no media type, so the type is
      // derived from the extension by the SAME mapping the API layer writes
      // with (`server/contentTypes.ts`) — one rule, not two opinions.
      async readBytes(path: string): Promise<StoredBytes | null> {
        const found = await readEntry(path, `read of ${repoPath(path)}`);
        return found && { data: found.data, contentType: contentTypeFor(path), etag: found.etag };
      },
      // The caller's `contentType` is deliberately not stored: a git blob has
      // no media type to put it in, and `readBytes` re-derives the same
      // answer from the extension — so there is nothing here to fall out of
      // step with the API layer.
      async writeBytes(path: string, data: Uint8Array): Promise<{ etag: string }> {
        return overwrite(path, data, 'Upload', author);
      },
      /**
       * PRD 010 Req 7: GitHub's contents DELETE requires the sha being
       * deleted, so this reads first — a fresh read, and the sha goes
       * straight back into the DELETE, which keeps it a delete of the file
       * that is there rather than an unconditional one. One DELETE, one
       * commit; a 409 re-reads once and stops.
       */
      async delete(path: string): Promise<boolean> {
        const repoRelative = repoPath(path);
        const operation = `delete of ${repoRelative}`;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const sha = await currentSha(repoRelative, operation);
          if (sha === null) return false;
          const res = await call('DELETE', `/contents/${encodePath(repoRelative)}`, {
            message: `Delete ${repoRelative}`,
            branch,
            sha,
            author,
            committer: APP_COMMIT_IDENTITY,
          });
          invalidate();
          if (res.ok) return true;
          if (res.status === 404) return false;
          if (res.status !== 409) throw await failure(res, operation);
        }
        throw new GitHubApiError(
          409,
          operation,
          'the file kept changing on the branch — the delete was abandoned rather than retried again',
        );
      },
      /**
       * PRD 010 Req 9: every blob under the prefix, `.mmkeep` markers
       * included — they are ordinary committed files here, so an empty folder
       * survives exactly as it does on blob storage. GitHub gives no
       * per-file timestamp, so `lastModified` is the head commit's date.
       */
      async list(prefix: string): Promise<FileStat[]> {
        const snap = await currentSnapshot();
        const full = repoPath(prefix);
        const out: FileStat[] = [];
        for (const [repoRelative, entry] of snap.entries) {
          if (full && !repoRelative.startsWith(full)) continue;
          out.push({
            path: seamPath(repoRelative),
            size: entry.size,
            lastModified: snap.headDate,
            etag: entry.sha,
          });
        }
        return out;
      },
      /**
       * PRD 010 Req 12: the merge capability. An ETag from this provider IS a
       * blob sha, so the version the client loaded is still fetchable however
       * far the branch has moved since — that is exactly what a merge base
       * needs, and exactly what a blob store cannot offer.
       *
       * No new GitHub host string: this rides the same `call` helper as every
       * other request, so `GITHUB_API_BASE` in `auth.ts` remains the one place
       * a GitHub host is spelled (U370).
       *
       * `path` takes no part in resolving the bytes — a blob is addressed by
       * content — but it is what names the operation in a failure, and a
       * rate-limited or 5xx lookup throws through the Req 11 vocabulary
       * rather than becoming a silent 412.
       */
      async readAtVersion(path: string, version: string): Promise<string | null> {
        const found = await blobBytesOrNull(version, `merge-base read of ${repoPath(path)}`);
        return found && Buffer.from(found).toString('utf8');
      },
      asUser: (user: AuthUser) => view(user),
    };
  }

  return view(null);
}
