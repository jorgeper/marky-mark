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
import type { RecentStore } from './recentFiles.ts';

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

/**
 * PRD 007 Req 11 (issue #312): the workspace ids in a recent store, most
 * recent first. Hosted opens remember the virtual manifest path
 * (`/w/<id>/workspace.marky-workspace`) in the per-user recent-workspaces.json,
 * so the ids the Open dialog orders by are read straight off those entries;
 * anything that is not a manifest path (a document, a `/config/…` blob, a
 * desktop path that somehow roamed) is dropped rather than misread as an id.
 */
export function recentWorkspaceIds(store: RecentStore): string[] {
  const ids: string[] = [];
  for (const entry of store.entries) {
    const target = parseHostedPath(entry.path);
    if (target?.kind === 'manifest') ids.push(target.id);
  }
  return ids;
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
 * PRD 020 Req 10+11, amended by issue #244: the scratchpad route word, back to
 * PRD 019 Req 1's own spelling. `/scratchpad` alone is the Req 11 shortcut to
 * the visitor's own scratchpad workspace. As a SECOND segment it is reserved:
 * `/<seg1>/scratchpad[/<file…>]` always addresses user seg1's scratchpad
 * workspace, never a folder named `scratchpad` inside workspace seg1 (the
 * documented shadowing, PRD 020 Non-goals). Compared case-insensitively, like
 * workspace-name matching itself.
 */
export const SCRATCH_SEGMENT = 'scratchpad';

/**
 * Issue #244: the word PRD 020 Req 10 shipped, kept as a PARSE-ONLY alias so
 * bookmarked and shared `/scratch` and `/<username>/scratch[/<file…>]` URLs
 * still resolve. Nothing emits it — buildScratchPath writes only the
 * canonical word, and resolveHostedVisit's replaceState rewrite is what puts
 * a legacy visit's address bar on the canonical URL (HostedSignIn.tsx).
 */
export const LEGACY_SCRATCH_SEGMENT = 'scratch';

/** Either route word, compared the case-insensitive workspace-name way. */
const isScratchSegment = (segment: string): boolean => {
  const key = uniqueNameKey(segment);
  return key === SCRATCH_SEGMENT || key === LEGACY_SCRATCH_SEGMENT;
};

/**
 * PRD 020 Req 5+10+11: what a hosted page's `location.pathname` addresses.
 * `home` is the plain start page, `scratch` the Req 11 shortcut,
 * `user-scratch` one user's scratchpad workspace (optionally a file in it),
 * and everything else is a workspace by unique name — bare (`/<name>`) or
 * with a file inside it (`/<name>/<segments…>`), each `file` entry one
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
  // PRD 020 Req 11 + issue #244: exactly `/scratchpad` (or its legacy alias
  // `/scratch`) is the shortcut; anything nested under either resolves as a
  // workspace by that name — both reserved, so never found.
  if (segments.length === 1 && isScratchSegment(segments[0])) return { kind: 'scratch' };
  // PRD 020 Req 10 + issue #244: `scratchpad` (or legacy `scratch`) as the
  // second segment is reserved for user seg1's scratchpad workspace, whatever
  // comes after it.
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
 * PRD 020 Req 10+13 (issue #244): the canonical URL of one user's scratchpad
 * workspace — `/<username>/scratchpad`, or `/<username>/scratchpad/<segments…>`
 * for a file in it, percent-encoded per segment exactly like buildAppPath.
 * Only the canonical word is ever emitted; the legacy alias is parse-only.
 */
export function buildScratchPath(username: string, file: readonly string[] = []): string {
  return buildAppPath(username, [SCRATCH_SEGMENT, ...file]);
}

/**
 * PRD 024 Req 11+12 (issue #302): where the address bar goes when the
 * workspace this page is bound to is renamed. The visited path already names
 * the open file (PRD 020 Req 6 keeps it there), so the rename replaces the
 * workspace segment alone and keeps both the file segments and the
 * `#<heading>` fragment the URL arrived with — the tab is looking at the same
 * document, at the same heading, under a new name.
 *
 * Null means "leave the bar exactly as it is": the start page and both
 * scratchpad routes (PRD 020 Req 10/11) address their workspace by something
 * other than its unique name, so a new unique name moves nothing there.
 */
export function renamedWorkspaceUrl(pathname: string, hash: string, newName: string): string | null {
  const target = parseAppPath(pathname);
  if (target.kind !== 'workspace') return null;
  return `${buildAppPath(newName, target.file)}${hash}`;
}

/** PRD 020 Req 10+11: the two targets that address a scratchpad workspace. */
type ScratchTarget = Extract<AppPathTarget, { kind: 'scratch' | 'user-scratch' }>;

/**
 * PRD 020 Req 12: does this target address the CALLER'S OWN scratchpad?
 * `/scratchpad` is definitionally the caller's own;
 * `/<username>/scratchpad[/…]` matches its username against the caller's
 * handle through `uniqueNameKey`, the same case-insensitive comparison
 * workspace-name matching makes. A caller whose handle never resolved owns no
 * scratchpad here.
 */
export function isOwnScratch(target: AppPathTarget, callerHandle: string | undefined): target is ScratchTarget {
  if (callerHandle === undefined) return false;
  if (target.kind === 'scratch') return true;
  return target.kind === 'user-scratch' && uniqueNameKey(target.username) === uniqueNameKey(callerHandle);
}

/**
 * PRD 023 Reqs 1–5 (amending PRD 019 Req 10): the ONE scratchpad boot
 * decision. A visit boots the fresh buffer iff it enters the caller's own
 * scratchpad workspace with no target file — whatever route delivered it (the
 * legacy `/scratch` spelling included). A file segment (Req 2), someone else's
 * scratchpad (Req 5), or a caller with no resolved handle boots nothing.
 * Stateless on purpose (Req 4): re-entry asks the same question and gets the
 * same yes, so the new buffer silently replaces whatever was open.
 */
export function scratchBootsFresh(target: AppPathTarget, callerHandle: string | undefined): boolean {
  // `/scratchpad` carries no file segments at all; the canonical form must
  // likewise name none.
  return isOwnScratch(target, callerHandle) && (target.kind === 'scratch' || target.file.length === 0);
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
