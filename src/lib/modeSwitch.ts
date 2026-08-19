import type { AppMode } from './appMode';
import type { ViewMode } from './settings';

/**
 * PRD 009 Req 4/5: the mode-switch decision, as one pure function. The app
 * has exactly two working modes (single-file and workspace) and, on every
 * non-desktop flavor, they are EXCLUSIVE: an action that wants the other one
 * closes the mode it is leaving first. This module answers only "what has to
 * happen before this action runs" — App.tsx owns the closing itself, dirty
 * prompts and all.
 */

/** The flavors, exactly as `Platform['kind']` names them (platform/types.ts). */
export type Flavor = 'tauri' | 'browser' | 'web' | 'hosted';

/** The mode a crossing action wants to land in. */
export type ModeTarget = 'file' | 'workspace';

/** What must run before the action's own work. */
export type ModeSwitch = 'enter' | 'close-files-first' | 'close-workspace-first';

/**
 * PRD 009 Req 1 (Non-goals): which flavors run the exclusive model. Desktop
 * keeps a workspace and local files open at once — the PRD's stated
 * non-goal — so this one predicate really is a flavor question. Every other
 * gate in this area asks the derived `AppMode` instead (appMode.ts).
 */
export function modesAreExclusive(kind: Flavor): boolean {
  return kind !== 'tauri';
}

/**
 * PRD 009 Req 4: the plan for a crossing action. From the initial page every
 * action just enters. Within a mode (another file in single-file mode,
 * another workspace in workspace mode) nothing is crossed either — the open
 * set grows, or the existing workspace-replacement guards run. Only a real
 * crossing closes first, and only where modes are exclusive.
 */
export function planModeSwitch(mode: AppMode, target: ModeTarget, exclusive: boolean): ModeSwitch {
  if (!exclusive || mode === 'splash') return 'enter';
  if (target === 'file') return mode === 'workspace' ? 'close-workspace-first' : 'enter';
  return mode === 'file' ? 'close-files-first' : 'enter';
}

/**
 * Issue #125: the view mode a document opens in. The reader's remembered
 * choice wins — that is the whole point of the setting — except where a guard
 * says otherwise: PRD 007 Req 17, a document this reader may not change opens
 * in the reading preview, whatever they were last doing. Pure so the rule is
 * pinned by a unit test, rather than only reachable through a flavor that has
 * a permission model.
 */
export function viewModeForOpen(remembered: ViewMode, mayEdit: boolean): ViewMode {
  return mayEdit ? remembered : 'preview';
}
