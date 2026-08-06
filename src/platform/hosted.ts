import type { Platform } from './types';
import { readStoredToken } from '../lib/hostedGate';
import {
  HOSTED_CONFIG_DIR,
  apiPathFor,
  hostedFilesRoot,
  hostedResolveAssetSrc,
  hostedWorkspaceFilePath,
  manifestSettingsToWorkspaceFile,
  normalizeHostedPath,
  parseHostedPath,
  workspaceFileToManifestSettings,
  workspaceIdFromSearch,
  type HostedTarget,
} from '../lib/hostedPaths';

/**
 * PRD 007 Req 2: the hosted flavor's Platform implementation — the seam in
 * types.ts satisfied entirely by the server's REST API, carrying the signed-in
 * session's bearer token. Everything the app reads or writes is a blob:
 *
 *   - documents, comment sidecars and pasted images live inside the
 *     workspace prefix, so what one signed-in member writes is exactly what
 *     another member reads back (Req 8);
 *   - the PRD 002 User settings layer (and user themes) live in the per-user
 *     blob prefix behind /api/me/files, so a personal setting roams to the
 *     same user's next browser session and to no one else's (Req 9);
 *   - the Workspace settings layer is the manifest's `settings` slot,
 *     presented to the app as an ordinary .marky-workspace file (Req 9).
 *
 * App code stays flavor-blind: no branch outside this directory asks whether
 * it is hosted, only whether a capability is present, exactly as web and the
 * dev shim already work. Path mapping is pure and lives in lib/hostedPaths.ts.
 */

/** A blob as the API reports it in a listing. */
interface ListedFile {
  path: string;
  size: number;
  lastModified: string;
  etag: string;
}

/** Thrown for a read of something the workspace does not hold (App catches it). */
const enoent = (path: string) => new Error(`ENOENT: ${path}`);

/** Everything under one listable scope: a workspace's files, or the user's blobs. */
type Scope = { kind: 'user' } | { kind: 'workspace'; id: string };

const scopeKey = (scope: Scope): string => (scope.kind === 'user' ? 'user' : `w:${scope.id}`);

const scopeOf = (target: HostedTarget): Scope | null =>
  target.kind === 'user' ? { kind: 'user' } : target.kind === 'workspace' ? { kind: 'workspace', id: target.id } : null;

export function createHostedPlatform(): Platform {
  const token = () => readStoredToken(window.localStorage) ?? '';
  const workspaceId = workspaceIdFromSearch(window.location.search);

  /**
   * The bundle's hosted-platform network call site (SPEC11 §6.6 bundle-scan
   * allowlist): every API request this platform makes funnels through here,
   * always same-origin and always bearer-authenticated.
   */
  const api = (path: string, init?: RequestInit): Promise<Response> =>
    fetch(path, {
      ...init,
      headers: { ...(init?.headers as Record<string, string> | undefined), Authorization: `Bearer ${token()}` },
    });

  const json = async <T>(res: Response): Promise<T | null> => (res.ok ? ((await res.json()) as T) : null);

  // Listings are the answer to `exists` and both directory reads, and the app
  // asks constantly (every doc open probes for a sidecar). One listing per
  // scope is cached and invalidated by this platform's own writes.
  const listings = new Map<string, Promise<ListedFile[]>>();

  const listScope = (scope: Scope): Promise<ListedFile[]> => {
    const key = scopeKey(scope);
    const cached = listings.get(key);
    if (cached) return cached;
    const target: HostedTarget =
      scope.kind === 'user' ? { kind: 'user', rel: '' } : { kind: 'workspace', id: scope.id, rel: '' };
    const pending = api(apiPathFor(target))
      .then((res) => json<ListedFile[]>(res))
      .then((files) => files ?? [])
      .catch(() => [] as ListedFile[]);
    listings.set(key, pending);
    return pending;
  };

  const invalidate = (target: HostedTarget): void => {
    const scope = scopeOf(target);
    if (scope) listings.delete(scopeKey(scope));
  };

  /** The relative blob paths under one scope, for directory-shaped questions. */
  const relPathsOf = async (target: HostedTarget): Promise<string[]> => {
    const scope = scopeOf(target);
    if (!scope) return [];
    return (await listScope(scope)).map((f) => f.path);
  };

  /** Direct children of a virtual directory, as name + isDir. */
  const childrenOf = async (dir: string): Promise<Array<{ name: string; isDir: boolean }>> => {
    const target = parseHostedPath(normalizeHostedPath(dir));
    if (!target || target.kind === 'manifest') return [];
    const prefix = target.rel ? `${target.rel}/` : '';
    const seen = new Map<string, boolean>();
    for (const rel of await relPathsOf(target)) {
      if (!rel.startsWith(prefix)) continue;
      const tail = rel.slice(prefix.length);
      if (!tail) continue;
      const slash = tail.indexOf('/');
      const name = slash === -1 ? tail : tail.slice(0, slash);
      seen.set(name, seen.get(name) === true || slash !== -1);
    }
    return [...seen].map(([name, isDir]) => ({ name, isDir }));
  };

  const readManifest = async (id: string) => {
    const res = await api(apiPathFor({ kind: 'manifest', id }));
    const body = await json<{ manifest: { settings?: Record<string, unknown> } }>(res);
    if (!body) throw enoent(`workspace ${id}`);
    return body.manifest;
  };

  return {
    kind: 'hosted',
    isMac: navigator.platform.toLowerCase().includes('mac'),

    async readTextFile(path) {
      const target = parseHostedPath(path);
      if (!target) throw enoent(path);
      // PRD 007 Req 9: the workspace file the app opens IS the manifest —
      // its `settings` slot becomes the PRD 002 Workspace layer with no
      // hosted-specific code in App.
      if (target.kind === 'manifest') {
        return manifestSettingsToWorkspaceFile((await readManifest(target.id)).settings ?? {});
      }
      const body = await json<{ content: string }>(await api(apiPathFor(target)));
      if (!body) throw enoent(path);
      return body.content;
    },

    async writeTextFile(path, content) {
      const target = parseHostedPath(path);
      if (!target) throw enoent(path);
      if (target.kind === 'manifest') {
        // Only the settings slot round-trips: members, roles and timestamps
        // are the server's (and #77's), and folders are not a hosted concept.
        const manifest = await readManifest(target.id);
        const next = workspaceFileToManifestSettings(content);
        // Opening a workspace rewrites its file unconditionally; a member
        // without workspace.settings would only earn a 403 for a no-op, so
        // an unchanged settings slot writes nothing at all.
        if (JSON.stringify(manifest.settings ?? {}) === JSON.stringify(next)) return;
        await api(apiPathFor(target), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...manifest, settings: next }),
        });
        return;
      }
      const res = await api(apiPathFor(target), { method: 'PUT', body: content });
      invalidate(target);
      if (!res.ok) throw new Error(`write failed (${res.status}): ${path}`);
    },

    async exists(path) {
      const target = parseHostedPath(path);
      if (!target) return false;
      if (target.kind === 'manifest') return (await api(apiPathFor(target))).ok;
      // A workspace's files root always exists — it is the prefix itself, and
      // an empty new workspace must still open as an available folder.
      if (!target.rel) return true;
      const paths = await relPathsOf(target);
      return paths.some((p) => p === target.rel || p.startsWith(`${target.rel}/`));
    },

    async remove(path) {
      const target = parseHostedPath(path);
      if (!target || target.kind === 'manifest') return;
      await api(apiPathFor(target), { method: 'DELETE' });
      invalidate(target);
    },

    async readDirNames(dir) {
      return (await childrenOf(dir)).map((e) => e.name);
    },
    async mkdirp() {
      /* blob prefixes are implicit — a write creates every parent */
    },

    async configDir() {
      return HOSTED_CONFIG_DIR;
    },
    async welcomeDocPath() {
      return `${HOSTED_CONFIG_DIR}/welcome.md`;
    },
    join(...parts) {
      return normalizeHostedPath(parts.join('/'));
    },
    basename(path) {
      return path.split('/').pop() ?? path;
    },
    dirname(path) {
      const parts = path.split('/');
      parts.pop();
      return parts.join('/') || '/';
    },

    async openFileDialog() {
      // Opening documents is the folder sidebar's job here; upload/download
      // dialogs are issue #76's scope.
      return null;
    },
    /**
     * SPEC34 §1: the folder sidebar's picker seam. A hosted workspace IS its
     * blob prefix — there is nothing to browse for — so the "picker" answers
     * the bound workspace's root. Defining it is what makes the sidebar
     * render at all (App gates the whole feature on this capability); the
     * workspace-picking UI proper is issue #75's scope.
     */
    async openFolderDialog() {
      return workspaceId ? hostedFilesRoot(workspaceId) : null;
    },
    /** PRD 002 §D14: likewise — the one workspace this page is bound to. */
    async openWorkspaceDialog() {
      return workspaceId ? hostedWorkspaceFilePath(workspaceId) : null;
    },
    async setTitle(title) {
      document.title = title;
    },
    async onOpenFile(cb) {
      // PRD 007 Req 2: the page's `?workspace=<id>` binding lands through the
      // same seam an OS file association uses — App routes a .marky-workspace
      // path to its workspace-open flow, so the manifest's settings become
      // the Workspace layer and its blobs become the sidebar's folder root.
      if (workspaceId) cb(hostedWorkspaceFilePath(workspaceId));
    },
    async onFileDrop() {
      /* dropping files in is upload — issue #76's scope */
    },
    async watchFile() {
      // Blob change notification is not part of this issue; nothing to unwatch.
      return () => {};
    },

    async registerCloseGuard(shouldBlock) {
      window.addEventListener('beforeunload', (e) => {
        if (shouldBlock()) e.preventDefault();
      });
    },
    async closeNow() {
      window.close();
    },

    resolveAssetSrc(src, docDir) {
      return hostedResolveAssetSrc(src, docDir, token());
    },

    /**
     * PRD 007 Req 8 (SPEC20 §3): a pasted image becomes a workspace blob —
     * raw bytes through the API, not a data: URI kept in one browser — so it
     * renders for every member holding doc.read.
     */
    async writeBinaryFile(path, bytes) {
      const target = parseHostedPath(path);
      if (!target || target.kind !== 'workspace') throw enoent(path);
      const res = await api(`${apiPathFor(target)}?raw=1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        // A fresh copy: fetch wants a plain ArrayBuffer view it owns.
        body: bytes.slice().buffer as ArrayBuffer,
      });
      invalidate(target);
      if (!res.ok) throw new Error(`binary write failed (${res.status}): ${path}`);
    },

    readDirEntries(dir) {
      return childrenOf(dir);
    },

    async openExternal(url) {
      if (!/^https?:\/\//i.test(url)) return;
      window.open(url, '_blank', 'noopener,noreferrer');
    },

    async copyText(text) {
      await navigator.clipboard.writeText(text);
    },
    ...(typeof navigator !== 'undefined' && navigator.clipboard?.readText
      ? { readClipboardText: () => navigator.clipboard.readText() }
      : {}),
  };
}
