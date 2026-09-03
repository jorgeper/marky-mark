/**
 * PRD 007 Req 2+8+9: the pure mapping between the hosted platform's virtual
 * paths and the server's REST API. The Platform seam speaks in paths, the
 * hosted backend speaks in URLs; this module is the whole translation, with
 * no I/O and no DOM, so every branch is unit-testable without a server.
 *
 * The virtual tree the hosted platform presents:
 *   /config/…              → the signed-in user's own blobs (`/api/me/files/…`),
 *                            outside every workspace prefix — the roaming
 *                            User settings layer and user themes (Req 9)
 *   /w/<id>/workspace.marky-workspace
 *                          → the workspace manifest, seen by the app as the
 *                            PRD 002 §C9 workspace file whose `settings` slot
 *                            IS the manifest's (`/api/workspaces/<id>/manifest`)
 *   /w/<id>/files/…        → the workspace's blobs — documents, comment
 *                            sidecars and pasted images alike, so everything
 *                            one member writes is what another member reads
 *                            (`/api/workspaces/<id>/files/…`, Req 8)
 */

import { WORKSPACE_FILE_EXT } from './workspace.ts';

/** The virtual config directory: the per-user, workspace-independent blobs. */
export const HOSTED_CONFIG_DIR = '/config';
/** The virtual root every hosted workspace hangs under. */
export const HOSTED_WORKSPACE_ROOT = '/w';
/** The one folder a hosted workspace exposes — the workspace IS its prefix. */
export const HOSTED_FILES_DIR = 'files';

/** `/w/<id>` — the directory holding a workspace's virtual workspace file. */
export function hostedWorkspaceDir(id: string): string {
  return `${HOSTED_WORKSPACE_ROOT}/${id}`;
}

/**
 * The virtual `.marky-workspace` path for a workspace. The extension matters:
 * App's onOpenFile branch routes it through the workspace-open path
 * (isWorkspaceFilePath), which is how the Workspace settings layer gets
 * populated from the manifest with no hosted branching in app code.
 */
export function hostedWorkspaceFilePath(id: string): string {
  return `${hostedWorkspaceDir(id)}/workspace${WORKSPACE_FILE_EXT}`;
}

/** `/w/<id>/files` — the workspace's single folder root. */
export function hostedFilesRoot(id: string): string {
  return `${hostedWorkspaceDir(id)}/${HOSTED_FILES_DIR}`;
}

/** What a virtual path denotes on the server. */
export type HostedTarget =
  /** A per-user blob; `rel` is '' for the config directory itself. */
  | { kind: 'user'; rel: string }
  /** The workspace manifest, seen by the app as its workspace file. */
  | { kind: 'manifest'; id: string }
  /** A workspace blob; `rel` is '' for the files root itself. */
  | { kind: 'workspace'; id: string; rel: string };

/** Collapse `//`, `.` and `..` in a POSIX-ish virtual path. */
export function normalizeHostedPath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

/**
 * Interpret a virtual path. Null for anything outside the two roots — the
 * hosted platform has no filesystem to fall back to, so an unmapped path is
 * an error at the call site rather than a silent read of nothing.
 */
export function parseHostedPath(path: string): HostedTarget | null {
  const segments = normalizeHostedPath(path).split('/').slice(1);
  if (segments[0] === HOSTED_CONFIG_DIR.slice(1)) {
    return { kind: 'user', rel: segments.slice(1).join('/') };
  }
  if (segments[0] !== HOSTED_WORKSPACE_ROOT.slice(1) || !segments[1]) return null;
  const id = segments[1];
  const rest = segments.slice(2);
  if (rest.length === 1 && rest[0] === `workspace${WORKSPACE_FILE_EXT}`) return { kind: 'manifest', id };
  if (rest[0] !== HOSTED_FILES_DIR) return null;
  return { kind: 'workspace', id, rel: rest.slice(1).join('/') };
}

const encodeRel = (rel: string): string => rel.split('/').map(encodeURIComponent).join('/');

/** The API path a target reads and writes through (query string excluded). */
export function apiPathFor(target: HostedTarget): string {
  if (target.kind === 'user') {
    return target.rel ? `/api/me/files/${encodeRel(target.rel)}` : '/api/me/files';
  }
  if (target.kind === 'manifest') return `/api/workspaces/${encodeURIComponent(target.id)}/manifest`;
  const base = `/api/workspaces/${encodeURIComponent(target.id)}/files`;
  return target.rel ? `${base}/${encodeRel(target.rel)}` : base;
}

/**
 * PRD 007 Req 8: the URL an <img> in a rendered document loads a workspace
 * blob from. An image element cannot carry an Authorization header, so the
 * bearer token rides in the query string — the server accepts it there for
 * GETs only (server/app.ts), it never leaves the app's own origin, and the
 * app's external-link policy means the URL is never sent as a Referer to
 * anyone else.
 */
export function hostedAssetUrl(id: string, rel: string, token: string): string {
  return `${apiPathFor({ kind: 'workspace', id, rel })}?raw=1&access_token=${encodeURIComponent(token)}`;
}

/** Schemes a rendered <img src> keeps verbatim — nothing to resolve. */
const ABSOLUTE_SRC = /^(data:|blob:|https?:)/i;

/**
 * PRD 007 Req 8: map a doc-relative `<img src>` to a URL the signed-in
 * webview can load. `docDir` is the virtual directory of the open document,
 * so a sibling `images/pic.png` resolves inside the same workspace and every
 * member with doc.read sees the same bytes. Anything outside a workspace
 * (or an unresolvable ref) neutralizes to '' rather than pointing the webview
 * at a path it would only 404 on.
 */
export function hostedResolveAssetSrc(src: string, docDir: string, token: string): string {
  if (!src) return '';
  if (ABSOLUTE_SRC.test(src)) return src;
  const decoded = src
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
  const absolute = decoded.startsWith('/') ? decoded : `${docDir}/${decoded}`;
  const target = parseHostedPath(absolute);
  return target?.kind === 'workspace' && target.rel ? hostedAssetUrl(target.id, target.rel, token) : '';
}

/**
 * PRD 007 Req 2: which workspace this hosted page is bound to — `?workspace=`
 * on the SPA's own URL. Workspace create/open flows are issue #75's scope;
 * until they land the query parameter is the whole binding, and its absence
 * simply means "signed in, no workspace open" (the normal splash).
 */
export function workspaceIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('workspace');
  return id && !id.includes('/') ? id : null;
}

/**
 * PRD 019 Req 1: the hosted client's one reserved path. A GET of
 * `<base URL>/scratchpad` is served by the SPA fallback like any other path;
 * recognizing it is the client's job, and this predicate is that whole
 * recognition — pure, so the route is unit-testable without a DOM. Only the
 * exact path (with an optional trailing slash) matches: anything nested or
 * differently cased is not the scratchpad and boots as a normal page.
 */
export const SCRATCHPAD_PATH = '/scratchpad';

export function isScratchpadPath(pathname: string): boolean {
  return pathname === SCRATCHPAD_PATH || pathname === `${SCRATCHPAD_PATH}/`;
}

/**
 * PRD 007 Req 9: the manifest's `settings` slot presented as the PRD 002 §C9
 * workspace-file JSON. The single folder is the workspace's own blob prefix,
 * relative to the virtual workspace file's directory.
 */
export function manifestSettingsToWorkspaceFile(settings: Record<string, unknown>): string {
  return `${JSON.stringify({ version: 1, folders: [HOSTED_FILES_DIR], settings }, null, 2)}\n`;
}

/**
 * The reverse: the `settings` slot to PUT back when the app rewrites the
 * workspace file. Folders are not a hosted concept (the workspace IS its
 * prefix), so only the settings survive the round trip.
 */
export function workspaceFileToManifestSettings(json: string): Record<string, unknown> {
  try {
    const data = JSON.parse(json) as { settings?: unknown };
    const settings = data.settings;
    return typeof settings === 'object' && settings !== null && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
