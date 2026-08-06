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
}

/**
 * PRD 009 Req 8/9: the item set. Groups that gate down to zero rows are
 * dropped entirely, so the renderer can put one separator between the groups
 * it is handed and never lead or trail with one.
 */
export function buildAppMenu(s: AppMenuState): AppMenuGroup[] {
  const inWorkspace = s.mode === 'workspace';
  const entry = new Set(s.entryActions);

  const file: AppMenuRow[] = [
    // PRD 009 Req 9 (+Req 16): creating files is a workspace-mode capability
    // here; `canNewFile` is savePicker's existing rule, not a second one.
    ...(inWorkspace && s.canNewFile
      ? [{ command: 'newFile' as const, label: 'New File', testId: 'menu-new', hotkey: 'newFile' as const }]
      : []),
    { command: 'open', label: 'Open File…', testId: 'menu-open', hotkey: 'openFile' },
    // PRD 009 Req 9: nothing to close with no document open.
    ...(s.docOpen ? [{ command: 'closeFile' as const, label: 'Close File', testId: 'menu-close-file' }] : []),
  ];

  const workspace: AppMenuRow[] = [
    ...(entry.has('newWorkspace')
      ? [{ command: 'newWorkspace' as const, label: 'New Workspace', testId: 'menu-new-workspace' }]
      : []),
    ...(entry.has('openWorkspace')
      ? [{ command: 'openWorkspace' as const, label: 'Open Workspace…', testId: 'menu-open-workspace' }]
      : []),
    ...(inWorkspace && (entry.has('newWorkspace') || entry.has('openWorkspace'))
      ? [{ command: 'closeWorkspace' as const, label: 'Close Workspace', testId: 'menu-close-workspace' }]
      : []),
  ];

  // PRD 007 Req 17: a read-only document has no Save rows at all. PRD 009
  // Req 9: with no document they are merely inapplicable — greyed, not gone.
  const save: AppMenuRow[] = s.canEdit
    ? [
        { command: 'save', label: 'Save', testId: 'menu-save', hotkey: 'save', disabled: !s.docOpen },
        { command: 'saveAs', label: 'Save As…', testId: 'menu-save-as', disabled: !s.docOpen },
      ]
    : [];

  // PRD 009 Req 8: the submenu slot. #94 fills it; it dispatches nothing.
  const view: AppMenuRow[] = [{ label: 'View', testId: 'menu-view', submenu: true }];

  // PRD 009 Req 8: Sign out (#95) takes the first slot of this group when it
  // lands — hosted only, ahead of Settings…
  const app: AppMenuRow[] = [
    { command: 'settings', label: 'Settings…', testId: 'menu-settings' },
    { command: 'help', label: 'Help', testId: 'menu-help' },
    { command: 'about', label: 'About Marky Mark', testId: 'menu-about' },
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
