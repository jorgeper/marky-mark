// PRD 010 Req 17: bring-your-own-repo — the layout half. A BYO workspace's
// documents are NORMAL markdown files at the connected `branch`+`root`, so a
// reader who never heard of this app can browse them on GitHub: the document
// the app calls `notes/plan.md` is committed at `<root>/notes/plan.md`. No id
// in the path, no `files/` segment, no mangling, no encoding.
//
// That is the opposite of the deployment default repo (Req 5), which mirrors
// the blob layout (`workspaces/<uuid>/files/…`) and is app storage nobody is
// meant to read. Both use #100's provider unchanged; the difference is
// entirely this module, a path-mapping decorator around it — which keeps
// #100's contract tests describing #100's contract, and keeps `asUser` (Req 7
// attribution) and `init` (Req 6) working by re-wrapping rather than
// re-implementing them.
//
// Existing repo content is workspace content BY DESIGN: a file already
// committed under the connected root lists and opens as a workspace document,
// and a `root` of the repo root means the whole repo is the workspace. That is
// the point of Req 17 — you connect a repo you already have — not a leak.
//
// The one thing that is not a document is app metadata: it lives under a
// single `<root>/.marky-mark/` directory, never appears in a file listing, and
// is not reachable through the `files/<path>` routes.

import type { WorkspaceBackendRecord } from '../../backends.ts';
import { WORKSPACES_PREFIX } from '../../workspaces.ts';
import { StoragePathError, type AuthUser, type FileStat, type StorageProvider } from '../types.ts';

/**
 * PRD 010 Req 17: the ONE directory app metadata lives in, at the connected
 * root. Only `<root>/.marky-mark/` is metadata — a `.marky-mark` directory
 * deeper in the tree is an ordinary file path like any other.
 */
export const METADATA_DIR = '.marky-mark';

/** Where the workspace manifest lands, repo-relative to the connected root. */
export const MANIFEST_REPO_PATH = `${METADATA_DIR}/manifest.json`;

/** The seam path vocabulary this module maps, for one workspace id. */
const seamPrefixes = (id: string) => {
  const prefix = `${WORKSPACES_PREFIX}${id}/`;
  return { prefix, manifest: `${prefix}manifest.json`, files: `${prefix}files/`, metadata: `${prefix}${METADATA_DIR}/` };
};

/** `.marky-mark` itself, or anything inside it — the metadata directory. */
function isMetadata(repoRelative: string): boolean {
  return repoRelative === METADATA_DIR || repoRelative.startsWith(`${METADATA_DIR}/`);
}

/**
 * PRD 010 Req 17: no mapped path may escape the connected root. `..`, an
 * absolute path and an empty segment are refused here rather than handed to
 * the provider, which would resolve them against the repo — the same rule
 * `cleanRelativePath` applies at the HTTP edge, applied again at the store.
 */
function assertContained(repoRelative: string, seamPath: string): string {
  const segments = repoRelative.split('/');
  if (repoRelative === '' || segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new StoragePathError(`refusing to map ${seamPath} into the connected repo: it escapes the root`);
  }
  return repoRelative;
}

/**
 * PRD 010 Req 17: seam path → repo path, the mapping in one place.
 *
 * - `workspaces/<id>/files/<p>` → `<p>` — the human-readable half.
 * - `workspaces/<id>/manifest.json` → `.marky-mark/manifest.json`.
 * - `workspaces/<id>/.marky-mark/<x>` → `.marky-mark/<x>` — the reserved seam
 *   spelling of the metadata directory. No route can address it (it is
 *   outside `files/`), and it exists so the delete sweep, which lists the
 *   whole `workspaces/<id>/` prefix, can name what it found there.
 *
 * Everything else throws: the mapped provider serves ONLY its own workspace,
 * so another workspace's prefix, `users/…` or the backend record itself is a
 * refusal, never a path in someone's repo.
 */
export function workspaceRepoPath(id: string, seamPath: string): string {
  const { prefix, manifest, files, metadata } = seamPrefixes(id);
  if (seamPath === manifest) return MANIFEST_REPO_PATH;
  if (seamPath.startsWith(files)) {
    const relative = seamPath.slice(files.length);
    // `.marky-mark/` is metadata, not a document: a `files/` request that
    // would land inside it is refused rather than served (and so cannot be
    // written or deleted through those routes either).
    if (isMetadata(relative)) {
      throw new StoragePathError(`refusing ${seamPath}: ${METADATA_DIR}/ at the connected root is app metadata`);
    }
    return assertContained(relative, seamPath);
  }
  if (seamPath.startsWith(metadata)) {
    // One seam spelling per repo path: the manifest is addressed by its own
    // seam path above, never by this alias.
    if (seamPath.slice(prefix.length) === MANIFEST_REPO_PATH) {
      throw new StoragePathError(`refusing ${seamPath}: the manifest is addressed as ${manifest}`);
    }
    return assertContained(seamPath.slice(prefix.length), seamPath);
  }
  throw new StoragePathError(`refusing ${seamPath}: outside workspace ${id}`);
}

/**
 * PRD 010 Req 17: the inverse — total, so `list()` can answer in seam paths
 * and `GET /api/workspaces/<id>/files` shows the repo's own files under the
 * root. `.mmkeep` markers (Req 9) come back like any other committed file.
 */
export function workspaceSeamPath(id: string, repoRelative: string): string {
  const { prefix, manifest, files } = seamPrefixes(id);
  if (repoRelative === MANIFEST_REPO_PATH) return manifest;
  if (isMetadata(repoRelative)) return `${prefix}${repoRelative}`;
  return `${files}${repoRelative}`;
}

/**
 * PRD 010 Req 17: one workspace's view of a connected repo. Every operation is
 * the wrapped provider's, addressed through {@link workspaceRepoPath}; the
 * decorator adds no caching, no auth and no I/O of its own, so #100's
 * installation token, branch snapshot and write rules (Req 10) all still
 * belong to the provider underneath and are shared by every workspace on the
 * same repo+branch+root.
 */
export function createWorkspaceRepoView(inner: StorageProvider, id: string): StorageProvider {
  const { prefix, files } = seamPrefixes(id);

  const wrap = (target: StorageProvider): StorageProvider => {
    const at = (seamPath: string): string => workspaceRepoPath(id, seamPath);
    const view: StorageProvider = {
      kind: target.kind,
      read: (path) => target.read(at(path)),
      write: (path, content) => target.write(at(path), content),
      writeIfMatch: (path, content, ifMatch) => target.writeIfMatch(at(path), content, ifMatch),
      readBytes: (path) => target.readBytes(at(path)),
      writeBytes: (path, data, contentType) => target.writeBytes(at(path), data, contentType),
      delete: (path) => target.delete(at(path)),
      /**
       * A listing is mapped BACK: the repo prefix is narrowed when the seam
       * prefix is inside `files/`, and the seam paths are filtered against
       * the prefix that was asked for. That filter is what keeps
       * `.marky-mark/` out of `GET .../files` (its seam path is outside the
       * `files/` prefix) while still letting the workspace-wide sweep behind
       * DELETE see it.
       */
      async list(seamPrefix: string): Promise<FileStat[]> {
        if (!seamPrefix.startsWith(prefix)) {
          throw new StoragePathError(`refusing to list ${seamPrefix}: outside workspace ${id}`);
        }
        const repoPrefix = seamPrefix.startsWith(files) ? seamPrefix.slice(files.length) : '';
        const out: FileStat[] = [];
        for (const stat of await target.list(repoPrefix)) {
          const path = workspaceSeamPath(id, stat.path);
          if (path.startsWith(seamPrefix)) out.push({ ...stat, path });
        }
        return out;
      },
    };
    // PRD 010 Req 6+7: forwarded, not re-implemented — `init()` is the
    // connected repo's own fail-fast writability check, and `asUser` still
    // yields a view whose commits carry the acting user as author.
    if (target.init) view.init = () => target.init!();
    if (target.asUser) view.asUser = (user: AuthUser) => wrap(target.asUser!(user));
    return view;
  };

  return wrap(inner);
}

/** The connection identity a provider may be shared across workspaces by. */
export function repoConnectionKey(record: WorkspaceBackendRecord & { kind: 'repo' }): string {
  return `${record.owner}/${record.repo}#${record.branch}:${normalizeRoot(record.root)}`;
}

/** A repo-relative prefix with no leading/trailing slashes; '' is the root. */
export function normalizeRoot(root: string | undefined): string {
  return (root ?? '').replace(/^\/+|\/+$/g, '');
}
