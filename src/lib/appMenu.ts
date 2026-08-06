/**
 * PRD 009 Req 8/9: the in-app hamburger menu, as data. One ordered list of
 * separator-divided groups derived from mode + capabilities, so
 * components/Toolbar.tsx renders what it is given and decides nothing about
 * order, membership or gating — the same split lib/menuSpec.ts makes for the
 * native menu bar, and the same capability list lib/startActions.ts hands the
 * start page (Req 10: the two surfaces cannot drift).
 *
 * Pure: no React, no platform import, every branch unit-testable.
 */

import type { AppMode } from './appMode';
import type { CommandId } from './commands';
import type { HotkeyMap } from './hotkeys';
import type { StartActionId } from './startActions';

/** The groups, in render order (PRD 009 Req 8). */
export type AppMenuGroupId = 'file' | 'workspace' | 'save' | 'view' | 'app';

export interface AppMenuRow {
  /**
   * Absent on a submenu parent only (View ▸, PRD 009 Req 8): a row with no
   * command dispatches nothing when activated.
   */
  command?: CommandId;
  label: string;
  /** `data-testid` — stable across releases; existing ids are never renamed. */
  testId: string;
  /** The live HotkeyMap entry whose combo shows as the row's hint, if any. */
  hotkey?: keyof HotkeyMap;
  /**
   * PRD 009 Req 9: momentarily inapplicable, not gone — the row renders as a
   * real disabled button rather than disappearing.
   */
  disabled?: boolean;
  /** PRD 009 Req 8: View ▸ opens a submenu (#94 fills it), it is not an action. */
  submenu?: boolean;
}

export interface AppMenuGroup {
  id: AppMenuGroupId;
  rows: AppMenuRow[];
}

/** Everything the item set is derived from — all of it state the app tracks. */
export interface AppMenuState {
  /** lib/appMode.ts's derived mode: splash | file | workspace. */
  mode: AppMode;
  /** At least one document open (file or untitled buffer). */
  docOpen: boolean;
  /** PRD 007 Req 17: false ⇒ this user may not write the open document. */
  canEdit: boolean;
  /** PRD 009 Req 13/16: `canOfferNewFile` (lib/savePicker.ts) — the ONE rule. */
  canNewFile: boolean;
  /**
   * PRD 007 Req 21/22: the capability-derived entry actions
   * (lib/startActions.ts). The workspace rows ride the very same list the
   * start page renders, so a flavor without the capability — the static
   * single-file web build — shows no workspace group at all.
   */
  entryActions: readonly StartActionId[];
  /**
   * PRD 009 Req 17: this session can be signed out of — the platform's
   * `signOut` capability (platform/types.ts), present on the hosted flavor
   * alone. Never derived from `platform.kind`, exactly like the workspace
   * rows above. Signing out is not mode-dependent, so nothing else gates it.
   */
  canSignOut: boolean;
}

/** One command row — the counterpart of lib/menuSpec.ts's `cmd` for this menu. */
const row = (
  command: CommandId,
  label: string,
  testId: string,
  hotkey?: keyof HotkeyMap,
  disabled?: boolean
): AppMenuRow => ({
  command,
  label,
  testId,
  ...(hotkey ? { hotkey } : {}),
  ...(disabled !== undefined ? { disabled } : {}),
});

/**
 * PRD 009 Req 8/9: the item set. Groups that gate down to zero rows are
 * dropped entirely, so the renderer can put one separator between the groups
 * it is handed and never lead or trail with one.
 */
export function buildAppMenu(s: AppMenuState): AppMenuGroup[] {
  const inWorkspace = s.mode === 'workspace';
  const entry = new Set(s.entryActions);
  // PRD 009 Req 9: the workspace rows are a capability test, never a check of
  // which flavor is running — a flavor that can do neither shows no group.
  const hasWorkspaces = entry.has('newWorkspace') || entry.has('openWorkspace');

  const file: AppMenuRow[] = [
    // PRD 009 Req 9 (+Req 16): creating files is a workspace-mode capability
    // here; `canNewFile` is savePicker's existing rule, not a second one.
    ...(inWorkspace && s.canNewFile ? [row('newFile', 'New File', 'menu-new', 'newFile')] : []),
    row('open', 'Open File…', 'menu-open', 'openFile'),
    // PRD 009 Req 9: nothing to close with no document open.
    ...(s.docOpen ? [row('closeFile', 'Close File', 'menu-close-file')] : []),
  ];

  const workspace: AppMenuRow[] = [
    ...(entry.has('newWorkspace') ? [row('newWorkspace', 'New Workspace', 'menu-new-workspace')] : []),
    ...(entry.has('openWorkspace') ? [row('openWorkspace', 'Open Workspace…', 'menu-open-workspace')] : []),
    ...(inWorkspace && hasWorkspaces ? [row('closeWorkspace', 'Close Workspace', 'menu-close-workspace')] : []),
  ];

  // PRD 007 Req 17: a read-only document has no Save rows at all. PRD 009
  // Req 9: with no document they are merely inapplicable — greyed, not gone.
  const save: AppMenuRow[] = s.canEdit
    ? [
        row('save', 'Save', 'menu-save', 'save', !s.docOpen),
        row('saveAs', 'Save As…', 'menu-save-as', undefined, !s.docOpen),
      ]
    : [];

  // PRD 009 Req 8: the submenu slot. #94 fills it; it dispatches nothing.
  const view: AppMenuRow[] = [{ label: 'View', testId: 'menu-view', submenu: true }];

  // PRD 009 Req 8/17: Sign out takes the first slot of this group, ahead of
  // Settings… — and only where the platform can end a session, so a flavor
  // without hosted auth has no such row at all rather than a disabled one.
  const app: AppMenuRow[] = [
    ...(s.canSignOut ? [row('signOut', 'Sign out', 'menu-sign-out')] : []),
    row('settings', 'Settings…', 'menu-settings'),
    row('help', 'Help', 'menu-help'),
    row('about', 'About Marky Mark', 'menu-about'),
  ];

  const groups: AppMenuGroup[] = [
    { id: 'file', rows: file },
    { id: 'workspace', rows: workspace },
    { id: 'save', rows: save },
    { id: 'view', rows: view },
    { id: 'app', rows: app },
  ];
  return groups.filter((g) => g.rows.length > 0);
}
