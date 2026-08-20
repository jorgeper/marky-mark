/**
 * Named-command registry (SPEC12 §3.1): every user action has one command id;
 * the DOM toolbar (web), the native menu (desktop), and the hotkey listener
 * all dispatch through here. One source of truth — no duplicated handlers.
 */

export type CommandId =
  | 'newFile'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'exportDoc'
  | 'printDoc'
  | 'toggleMode'
  | 'toggleSplit'
  | 'toggleComments'
  | 'nextComment'
  | 'prevComment'
  | 'toggleDiff'
  | 'insertImage'
  | 'headingPalette'
  | 'toggleWordCount'
  | 'toggleFrontmatter'
  // Issue #10: the line-number gutter toggles from View, not Settings.
  | 'toggleLineNumbers'
  | 'clearRecent'
  | 'find'
  | 'toggleFolders'
  // PRD 012 Req 10: the TOC view — the toolbar button and the hotkey both
  // dispatch this one id rather than calling the handler twice over.
  | 'toggleToc'
  // PRD 014 Req 2: the Search view — the switch's button and the panel's own
  // chrome dispatch this one id (issue #155's hotkey joins them later).
  | 'toggleSearch'
  | 'toggleOpenOnly'
  // PRD 013 Req 13: show/hide the file tab strip — the View item and the
  // in-app flyout dispatch this one id; deliberately no hotkey (non-goal).
  | 'toggleFileTabs'
  | 'nextFile'
  | 'prevFile'
  | 'openFolder'
  // PRD 007 Req 19: single-file upload/download — present only where the
  // platform offers the seam and the user holds the verb.
  | 'uploadFile'
  | 'downloadFile'
  // Issue #22: close the open document down to the splash.
  | 'closeFile'
  // PRD 002 §D14: the workspace flows.
  | 'newWorkspace'
  | 'openWorkspace'
  | 'addFolderToWorkspace'
  | 'saveWorkspaceAs'
  | 'closeWorkspace'
  | 'settings'
  // PRD 009 Req 17: end the hosted session — routed like every other menu
  // row, and inert on a platform without the sign-out capability.
  | 'signOut'
  | 'help'
  | 'about'
  | 'checkUpdates'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  // PRD 011 Req 23: semantic zoom is a DISTINCT feature from SPEC4 §4 text
  // zoom — its own ids, so nothing about `zoomIn`/`zoomOut`/`zoomReset` or
  // the `settings.zoom` multiplier changes. Inert while the Experimental
  // flag is off (PRD 011 Req 2).
  | 'semanticZoomIn'
  | 'semanticZoomOut'
  | 'semanticZoomReset'
  | 'close'
  // SPEC43 §5.2: Smart Edit — silent no-ops outside edit mode.
  | 'smartMenu'
  | 'fmtBold'
  | 'fmtItalic'
  | 'fmtStrike'
  | 'fmtCode'
  | 'fmtLink'
  | 'fmtHeading1'
  | 'fmtHeading2'
  | 'fmtHeading3'
  | 'fmtHeading4'
  | 'fmtHeading5'
  | 'fmtHeading6'
  | 'fmtBullet'
  | 'fmtNumbered'
  | 'fmtTask'
  | 'fmtQuote'
  | 'fmtCodeBlock'
  | 'fmtHr';

export type CommandHandlers = Record<CommandId, () => void>;
export type CommandSource = 'menu' | 'hotkey' | 'ui';

let handlers: Partial<CommandHandlers> = {};
let last: { id: CommandId; source: CommandSource; at: number } | null = null;

/**
 * Exactly-once window (SPEC12 §1.3): when a combo is both a native menu
 * accelerator and an in-app hotkey, whichever path the OS delivers first wins
 * and the other arrival is swallowed. Same-source repeats (key auto-repeat,
 * repeated clicks) always pass.
 */
const CROSS_SOURCE_DEDUP_MS = 150;

export function registerCommands(h: CommandHandlers): void {
  handlers = h;
}

/**
 * SPEC29 §3.3: Open Recent items carry a path, not a CommandId — they ride
 * their own tiny channel beside the registry. PRD 002 §D15: the kind says
 * whether the path names a document or a .marky-workspace file.
 */
export type RecentKind = 'file' | 'workspace';

let recentHandler: ((path: string, kind: RecentKind) => void) | null = null;

export function registerRecentHandler(h: (path: string, kind: RecentKind) => void): void {
  recentHandler = h;
}

export function dispatchRecent(path: string, kind: RecentKind = 'file'): void {
  recentHandler?.(path, kind);
}

export function dispatchCommand(id: CommandId, source: CommandSource = 'ui'): void {
  const now = performance.now();
  if (last && last.id === id && last.source !== source && now - last.at < CROSS_SOURCE_DEDUP_MS) {
    last = { id, source, at: now };
    return;
  }
  last = { id, source, at: now };
  handlers[id]?.();
}
