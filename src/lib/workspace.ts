/**
 * PRD 002 §C7–§C13: the workspace model — pure data types and transitions,
 * the `.marky-workspace` file's parse/serialize pair, per-workspace
 * machine-local session state, and the legacy foldertree.json adoption
 * (§G24). No I/O and no platform imports; App.tsx owns the reads/writes.
 *
 * §C7: the three states — no workspace, untitled workspace, named
 * workspace — form a single union, so one `Workspace` value IS the current
 * workspace: at most one is representable at a time by construction.
 */

import { EXPANDED_CAP, type FolderState } from './folderTree';
import { OPEN_CAP } from './openFiles';
import { SETTINGS_SCOPES, type Scope } from './settings';

export const WORKSPACE_FILE_EXT = '.marky-workspace';
/** Machine-local session stores live under `<configDir>/session/` (§B6). */
export const SESSION_DIR_NAME = 'session';
/** §C11: the single current-untitled slot. */
export const UNTITLED_SLOT_FILE = 'untitled.json';
/** §C13: which workspace to reopen at launch. */
export const CURRENT_POINTER_FILE = 'current.json';

/** A member folder; unreachable roots stay flagged, never dropped (§C10). */
export interface WorkspaceFolder {
  path: string;
  available: boolean;
}

export type Workspace =
  | { kind: 'none' }
  | { kind: 'untitled'; folders: WorkspaceFolder[]; settings: Record<string, unknown> }
  | { kind: 'named'; file: string; folders: WorkspaceFolder[]; settings: Record<string, unknown> };

// --- transitions (§C8) -------------------------------------------------------

/** Opening a folder starts a FRESH untitled workspace holding just it (§C8/§C11). */
export function openFolderWorkspace(_current: Workspace, path: string): Workspace {
  return { kind: 'untitled', folders: [{ path, available: true }], settings: {} };
}

/** Append a folder, preserving order and deduplicating repeats (§C8). */
export function addWorkspaceFolder(ws: Workspace, path: string): Workspace {
  if (ws.kind === 'none') return openFolderWorkspace(ws, path);
  if (ws.folders.some((f) => f.path === path)) return ws;
  return { ...ws, folders: [...ws.folders, { path, available: true }] };
}

/** Save As…: an untitled (or named) workspace retargets to `file` (§C11). */
export function saveWorkspaceAs(ws: Workspace, file: string): Workspace {
  if (ws.kind === 'none') return ws;
  return { kind: 'named', file, folders: ws.folders, settings: ws.settings };
}

export function closeWorkspace(_ws: Workspace): Workspace {
  return { kind: 'none' };
}

/**
 * Issue #22: an untitled workspace counts as CHANGED when discarding it would
 * lose state — its workspace-scope settings map is non-empty or it holds more
 * than one folder. Named workspaces autosave (§C12) and the none state has
 * nothing to lose, so neither ever prompts.
 */
export function untitledWorkspaceChanged(ws: Workspace): boolean {
  if (ws.kind !== 'untitled') return false;
  return Object.keys(ws.settings).length > 0 || ws.folders.length > 1;
}

// --- paths (§C10) ------------------------------------------------------------

interface AbsParts {
  /** '' for POSIX, 'C:' (uppercased) for a Windows drive. */
  root: string;
  segs: string[];
}

const splitSegs = (p: string): string[] => p.split(/[\\/]+/).filter((s) => s.length > 0);

/** Collapse '.' and '..' segments (a '..' at the root is dropped). */
function collapseSegs(segs: string[]): string[] {
  const out: string[] = [];
  for (const s of segs) {
    if (s === '.') continue;
    if (s === '..') out.pop();
    else out.push(s);
  }
  return out;
}

function parseAbs(p: string): AbsParts | null {
  const drive = /^([A-Za-z]:)(?:[\\/]|$)/.exec(p);
  if (drive) return { root: drive[1].toUpperCase(), segs: collapseSegs(splitSegs(p.slice(drive[1].length))) };
  if (/^[\\/]/.test(p)) return { root: '', segs: collapseSegs(splitSegs(p)) };
  return null;
}

function formatAbs(parts: AbsParts): string {
  return parts.root ? `${parts.root}\\${parts.segs.join('\\')}` : `/${parts.segs.join('/')}`;
}

export function isAbsolutePath(p: string): boolean {
  return parseAbs(p) !== null;
}

/** The containing directory of an absolute path (its own root at worst). */
export function parentDirOf(path: string): string {
  const abs = parseAbs(path);
  if (!abs) return path;
  return formatAbs({ root: abs.root, segs: abs.segs.slice(0, -1) });
}

/**
 * Store a folder reference relative to the workspace file's directory where
 * possible (§C10); a different root (drive) keeps the absolute form.
 */
export function relativizeFolderPath(folder: string, workspaceDir: string): string {
  const a = parseAbs(folder);
  const b = parseAbs(workspaceDir);
  if (!a || !b || a.root !== b.root) return folder;
  let i = 0;
  while (i < a.segs.length && i < b.segs.length && a.segs[i] === b.segs[i]) i++;
  const parts = [...Array<string>(b.segs.length - i).fill('..'), ...a.segs.slice(i)];
  return parts.length > 0 ? parts.join('/') : '.';
}

/** Resolve a stored reference to an absolute path against the workspace dir. */
export function resolveFolderPath(stored: string, workspaceDir: string): string {
  const abs = parseAbs(stored);
  if (abs) return formatAbs(abs);
  const base = parseAbs(workspaceDir);
  if (!base) return stored;
  return formatAbs({ root: base.root, segs: collapseSegs([...base.segs, ...splitSegs(stored)]) });
}

// --- the .marky-workspace file (§C9) -----------------------------------------

export interface WorkspaceFileData {
  version: 1;
  /** Ordered folder references as stored (relative where possible). */
  folders: string[];
  /** Workspace-scoped settings: W keys plus pinned cosmetic (U) defaults. */
  settings: Record<string, unknown>;
}

/** Keep only layer-mergeable keys — never M (machine/session) or U! ones. */
export function sanitizeWorkspaceSettings(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const scopes = SETTINGS_SCOPES as Record<string, Scope | undefined>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const scope = scopes[k];
    if (scope === 'U' || scope === 'W') out[k] = v;
  }
  return out;
}

const cleanStrings = (raw: unknown, cap: number): string[] =>
  Array.isArray(raw) ? raw.filter((e): e is string => typeof e === 'string' && e.length > 0).slice(0, cap) : [];

const dedupe = (list: string[]): string[] => [...new Set(list)];

/** Corruption-tolerant parse: malformed input yields a sane empty workspace. */
export function parseWorkspaceFile(json: string): WorkspaceFileData {
  try {
    const d = JSON.parse(json) as Partial<WorkspaceFileData> | null;
    if (typeof d !== 'object' || d === null) return { version: 1, folders: [], settings: {} };
    return {
      version: 1,
      folders: dedupe(cleanStrings(d.folders, EXPANDED_CAP)),
      settings: sanitizeWorkspaceSettings(d.settings),
    };
  } catch {
    return { version: 1, folders: [], settings: {} };
  }
}

/**
 * Pretty-printed JSON with the version marker; folder refs relativized to
 * the file's directory; settings scrubbed of M/U!/session keys (§C9).
 */
export function serializeWorkspaceFile(
  ws: { folders: WorkspaceFolder[]; settings: Record<string, unknown> },
  workspaceDir: string
): string {
  const data: WorkspaceFileData = {
    version: 1,
    folders: ws.folders.map((f) => relativizeFolderPath(f.path, workspaceDir)),
    settings: sanitizeWorkspaceSettings(ws.settings),
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** The resolved absolute member paths, in file order, deduplicated. */
export function workspaceFolderPaths(data: WorkspaceFileData, file: string): string[] {
  const dir = parentDirOf(file);
  return dedupe(data.folders.map((f) => resolveFolderPath(f, dir)));
}

/** Build the named workspace a file describes; unreachable folders stay, flagged. */
export function workspaceFromFile(
  data: WorkspaceFileData,
  file: string,
  unavailable: ReadonlySet<string> = new Set()
): Workspace {
  return {
    kind: 'named',
    file,
    folders: workspaceFolderPaths(data, file).map((path) => ({ path, available: !unavailable.has(path) })),
    settings: data.settings,
  };
}

// --- per-workspace session state (§B6, §C11, §F22) ---------------------------

export interface WorkspaceSession {
  version: 1;
  /** Absolute folder roots, ordered. */
  folders: string[];
  expanded: string[];
  showNonMd: boolean;
  openFiles: string[];
  activeFile: string | null;
  openOnly: boolean;
  /** Untitled slot only: the workspace-scoped settings ride the slot (§C11). */
  settings?: Record<string, unknown>;
}

/** A fresh session for `folders`: nothing expanded, nothing open. */
export function emptyWorkspaceSession(folders: string[] = []): WorkspaceSession {
  return { version: 1, folders, expanded: [], showNonMd: false, openFiles: [], activeFile: null, openOnly: false };
}

export function parseWorkspaceSession(json: string): WorkspaceSession {
  try {
    const d = JSON.parse(json) as Partial<WorkspaceSession> | null;
    if (typeof d !== 'object' || d === null) return emptyWorkspaceSession();
    const openFiles = cleanStrings(d.openFiles, OPEN_CAP);
    const out: WorkspaceSession = {
      version: 1,
      folders: dedupe(cleanStrings(d.folders, EXPANDED_CAP)),
      expanded: cleanStrings(d.expanded, EXPANDED_CAP),
      showNonMd: d.showNonMd === true,
      openFiles,
      activeFile: typeof d.activeFile === 'string' && openFiles.includes(d.activeFile) ? d.activeFile : null,
      openOnly: d.openOnly === true,
    };
    if ('settings' in d) out.settings = sanitizeWorkspaceSettings(d.settings);
    return out;
  } catch {
    return emptyWorkspaceSession();
  }
}

export function serializeWorkspaceSession(s: WorkspaceSession): string {
  return `${JSON.stringify(
    {
      ...s,
      expanded: s.expanded.slice(0, EXPANDED_CAP),
      openFiles: s.openFiles.slice(0, OPEN_CAP),
      ...(s.settings ? { settings: sanitizeWorkspaceSettings(s.settings) } : {}),
    },
    null,
    2
  )}\n`;
}

/** Bridge a session into today's single-root sidebar wiring. */
export function sessionToFolderState(s: WorkspaceSession): FolderState {
  return {
    version: 1,
    root: s.folders[0] ?? null,
    expanded: s.expanded,
    showNonMd: s.showNonMd,
    openFiles: s.openFiles,
    activeFile: s.activeFile,
    openOnly: s.openOnly,
  };
}

/** Stable session-file key for a named workspace: readable slug + FNV-1a hash. */
export function sessionKeyForWorkspaceFile(file: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < file.length; i++) {
    h ^= file.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const base = file.split(/[\\/]/).pop() ?? '';
  const slug =
    base
      .replace(/\.marky-workspace$/i, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace';
  return `ws-${slug}-${h.toString(16).padStart(8, '0')}`;
}

// --- launch pointer (§C13) ---------------------------------------------------

export type WorkspacePointer =
  | { version: 1; kind: 'none' }
  | { version: 1; kind: 'untitled' }
  | { version: 1; kind: 'named'; file: string };

export function parseWorkspacePointer(json: string): WorkspacePointer {
  try {
    const d = JSON.parse(json) as { kind?: unknown; file?: unknown } | null;
    if (typeof d !== 'object' || d === null) return { version: 1, kind: 'none' };
    if (d.kind === 'untitled') return { version: 1, kind: 'untitled' };
    if (d.kind === 'named' && typeof d.file === 'string' && d.file) return { version: 1, kind: 'named', file: d.file };
    return { version: 1, kind: 'none' };
  } catch {
    return { version: 1, kind: 'none' };
  }
}

export function serializeWorkspacePointer(ws: Workspace): string {
  const ptr: WorkspacePointer =
    ws.kind === 'named' ? { version: 1, kind: 'named', file: ws.file } : { version: 1, kind: ws.kind };
  return `${JSON.stringify(ptr, null, 2)}\n`;
}

// --- legacy adoption (§G24) --------------------------------------------------

/**
 * First launch with no session pointer: an existing foldertree.json root is
 * adopted as an untitled workspace with that one folder; the caller keeps
 * applying the foldertree state it already parsed, so today's expanded/tab
 * state carries along. A pure read — the caller rewrites nothing.
 */
export function adoptLegacyFolderState(ft: FolderState): Workspace | null {
  if (!ft.root) return null;
  return { kind: 'untitled', folders: [{ path: ft.root, available: true }], settings: {} };
}
