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
import { uniqueNameKey } from './workspaceNames.ts';

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
 * PRD 020 Req 7: the LEGACY `?workspace=<uuid>` binding. Once the whole URL
 * surface — Req 5's canonical paths — no code path emits this form anymore;
 * parsing it here is what lets the sign-in gate resolve an old bookmark and
 * redirect it to the canonical path (or Req 8's not-found page).
 */
export function workspaceIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('workspace');
  return id && !id.includes('/') ? id : null;
}

/**
 * PRD 020 Req 10+11: the scratch route words. `/scratch` alone is the Req 11
 * shortcut to the visitor's own scratch workspace (replacing PRD 019 Req 1's
 * `/scratchpad`, which now falls through to normal workspace-name resolution
 * and — the name being reserved — the Req 8 not-found page). As a SECOND
 * segment, `scratch` is reserved: `/<seg1>/scratch[/<file…>]` always
 * addresses user seg1's scratch workspace, never a folder named `scratch`
 * inside workspace seg1 (the documented shadowing, PRD 020 Non-goals).
 * Compared case-insensitively, like workspace-name matching itself.
 */
export const SCRATCH_SEGMENT = 'scratch';

const isScratchSegment = (segment: string): boolean => uniqueNameKey(segment) === SCRATCH_SEGMENT;

/**
 * PRD 020 Req 5+10+11: what a hosted page's `location.pathname` addresses.
 * `home` is the plain start page, `scratch` the Req 11 shortcut,
 * `user-scratch` one user's scratch workspace (optionally a file in it), and
 * everything else is a workspace by unique name — bare (`/<name>`) or with a
 * file inside it (`/<name>/<segments…>`), each `file` entry one
 * percent-decoded segment.
 */
export type AppPathTarget =
  | { kind: 'home' }
  | { kind: 'scratch' }
  | { kind: 'user-scratch'; username: string; file: string[] }
  | { kind: 'workspace'; name: string; file: string[] };

/** One URL segment, percent-decoded; a malformed escape stays verbatim. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** PRD 020 Req 5: pathname → target. Pure, so every route is unit-testable. */
export function parseAppPath(pathname: string): AppPathTarget {
  const segments = pathname.split('/').filter((s) => s !== '').map(decodeSegment);
  if (segments.length === 0) return { kind: 'home' };
  // PRD 020 Req 11: exactly `/scratch` is the shortcut; anything nested under
  // it resolves as a workspace named `scratch` — reserved, so never found.
  if (segments.length === 1 && isScratchSegment(segments[0])) return { kind: 'scratch' };
  // PRD 020 Req 10: `scratch` as the second segment is reserved for user
  // seg1's scratch workspace, whatever comes after it.
  if (segments.length >= 2 && isScratchSegment(segments[1])) {
    return { kind: 'user-scratch', username: segments[0], file: segments.slice(2) };
  }
  const [name, ...file] = segments;
  return { kind: 'workspace', name, file };
}

/**
 * PRD 020 Req 5: the inverse — the canonical shareable URL for a workspace
 * (and optionally a file in it), every segment percent-encoded individually
 * so a filename holding `/`-adjacent or reserved characters round-trips.
 */
export function buildAppPath(name: string, file: readonly string[] = []): string {
  return `/${[name, ...file].map(encodeURIComponent).join('/')}`;
}

/**
 * PRD 020 Req 10+13: the canonical URL of one user's scratch workspace —
 * `/<username>/scratch`, or `/<username>/scratch/<segments…>` for a file in
 * it, percent-encoded per segment exactly like buildAppPath.
 */
export function buildScratchPath(username: string, file: readonly string[] = []): string {
  return buildAppPath(username, [SCRATCH_SEGMENT, ...file]);
}

/**
 * PRD 023 Reqs 1–5 (amending PRD 019 Req 10): the ONE scratch boot decision.
 * A visit boots the fresh scratch buffer iff it enters the CALLER'S OWN
 * scratch workspace with no target file — whatever route delivered it.
 * `/scratch` is definitionally the caller's own; `/<username>/scratch`
 * matches its username against the caller's handle case-insensitively, the
 * way workspace-name matching itself does. A file segment (Req 2), someone
 * else's scratch (Req 5), or a caller with no resolved handle boots nothing.
 * Stateless on purpose (Req 4): re-entry asks the same question and gets the
 * same yes, so the new buffer silently replaces whatever was open.
 */
export function scratchBootsFresh(target: AppPathTarget, callerHandle: string | undefined): boolean {
  if (callerHandle === undefined) return false;
  if (target.kind === 'scratch') return true;
  return (
    target.kind === 'user-scratch' &&
    target.file.length === 0 &&
    uniqueNameKey(target.username) === uniqueNameKey(callerHandle)
  );
}

/**
 * PRD 020 Req 5: match a visited name against listing rows the same way the
 * server enforces uniqueness — case-insensitively via `uniqueNameKey`, so
 * `/Notes` and `/notes` open the same workspace. Rows without a unique name
 * (a pre-migration manifest) simply cannot be addressed by path.
 */
export function findWorkspaceByUniqueName<T extends { uniqueName?: string }>(
  rows: readonly T[],
  name: string,
): T | undefined {
  const key = uniqueNameKey(name);
  return rows.find((r) => r.uniqueName !== undefined && uniqueNameKey(r.uniqueName) === key);
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
