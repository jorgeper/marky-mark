import { describe, expect, test } from 'vitest';
import { buildAppMenu, type AppMenuGroupId, type AppMenuState } from '../../src/lib/appMenu';
import type { CommandId } from '../../src/lib/commands';
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

/** A workspace-mode, everything-permitted state; each test varies one thing. */
const state = (over: Partial<AppMenuState> = {}): AppMenuState => ({
  mode: 'workspace',
  docOpen: true,
  canEdit: true,
  canNewFile: true,
  entryActions: CAPS.hosted,
  // PRD 009 Req 17: the sign-out capability is its own axis — off by default
  // here so every item-set test below stays the flavour-free baseline it was.
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
    expect(view?.submenu).toBe(true);
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

describe('PRD 009 Req 17: Sign out — a capability row, never a flavour check', () => {
  const APP_GROUP = ['menu-sign-out', 'menu-settings', 'menu-help', 'menu-about'];

  test('U348: Sign out leads the app group, ahead of Settings…, Help and About', () => {
    const menu = buildAppMenu(state({ canSignOut: true }));
    const app = menu.find((g) => g.id === 'app')!;
    expect(app.rows.map((r) => r.testId)).toEqual(APP_GROUP);
    expect(app.rows[0].label).toBe('Sign out');
    // The group order itself is untouched: it is still the last group.
    expect(menu[menu.length - 1].id).toBe('app');
  });

  test('U349: without the capability the row is absent — not a disabled row', () => {
    expect(testIds(state({ canSignOut: false }))).not.toContain('menu-sign-out');
    // …and the rest of the app group is exactly what it was before.
    expect(buildAppMenu(state({ canSignOut: false })).find((g) => g.id === 'app')!.rows.map((r) => r.testId)).toEqual([
      'menu-settings',
      'menu-help',
      'menu-about',
    ]);
  });

  test('U350: signing out is not mode-dependent — the row is there in every AppMode', () => {
    const modes = [
      state({ canSignOut: true, mode: 'splash', docOpen: false, entryActions: CAPS.hosted }),
      state({ canSignOut: true, mode: 'file', docOpen: true, entryActions: CAPS.web }),
      state({ canSignOut: true, mode: 'workspace', docOpen: true }),
    ];
    for (const s of modes) {
      expect(buildAppMenu(s).find((g) => g.id === 'app')!.rows.map((r) => r.testId)).toEqual(APP_GROUP);
    }
  });

  test('U351: the row dispatches a command, carries no hotkey hint and is never disabled', () => {
    const r = row(state({ canSignOut: true }), 'menu-sign-out')!;
    const ids: CommandId[] = ['signOut'];
    expect(ids).toContain(r.command);
    expect(r.hotkey).toBeUndefined(); // PRD 009 Non-goals: no new binding.
    expect(r.disabled).toBeUndefined();
    expect(r.submenu).toBeUndefined();
  });
});
