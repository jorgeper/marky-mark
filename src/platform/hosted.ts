import type { Platform } from './types';
import { createLocalDocs } from './localDocs';
import { clearToken, readStoredToken } from '../lib/hostedGate';
import { createHostedWorkspaceLifecycle } from './hostedWorkspaces';
import { createHostedLlm } from './hostedLlm';
import { createHostedSummaryCache } from './hostedSummaryCache';
import { ALL_FILE_GRANTS, fileGrantsFromPermissions, type FileGrants } from '../lib/fileGrants';
import { uploadRejection } from '../lib/fileTransfer';
import { parseWorkspaceManifest, resolvePermissions, type Permission } from '../lib/hostedWorkspace';
import { SaveConflictError } from '../lib/saveConflict';
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

/**
 * PRD 007 Req 18: the marker blob that makes an empty folder real (the server
 * writes it; `FOLDER_PLACEHOLDER` in server/workspaces.ts is the same name).
 * Blob storage has no directories, so without it a folder the user just
 * created would not survive the next listing. It never appears as a row: the
 * tree hides dotfiles anyway, and directory listings drop it explicitly here
 * so nothing downstream — rename, delete, collision checks — ever sees it.
 */
const FOLDER_PLACEHOLDER = '.mmkeep';

/**
 * The listing endpoint a target's blobs are enumerated through — one per
 * listable scope (the user's own blobs, or one workspace's files), which is
 * also what the listing cache keys on. The manifest is not listable.
 */
const listRootOf = (target: HostedTarget): string | null => {
  if (target.kind === 'user') return apiPathFor({ kind: 'user', rel: '' });
  if (target.kind === 'workspace') return apiPathFor({ kind: 'workspace', id: target.id, rel: '' });
  return null;
};

/**
 * A workspace route outside the files/manifest pair `apiPathFor` covers —
 * `/api/workspaces/<id>/<route>[/<rel>]`, every segment percent-encoded (a
 * blob name may hold anything a URL gives meaning to).
 */
const workspaceRoute = (id: string, route: string, rel?: string): string => {
  const base = `/api/workspaces/${encodeURIComponent(id)}/${route}`;
  return rel ? `${base}/${rel.split('/').map(encodeURIComponent).join('/')}` : base;
};

export function createHostedPlatform(): Platform {
  const token = () => readStoredToken(window.localStorage) ?? '';
  const workspaceId = workspaceIdFromSearch(window.location.search);

  /**
   * PRD 007 Req 10/11/12: the workspace lifecycle the New/Open dialogs and
   * the Settings delete action drive. It is the hosted flavor's answer to
   * the desktop's file-based workspace picking, offered as a capability so
   * no app code has to know which flavor it is running in. Held in a const
   * because sign-out (Req 17) lands through the very same navigation seam
   * rather than writing the URL a second way.
   */
  const workspaces = createHostedWorkspaceLifecycle();

  /**
   * PRD 007 Req 21 (PRD 009 Req 4/5): local-file mode. A Markdown file the
   * user picks or drops opens fully client-side — the same machinery the
   * single-file web build uses (platform/localDocs.ts), with nothing
   * uploaded. It is a MODE, not a document that can share the screen with a
   * workspace: App closes any open workspace before it opens one of these.
   * Its documents hang under `/local`, which `parseHostedPath` deliberately
   * does not resolve: a local doc can never turn into a request against
   * `/api/workspaces/...`, so every read, write and save below answers from
   * memory (or the browser's own file handle) before the API is ever
   * considered.
   */
  const local = createLocalDocs('local');

  /**
   * The bundle's hosted-platform network call site (SPEC11 §6.6 bundle-scan
   * allowlist): every API request this platform makes funnels through here,
   * always same-origin and always bearer-authenticated.
   */
  const api = (
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {},
  ): Promise<Response> =>
    fetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token()}` } });

  const json = async <T>(res: Response): Promise<T | null> => (res.ok ? ((await res.json()) as T) : null);

  /**
   * PRD 007 Req 17: what to tell the user about a refused request. The UI
   * hides what a role cannot do, but a role changed in another tab (or a
   * grant set cached since page load) can still meet a 403 — and then the
   * server's NAMED verb is the actionable part, exactly as the members/roles
   * endpoints already report it (platform/hostedWorkspaces.ts).
   */
  const refusal = async (res: Response, fallback: string): Promise<string> => {
    const body = (await res.json().catch(() => null)) as { error?: string; required?: string } | null;
    if (res.status === 403 && body?.required) return `You need the ${body.required} permission to do that.`;
    return body?.error ?? fallback;
  };

  // Listings are the answer to `exists` and both directory reads, and the app
  // asks constantly (every doc open probes for a sidecar). One listing per
  // scope is cached and invalidated by this platform's own writes.
  const listings = new Map<string, Promise<ListedFile[]>>();

  const invalidate = (target: HostedTarget): void => {
    const root = listRootOf(target);
    if (root) listings.delete(root);
  };

  /** The relative blob paths under one scope, for directory-shaped questions. */
  const relPathsOf = async (target: HostedTarget): Promise<string[]> => {
    const root = listRootOf(target);
    if (!root) return [];
    let pending = listings.get(root);
    if (!pending) {
      pending = api(root)
        .then((res) => json<ListedFile[]>(res))
        .then((files) => files ?? [])
        .catch(() => [] as ListedFile[]);
      listings.set(root, pending);
    }
    return (await pending).map((f) => f.path);
  };

  /** Direct children of a virtual directory, as name + isDir. */
  const childrenOf = async (dir: string): Promise<Array<{ name: string; isDir: boolean }>> => {
    const target = parseHostedPath(dir);
    if (!target || target.kind === 'manifest') return [];
    const prefix = target.rel ? `${target.rel}/` : '';
    const seen = new Map<string, boolean>();
    for (const rel of await relPathsOf(target)) {
      if (!rel.startsWith(prefix)) continue;
      const tail = rel.slice(prefix.length);
      if (!tail) continue;
      const slash = tail.indexOf('/');
      const name = slash === -1 ? tail : tail.slice(0, slash);
      if (slash === -1 && name === FOLDER_PLACEHOLDER) continue; // the folder marker is not a row
      seen.set(name, seen.get(name) === true || slash !== -1);
    }
    return [...seen].map(([name, isDir]) => ({ name, isDir }));
  };

  /** True when `target` names a directory prefix rather than one blob. */
  const isDirTarget = async (target: HostedTarget & { kind: 'workspace' }): Promise<boolean> => {
    const paths = await relPathsOf(target);
    return paths.some((p) => p.startsWith(`${target.rel}/`));
  };

  /**
   * PRD 007 Req 20: the ETag each path was last READ or WRITTEN at. A save
   * carries it as `If-Match`, so a save against a blob another member has
   * written since is refused by the server rather than silently replacing
   * their work. A path with no recorded tag (a first write) writes
   * unconditionally — there is nothing yet to conflict with.
   */
  const etags = new Map<string, string>();

  /**
   * PRD 016 Req 9: the text each path was last read or saved at — the merge
   * base a conditional workspace save now carries, so a stale save can land
   * as a server-side three-way merge on any backend (blob included). Armed
   * and dropped in lockstep with `etags`.
   */
  const bases = new Map<string, string>();

  /**
   * PRD 007 Req 17: the signed-in member's verbs in the bound workspace,
   * resolved from its manifest. An unanswerable question — no workspace
   * bound, no session, a manifest that will not parse — resolves to no verbs
   * at all: the sidebar then offers nothing it cannot back up.
   */
  const myPermissions = async (): Promise<ReadonlySet<Permission>> => {
    if (!workspaceId) return new Set();
    // Who is asking and what the manifest says are independent questions —
    // both requests are in flight at once.
    const [meRes, manifestRes] = await Promise.all([
      api('/api/me'),
      api(apiPathFor({ kind: 'manifest', id: workspaceId })),
    ]);
    const me = await json<{ id: string }>(meRes);
    const body = await json<{ manifest: unknown }>(manifestRes);
    if (!me || !body) return new Set();
    const parsed = parseWorkspaceManifest(JSON.stringify(body.manifest));
    return parsed.ok ? resolvePermissions(parsed.manifest, me.id) : new Set();
  };

  /** The one resolution per page load — see `fileGrants` below. */
  let grants: Promise<FileGrants> | null = null;

  const readManifest = async (id: string) => {
    const res = await api(apiPathFor({ kind: 'manifest', id }));
    const body = await json<{ manifest: { settings?: Record<string, unknown> } }>(res);
    if (!body) {
      // PRD 010 Req 18: a workspace whose connected repository cannot be
      // reached is NOT "no longer there". The server answers the named,
      // actionable reason at a 400/502; only a real 404 is an absent
      // workspace, and only that keeps today's ENOENT phrasing.
      if (res.status !== 404) throw new Error(await refusal(res, `workspace ${id} could not be opened`));
      throw enoent(`workspace ${id}`);
    }
    return body.manifest;
  };

  return {
    kind: 'hosted',
    isMac: navigator.platform.toLowerCase().includes('mac'),

    async readTextFile(path) {
      if (local.owns(path)) {
        const doc = local.docs.get(path);
        if (!doc) throw enoent(path);
        return doc.content;
      }
      const target = parseHostedPath(path);
      if (!target) throw enoent(path);
      // PRD 007 Req 9: the workspace file the app opens IS the manifest —
      // its `settings` slot becomes the PRD 002 Workspace layer with no
      // hosted-specific code in App.
      if (target.kind === 'manifest') {
        return manifestSettingsToWorkspaceFile((await readManifest(target.id)).settings ?? {});
      }
      const body = await json<{ content: string; etag: string }>(await api(apiPathFor(target)));
      if (!body) throw enoent(path);
      // PRD 007 Req 20: the version this session read — the save that follows
      // is conditional on it.
      if (body.etag) {
        etags.set(path, body.etag);
        // PRD 016 Req 9: the loaded text is the merge base the next
        // conditional save will carry.
        bases.set(path, body.content);
      } else {
        etags.delete(path);
        bases.delete(path);
      }
      return body.content;
    },

    async writeTextFile(path, content, opts) {
      // PRD 007 Req 21: a local doc's save stays local — write-through to the
      // file handle the browser granted, never a request.
      if (local.owns(path)) return local.write(path, content);
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
      // PRD 007 Req 20: `overwrite` is the user's explicit answer to a
      // conflict prompt — it drops the precondition, so the write lands
      // whatever the server now holds, and re-arms the tag for the next save.
      const known = opts?.overwrite ? undefined : etags.get(path);
      // PRD 016 Req 9: every conditional save of a workspace document this
      // session loaded carries the base text it loaded, as the JSON body the
      // server distinguishes by Content-Type — that base is what lets a stale
      // save merge on a backend with no version history. The per-user files
      // route knows only the bare-text body, so user-config saves keep it.
      const base = known !== undefined && target.kind === 'workspace' ? bases.get(path) : undefined;
      const res = await api(apiPathFor(target), {
        method: 'PUT',
        ...(known && base !== undefined
          ? {
              body: JSON.stringify({ content, base }),
              headers: { 'Content-Type': 'application/json', 'If-Match': known },
            }
          : { body: content, ...(known ? { headers: { 'If-Match': known } } : {}) }),
      });
      invalidate(target);
      if (res.status === 412) {
        // The server refused the write; the stored content is untouched.
        throw new SaveConflictError(path);
      }
      if (!res.ok) throw new Error(await refusal(res, `write failed (${res.status}): ${path}`));
      const written = await json<{ etag: string; merged?: boolean; content?: string }>(res);
      // PRD 016 Req 9: what LANDED is the next save's merge base — the sent
      // text, or the merged text when the server merged someone else's
      // changes in. Re-armed (or dropped) in lockstep with the etag,
      // including the overwrite re-arm.
      const landed = written?.merged && typeof written.content === 'string' ? written.content : content;
      if (written?.etag) {
        etags.set(path, written.etag);
        bases.set(path, landed);
      } else {
        etags.delete(path);
        bases.delete(path);
      }
      // PRD 010 Req 12+13: the server merged someone else's changes into this
      // save and committed the result. The etag re-armed just above is the
      // MERGED version's, so the next conditional save is guarded against it;
      // the merged text goes up to the caller, because what landed is not
      // what was sent. A 412 still throws SaveConflictError above — this is
      // the only other response shape the write knows.
      if (written?.merged && typeof written.content === 'string') {
        return { merged: true, content: written.content };
      }
    },

    async exists(path) {
      if (local.owns(path)) return local.docs.has(path);
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
      if (local.owns(path)) {
        local.docs.delete(path);
        return;
      }
      const target = parseHostedPath(path);
      if (!target || target.kind === 'manifest') return;
      await api(apiPathFor(target), { method: 'DELETE' });
      invalidate(target);
    },

    async readDirNames(dir) {
      return (await childrenOf(dir)).map((e) => e.name);
    },
    /**
     * PRD 007 Req 18: creating a folder. A prefix under a document is
     * implicit (writing `a/b/c.md` makes `a/b` exist), so the only case that
     * needs the server is an EMPTY folder — which becomes the placeholder
     * blob, and so is still there after a reload. Per-user config directories
     * take the implicit path, unchanged.
     */
    async mkdirp(dir) {
      const target = parseHostedPath(dir);
      if (target?.kind !== 'workspace' || !target.rel) return;
      await api(workspaceRoute(target.id, 'folders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: target.rel }),
      });
      invalidate(target);
    },

    /**
     * SPEC35 §1 + PRD 007 Req 18: rename AND move, for a file or a whole
     * folder. Which of the two routes runs is decided from the listing, and
     * each route checks its own single verb (`file.rename` / `folder.manage`)
     * — a member who may rename files but not manage folders is refused the
     * folder move by the server, not merely by a hidden menu item.
     */
    async renameEntry(oldPath, newPath) {
      const from = parseHostedPath(oldPath);
      const to = parseHostedPath(newPath);
      if (from?.kind !== 'workspace' || to?.kind !== 'workspace' || from.id !== to.id) throw enoent(oldPath);
      const route = (await isDirTarget(from)) ? 'move-folder' : 'move-file';
      const res = await api(workspaceRoute(from.id, route), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: from.rel, to: to.rel }),
      });
      invalidate(from);
      if (!res.ok) {
        const body = await json<{ error?: string }>(res);
        throw new Error(body?.error ?? `move failed (${res.status})`);
      }
      // The moved blobs answer under their new tags; forget the stale ones
      // (and the merge bases keyed the same way).
      etags.clear();
      bases.clear();
    },

    /**
     * SPEC35 §1: the sidebar's delete. PRD 007 non-goals: there is no hosted
     * trash, no undelete and no version browsing — nothing the app offers
     * brings a deleted entry back, whatever the backend, so the confirmation
     * may never promise recovery.
     *
     * PRD 010 Req 21: what it may say beyond that is per WORKSPACE, not per
     * platform. On the blob backend the content is gone; on the github
     * backend (deployment default or a BYO repo) the repository's history
     * retains it. The listing row carries that fact as `retainsHistory` and
     * `deleteRetention()` combines the two — this stays a flat `true` because
     * as far as this platform's own API goes, the delete is final.
     */
    permanentDelete: true,

    async trashEntry(path) {
      const target = parseHostedPath(path);
      if (target?.kind !== 'workspace' || !target.rel) throw enoent(path);
      const dir = await isDirTarget(target);
      const res = await api(
        dir ? workspaceRoute(target.id, 'folders', target.rel) : apiPathFor(target),
        { method: 'DELETE' },
      );
      invalidate(target);
      if (!res.ok) throw new Error(await refusal(res, `delete failed (${res.status}): ${path}`));
      etags.delete(path);
      bases.delete(path);
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

    /**
     * PRD 007 Req 21: the start page's Open File — the browser's own picker,
     * opening the chosen Markdown file client-side. Nothing is uploaded and
     * no workspace has to be open for it to work.
     */
    async openFileDialog() {
      return local.pick();
    },
    /**
     * PRD 007 Req 21 + PRD 009 Req 15: an explicit Save of a local doc — in
     * place through its file handle where the browser grants it, a download
     * of a handle-less one (or of a write that could not land). The shared
     * localDocs store owns that decision for both browser flavors.
     */
    async commitFile(path) {
      if (local.owns(path)) await local.commit(path);
    },
    /**
     * SPEC34 §1: the folder sidebar's picker seam. A hosted workspace IS its
     * blob prefix — there is nothing to browse for — so the "picker" answers
     * the bound workspace's root. Defining it is what makes the sidebar
     * render at all (App gates the whole feature on this capability); the
     * workspace-picking UI proper is issue #75's scope.
     *
     * PRD 007 Req 21: and precisely because this is not a local folder pick,
     * the flavor never declares `localFolders` — so the start page and File
     * menu offer no Open Folder…, derived from that capability rather than
     * from `kind === 'hosted'` (Req 2).
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
    /**
     * PRD 007 Req 21: the two hosted drop targets, kept disjoint. The FOLDER
     * SIDEBAR owns a drop on itself — that is the #76 upload into the folder
     * the file landed on (FolderPanel's `onUploadDrop`, which stops the event
     * before it reaches the window). THIS window-level drop owns everything
     * else, the start page included: it opens a dropped Markdown file locally,
     * uploading nothing. One drop therefore only ever fires one of the two.
     *
     * PRD 009 Req 4/5: a drop here is a crossing action — with a workspace
     * open, App closes it (dirty prompts and all) and lands in single-file
     * mode, so a dropped file never joins the workspace's own documents.
     */
    async onFileDrop(cb) {
      local.listenForDrop(cb);
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

    /**
     * PRD 007 Req 17: the affordances this member's verbs allow, so the app
     * offers only what they can actually do. Resolved once and cached for the
     * page's lifetime: permissions change in the members UI (#77), which
     * reloads.
     *
     * PRD 007 Req 21: a local doc is not workspace content — nobody's role
     * governs a file the browser opened client-side, so it keeps every
     * affordance. PRD 009 Req 5 retired the case this once had to survive (a
     * local doc open INSIDE a workspace that grants nothing); the exemption
     * stays because the grants cache outlives the workspace it was read for.
     */
    fileGrants: (path) =>
      path !== undefined && local.owns(path)
        ? Promise.resolve(ALL_FILE_GRANTS)
        : (grants ??= myPermissions().then(fileGrantsFromPermissions)),

    /**
     * PRD 007 Req 19: single-file upload through its own `file.upload` route.
     * The shared rule runs here too — a caller reaching this seam with an
     * oversize or disallowed file is stopped before a request is made, and
     * the server applies the identical rule again on arrival (Req 17).
     */
    async uploadFile(dir, name, bytes) {
      const target = parseHostedPath(`${dir}/${name}`);
      if (target?.kind !== 'workspace' || !target.rel) throw enoent(`${dir}/${name}`);
      const rejection = uploadRejection(name, bytes.length);
      if (rejection) throw new Error(rejection);
      const res = await api(workspaceRoute(target.id, 'upload', target.rel), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        // A fresh copy: fetch wants a plain ArrayBuffer view it owns.
        body: bytes.slice().buffer as ArrayBuffer,
      });
      invalidate(target);
      if (!res.ok) {
        const body = await json<{ error?: string }>(res);
        throw new Error(body?.error ?? `upload failed (${res.status})`);
      }
      return normalizeHostedPath(`${dir}/${name}`);
    },

    /**
     * PRD 007 Req 19: single-file download through its own `file.download`
     * route — the workspace blob's own bytes, saved under its own basename.
     * The bytes arrive through the authenticated fetch (an <a href> cannot
     * carry the bearer token) and are handed to the browser as an object URL.
     */
    async downloadFile(path) {
      const target = parseHostedPath(path);
      if (target?.kind !== 'workspace' || !target.rel) throw enoent(path);
      const res = await api(workspaceRoute(target.id, 'download', target.rel));
      if (!res.ok) throw new Error(`download failed (${res.status}): ${path}`);
      const url = URL.createObjectURL(await res.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = target.rel.split('/').pop() ?? 'download';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoked on a delay, like the web flavor's download helper: the click
      // only STARTS the save, and a URL revoked under it can cancel it.
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },

    workspaces,

    /**
     * PRD 011 Req 8+13: the deployment's LLM, reached only through this app's
     * own origin — built on the `api()` wrapper above, so it adds no network
     * call site and the operator's key stays server-side where the browser can
     * neither read it nor change it.
     */
    llm: createHostedLlm(api),

    /**
     * PRD 011 Req 29: the workspace's shared summary cache, server-side and
     * reached only through `api()` above — no new network call site, and the
     * blobs never enter the workspace's files or a connected repository.
     * Present only when this page IS bound to a workspace: a personal-files
     * session has no workspace to scope a shared cache to, and the capability
     * being absent is how app code learns that.
     */
    ...(workspaceId ? { summaryCache: createHostedSummaryCache(api, workspaceId) } : {}),

    // PRD 009 Req 17: sign-out is client-side only — the bearer token IS the
    // session, so dropping it (through hostedGate's one owner of that key)
    // ends it, with no endpoint to call and no new network call site. The
    // landing is the lifecycle seam's own origin-root navigation: it drops
    // any `?workspace=<id>` binding, so the boot that follows finds no token
    // and renders the sign-in screen bound to nothing.
    signOut() {
      clearToken(window.localStorage);
      workspaces.navigateTo(null);
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
