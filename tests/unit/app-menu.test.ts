import { describe, expect, test } from 'vitest';
import { buildAppMenu, type AppMenuGroupId, type AppMenuRow, type AppMenuState } from '../../src/lib/appMenu';
import type { CommandId } from '../../src/lib/commands';
import { DEFAULT_HOTKEYS } from '../../src/lib/hotkeys';
import { buildMenuSpec, type CommandItemSpec, type ViewMenuState } from '../../src/lib/menuSpec';
import type { StartActionId } from '../../src/lib/startActions';

/**
 * PRD 009 Req 8/9: the in-app menu's item set, pinned as data. The Toolbar
 * renders whatever this returns, so group order, separator placement and every
 * gating rule are decided — and tested — here rather than in e2e alone.
 */

/** The capability lists lib/startActions.ts derives per flavor (PRD 007 Req 22). */
const CAPS: Record<'desktopish' | 'hosted' | 'web', StartActionId[]> = {
  desktopish: ['openFile', 'openFolder', 'newWorkspace', 'openWorkspace'],
  hosted: ['openFile', 'newWorkspace', 'openWorkspace'],
  web: ['openFile'],
};

/**
 * PRD 009 Req 12: the View state — the same shape lib/menuSpec.ts builds the
 * native View menu from, because the in-app rows ARE its items.
 */
const viewState = (over: Partial<ViewMenuState> = {}): ViewMenuState => ({
  isMac: false,
  mode: 'preview',
  appMode: 'workspace',
  docOpen: true,
  canEdit: true,
  splitEdit: false,
  showComments: true,
  commentsEnabled: true,
  commentCount: 2,
  hotkeys: { ...DEFAULT_HOTKEYS },
  showDiff: false,
  showWordCount: true,
  showFrontmatter: false,
  lineNumbers: true,
  showFolders: true,
  openOnly: false,
  openFileCount: 3,
  // PRD 013 Req 13: the tab-strip seam exists in the frozen baseline, so the
  // File Tabs row is part of every flyout expectation below.
  fileTabs: true,
  // Issue #167: the sync-scroll row is part of the baseline flyout too.
  syncScroll: true,
  ...over,
});

/** A workspace-mode, everything-permitted state; each test varies one thing. */
const state = (over: Partial<AppMenuState> = {}): AppMenuState => ({
  mode: 'workspace',
  docOpen: true,
  canEdit: true,
  canNewFile: true,
  entryActions: CAPS.hosted,
  view: viewState(),
  // PRD 009 Req 17: the sign-out capability is its own axis — off by default
  // here so every item-set test below stays the flavor-free baseline it was.
  canSignOut: false,
  ...over,
});

const groupIds = (s: AppMenuState): AppMenuGroupId[] => buildAppMenu(s).map((g) => g.id);
const testIds = (s: AppMenuState): string[] => buildAppMenu(s).flatMap((g) => g.rows.map((r) => r.testId));
const row = (s: AppMenuState, testId: string) =>
  buildAppMenu(s)
    .flatMap((g) => g.rows)
    .find((r) => r.testId === testId);

describe('PRD 009 Req 8: the groups and their order', () => {
  test('U336: file → workspace → save → View → app, each group in the PRD order', () => {
    expect(groupIds(state())).toEqual(['file', 'workspace', 'save', 'view', 'app']);
    expect(testIds(state())).toEqual([
      'menu-new',
      'menu-open',
      'menu-close-file',
      'menu-new-workspace',
      'menu-open-workspace',
      'menu-close-workspace',
      'menu-save',
      'menu-save-as',
      'menu-view',
      'menu-settings',
      'menu-help',
      'menu-about',
    ]);
  });

  test('U337: the labels are the PRD’s, and existing rows keep their existing ids', () => {
    const labels = Object.fromEntries(
      buildAppMenu(state())
        .flatMap((g) => g.rows)
        .map((r) => [r.testId, r.label])
    );
    expect(labels).toEqual({
      'menu-new': 'New File',
      'menu-open': 'Open File…',
      'menu-close-file': 'Close File',
      'menu-new-workspace': 'New Workspace',
      'menu-open-workspace': 'Open Workspace…',
      'menu-close-workspace': 'Close Workspace',
      'menu-save': 'Save',
      'menu-save-as': 'Save As…',
      'menu-view': 'View',
      'menu-settings': 'Settings…',
      'menu-help': 'Help',
      'menu-about': 'About Marky Mark',
    });
  });

  test('U338: a group that gates to zero rows is dropped, so it contributes no separator', () => {
    // The static web build has no workspace capability and a read-only doc
    // has no save rows: both groups vanish rather than render empty.
    const stripped = state({ entryActions: CAPS.web, canEdit: false });
    expect(groupIds(stripped)).toEqual(['file', 'view', 'app']);
    expect(buildAppMenu(stripped).every((g) => g.rows.length > 0)).toBe(true);
    // Even the barest state keeps a non-empty first and last group — the
    // rendered menu can therefore never start or end with a separator.
    const barest = state({ mode: 'splash', docOpen: false, entryActions: CAPS.web, canEdit: false });
    expect(groupIds(barest)).toEqual(['file', 'view', 'app']);
    expect(testIds(barest)).toEqual(['menu-open', 'menu-view', 'menu-settings', 'menu-help', 'menu-about']);
  });

  test('U339: View is a submenu parent, not an action — it carries no command', () => {
    const view = row(state(), 'menu-view');
    // #94: the submenu is its rows now, in separator-divided groups.
    expect(view?.submenu?.length).toBeGreaterThan(0);
    expect(view?.command).toBeUndefined();
    // Every other row is a real command row.
    for (const r of buildAppMenu(state()).flatMap((g) => g.rows)) {
      if (r.testId !== 'menu-view') expect(r.command, r.testId).toBeTruthy();
    }
  });

  test('U340: no row carries a command outside the registry (lib/commands.ts)', () => {
    // Typed as CommandId[], so a typo fails to compile; checked at runtime so
    // a stray row cannot dispatch something the menu never meant to offer.
    const allowed: CommandId[] = [
      'newFile',
      'open',
      'closeFile',
      'newWorkspace',
      'openWorkspace',
      'closeWorkspace',
      'save',
      'saveAs',
      'settings',
      'help',
      'about',
    ];
    const states = [
      state(),
      state({ mode: 'file', entryActions: CAPS.desktopish }),
      state({ mode: 'splash', docOpen: false, canEdit: false, entryActions: CAPS.web }),
    ];
    for (const s of states) {
      for (const r of buildAppMenu(s).flatMap((g) => g.rows)) {
        if (r.command) expect(allowed, r.testId).toContain(r.command);
      }
    }
  });

  test('U341: the hint rows name live HotkeyMap entries; no row invents a binding', () => {
    const hints = buildAppMenu(state())
      .flatMap((g) => g.rows)
      .filter((r) => r.hotkey)
      .map((r) => [r.testId, r.hotkey]);
    expect(hints).toEqual([
      ['menu-new', 'newFile'],
      ['menu-open', 'openFile'],
      // Issue #158: Close File hints its new rebindable chord.
      ['menu-close-file', 'closeFile'],
      ['menu-save', 'save'],
    ]);
  });
});

describe('PRD 009 Req 9: mode and capability gating', () => {
  test('U342: New File is workspace-mode only, and only where savePicker offers it', () => {
    expect(testIds(state())).toContain('menu-new');
    expect(testIds(state({ canNewFile: false }))).not.toContain('menu-new');
    for (const mode of ['splash', 'file'] as const) {
      expect(testIds(state({ mode, docOpen: mode === 'file' })), mode).not.toContain('menu-new');
    }
  });

  test('U343: Close File follows the open document; Close Workspace follows the mode', () => {
    expect(testIds(state({ docOpen: false }))).not.toContain('menu-close-file');
    expect(testIds(state({ mode: 'file' }))).toContain('menu-close-file');
    expect(testIds(state({ mode: 'workspace', docOpen: false }))).toContain('menu-close-workspace');
    for (const mode of ['splash', 'file'] as const) {
      expect(testIds(state({ mode, docOpen: mode === 'file' })), mode).not.toContain('menu-close-workspace');
    }
  });

  test('U344: the workspace group is a capability test — absent on the static web build', () => {
    const wsRows = ['menu-new-workspace', 'menu-open-workspace', 'menu-close-workspace'];
    for (const caps of [CAPS.desktopish, CAPS.hosted]) {
      expect(groupIds(state({ entryActions: caps }))).toContain('workspace');
      for (const id of wsRows) expect(testIds(state({ entryActions: caps })), id).toContain(id);
    }
    const web = state({ entryActions: CAPS.web });
    expect(groupIds(web)).not.toContain('workspace');
    for (const id of wsRows) expect(testIds(web), id).not.toContain(id);
  });

  test('U345: Save / Save As… are hidden for a non-editable file, disabled with no document', () => {
    // PRD 007 Req 17 preserved: no permission ⇒ the rows are gone, not greyed.
    expect(groupIds(state({ canEdit: false }))).not.toContain('save');
    // Momentarily inapplicable ⇒ present and disabled (PRD 009 Req 9).
    const empty = state({ mode: 'workspace', docOpen: false });
    expect(row(empty, 'menu-save')?.disabled).toBe(true);
    expect(row(empty, 'menu-save-as')?.disabled).toBe(true);
    expect(row(state(), 'menu-save')?.disabled).toBe(false);
    expect(row(state(), 'menu-save-as')?.disabled).toBe(false);
  });

  test('U346: the initial page shows the survivors only — no New File, Close File or Close Workspace', () => {
    const splash = state({ mode: 'splash', docOpen: false });
    expect(testIds(splash)).toEqual([
      'menu-open',
      'menu-new-workspace',
      'menu-open-workspace',
      'menu-save',
      'menu-save-as',
      'menu-view',
      'menu-settings',
      'menu-help',
      'menu-about',
    ]);
  });
});

/**
 * PRD 009 Req 12: the View ▸ flyout. Its rows are the native View menu's own
 * items (lib/menuSpec.ts `buildViewItems`), so these tests mostly assert that
 * the two surfaces agree rather than re-pinning the item list here.
 */
describe('PRD 009 Req 12: the View submenu rides the shared menuSpec items', () => {
  const viewRows = (s: AppMenuState = state()): AppMenuRow[] =>
    (row(s, 'menu-view')?.submenu ?? []).flatMap((g) => g);
  /** The desktop View submenu's command items for the same state. */
  const specItems = (over: Partial<ViewMenuState> = {}): CommandItemSpec[] =>
    buildMenuSpec({ ...viewState(over), recentFiles: [] })
      .submenus.find((m) => m.title === 'View')!
      .items.filter((i): i is CommandItemSpec => i.type === 'command');

  test('U348: the in-app rows are the desktop View items — same commands, same labels', () => {
    for (const over of [{}, { mode: 'edit' as const }, { isMac: true }, { commentCount: 0 }]) {
      const rows = viewRows(state({ view: viewState(over) }));
      const items = specItems(over);
      expect(rows.map((r) => r.command), JSON.stringify(over)).toEqual(items.map((i) => i.command));
      expect(rows.map((r) => r.label), JSON.stringify(over)).toEqual(items.map((i) => i.label));
    }
    // The full set the PRD names, in the desktop order.
    expect(viewRows().map((r) => r.command)).toEqual([
      'toggleFolders',
      'toggleOpenOnly',
      'nextFile',
      'prevFile',
      // PRD 013 Req 13: the strip's toggle rides with the layout rows.
      'toggleFileTabs',
      'toggleMode',
      'toggleSplit',
      // Issue #167: sync scrolling rides directly under the split it modifies.
      'toggleSyncScroll',
      'toggleComments',
      'nextComment',
      'prevComment',
      'headingPalette',
      'toggleWordCount',
      'toggleFrontmatter',
      'toggleLineNumbers',
      'zoomIn',
      'zoomOut',
      'zoomReset',
    ]);
  });

  test('U349: predefined items are dropped; the one surviving separator sits before the zoom group', () => {
    // macOS: the spec ends with a separator + Fullscreen — neither has an
    // in-app meaning, and the group they would have made is gone with them.
    for (const isMac of [false, true]) {
      const groups = row(state({ view: viewState({ isMac }) }), 'menu-view')!.submenu!;
      expect(groups.length, `isMac=${isMac}`).toBe(2);
      expect(groups.every((g) => g.length > 0), `isMac=${isMac}`).toBe(true);
      expect(groups[1].map((r) => r.command)).toEqual(['zoomIn', 'zoomOut', 'zoomReset']);
      expect(groups.flatMap((g) => g).map((r) => r.label)).not.toContain('Fullscreen');
    }
  });

  test('U350: comment rows follow commentsEnabled; Changes Since Save follows edit mode', () => {
    const commands = (over: Partial<ViewMenuState>) => viewRows(state({ view: viewState(over) })).map((r) => r.command);
    expect(commands({ commentsEnabled: false })).not.toContain('toggleComments');
    expect(commands({ commentsEnabled: false })).not.toContain('nextComment');
    expect(commands({ commentsEnabled: false })).not.toContain('prevComment');
    // The label carries the count exactly as desktop does.
    expect(viewRows().find((r) => r.command === 'toggleComments')?.label).toBe('Comments (2)');
    expect(commands({})).not.toContain('toggleDiff');
    expect(commands({ mode: 'edit' })).toContain('toggleDiff');
  });

  test('U351: no workspace capability ⇒ the sidebar and open-set rows are absent, not greyed', () => {
    const gated: CommandId[] = ['toggleFolders', 'toggleOpenOnly', 'nextFile', 'prevFile'];
    const web = viewRows(state({ entryActions: CAPS.web, view: viewState({ appMode: 'file' }) })).map((r) => r.command);
    for (const c of gated) expect(web, c).not.toContain(c);
    // Where the capability exists they are present — merely disabled when the
    // state cannot honour them (PRD 009 Req 9).
    const outsideWs = viewRows(state({ view: viewState({ appMode: 'file' }) }));
    for (const c of gated) expect(outsideWs.find((r) => r.command === c)?.disabled, c).toBe(true);
    const inWs = viewRows();
    for (const c of gated) expect(inWs.find((r) => r.command === c)?.disabled, c).toBeFalsy();
  });

  test('U682: PRD 013 Req 13 — no tab-strip seam ⇒ no File Tabs row, even where workspaces exist', () => {
    // The hosted flavor HAS the workspace capability (CAPS.hosted), so the
    // WORKSPACE_VIEW_COMMANDS omission set cannot gate the strip's row — the
    // absent-state idiom does: fileTabs undefined ⇒ the row is simply gone.
    const without = viewRows(state({ view: viewState({ fileTabs: undefined }) })).map((r) => r.command);
    expect(without).not.toContain('toggleFileTabs');
    // With the seam it is there, checked per the setting, greyed per docOpen.
    const rows = viewRows();
    expect(rows.find((r) => r.command === 'toggleFileTabs')?.checked).toBe(true);
    expect(rows.find((r) => r.command === 'toggleFileTabs')?.disabled).toBeFalsy();
    const noDoc = viewRows(state({ view: viewState({ docOpen: false }) }));
    expect(noDoc.find((r) => r.command === 'toggleFileTabs')?.disabled).toBe(true);
  });

  test('U352: checked and disabled survive the mapping, item for item', () => {
    for (const over of [{}, { mode: 'edit' as const }, { appMode: 'file' as const }, { docOpen: false }]) {
      const rows = viewRows(state({ view: viewState(over) }));
      for (const item of specItems(over)) {
        const r = rows.find((x) => x.command === item.command)!;
        expect(r.checked, `${item.command} checked`).toBe(item.checked);
        expect(!!r.disabled, `${item.command} disabled`).toBe(!!item.disabled);
        expect(r.accel, `${item.command} accel`).toBe(item.accelerator);
      }
    }
    // Edit Mode greys with no document or no write permission (Req 9).
    const greyed = (over: Partial<ViewMenuState>) =>
      viewRows(state({ view: viewState(over) })).find((r) => r.command === 'toggleMode')?.disabled;
    expect(greyed({ docOpen: false })).toBe(true);
    expect(greyed({ canEdit: false })).toBe(true);
    expect(greyed({})).toBeFalsy();
  });

  test('U353: every child dispatches a registered CommandId under a derived, unique test id', () => {
    const allowed: CommandId[] = [
      'toggleFolders',
      'toggleOpenOnly',
      'nextFile',
      'prevFile',
      'toggleFileTabs', // PRD 013 Req 13
      'toggleMode',
      'toggleSplit',
      'toggleSyncScroll', // issue #167
      'toggleComments',
      'nextComment',
      'prevComment',
      'toggleDiff',
      'headingPalette',
      'toggleWordCount',
      'toggleFrontmatter',
      'toggleLineNumbers',
      'zoomIn',
      'zoomOut',
      'zoomReset',
    ];
    const rows = [
      ...viewRows(),
      ...viewRows(state({ view: viewState({ mode: 'edit' }) })),
      ...viewRows(state({ view: viewState({ isMac: true }) })),
    ];
    for (const r of rows) {
      expect(r.command, r.testId).toBeTruthy();
      expect(allowed, r.testId).toContain(r.command);
      // Derived once from the command, never spelled out per row.
      expect(r.testId).toBe(`menu-view-${r.command}`);
    }
    const ids = viewRows().map((r) => r.testId);
    expect(new Set(ids).size).toBe(ids.length);
    // The parent keeps its existing id (#93).
    expect(row(state(), 'menu-view')?.testId).toBe('menu-view');
  });
});

describe('PRD 009 Req 17: Sign out — a capability row, never a flavor check', () => {
  const APP_GROUP = ['menu-sign-out', 'menu-settings', 'menu-help', 'menu-about'];
  /** The app group's ids — the one thing every test here reads. */
  const appRows = (s: AppMenuState): string[] =>
    buildAppMenu(s)
      .find((g) => g.id === 'app')!
      .rows.map((r) => r.testId);

  test('U354: Sign out leads the app group, ahead of Settings…, Help and About', () => {
    const signedIn = state({ canSignOut: true });
    expect(appRows(signedIn)).toEqual(APP_GROUP);
    expect(row(signedIn, 'menu-sign-out')?.label).toBe('Sign out');
    // The group order itself is untouched: app is still the last group.
    expect(groupIds(signedIn).at(-1)).toBe('app');
  });

  test('U355: without the capability the row is absent — not a disabled row', () => {
    const noSession = state({ canSignOut: false });
    expect(testIds(noSession)).not.toContain('menu-sign-out');
    // …and the rest of the app group is exactly what it was before.
    expect(appRows(noSession)).toEqual(['menu-settings', 'menu-help', 'menu-about']);
  });

  test('U356: signing out is not mode-dependent — the row is there in every AppMode', () => {
    const modes = [
      state({ canSignOut: true, mode: 'splash', docOpen: false, entryActions: CAPS.hosted }),
      state({ canSignOut: true, mode: 'file', docOpen: true, entryActions: CAPS.web }),
      state({ canSignOut: true, mode: 'workspace', docOpen: true }),
    ];
    for (const s of modes) expect(appRows(s), s.mode).toEqual(APP_GROUP);
  });

  test('U357: the row dispatches a command, carries no hotkey hint and is never disabled', () => {
    const r = row(state({ canSignOut: true }), 'menu-sign-out')!;
    // Typed as CommandId, so a row dispatching something the registry
    // (lib/commands.ts) does not know fails to compile — U340's check, for
    // the one row that test's states cannot see.
    const signOut: CommandId = 'signOut';
    expect(r.command).toBe(signOut);
    expect(r.hotkey).toBeUndefined(); // PRD 009 Non-goals: no new binding.
    expect(r.disabled).toBeUndefined();
    expect(r.submenu).toBeUndefined();

  });
});
