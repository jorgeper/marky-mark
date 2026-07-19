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
  | 'clearRecent'
  | 'find'
  | 'toggleFolders'
  | 'openFolder'
  | 'settings'
  | 'help'
  | 'about'
  | 'checkUpdates'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
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
 * their own tiny channel beside the registry.
 */
let recentHandler: ((path: string) => void) | null = null;

export function registerRecentHandler(h: (path: string) => void): void {
  recentHandler = h;
}

export function dispatchRecent(path: string): void {
  recentHandler?.(path);
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
