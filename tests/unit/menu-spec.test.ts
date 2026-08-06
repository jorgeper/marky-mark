import { describe, expect, test } from 'vitest';
import { buildMenuSpec, type CommandItemSpec, type MenuState } from '../../src/lib/menuSpec';
import { DEFAULT_HOTKEYS } from '../../src/lib/hotkeys';
import { parseSettings } from '../../src/lib/settings';

const base: MenuState = {
  isMac: true,
  mode: 'preview',
  splitEdit: true, // SPEC25 §3: fixture-level only — no assertion changed
  showComments: true,
  commentsEnabled: true,
  commentCount: 0,
  hotkeys: { ...DEFAULT_HOTKEYS },
  showDiff: false,
  showWordCount: true,
  showFrontmatter: true, // SPEC26 §3: fixture-level only — no assertion changed
  lineNumbers: true, // issue #10: U124 covers the View checkbox
  recentFiles: [], // SPEC29 §3: fixture-level only — no assertion changed
  showFolders: false, // SPEC34 §4: fixture-level only — no assertion changed
  appMode: 'workspace', // issue #22: everything enabled — U120 covers the gating
  docOpen: true,
};

const titles = (s: MenuState) => buildMenuSpec(s).submenus.map((m) => m.title);
const commandsIn = (s: MenuState, title: string) =>
  buildMenuSpec(s)
    .submenus.find((m) => m.title === title)!
    .items.filter((i): i is CommandItemSpec => i.type === 'command');
const find = (s: MenuState, title: string, command: string) =>
  commandsIn(s, title).find((i) => i.command === command);

describe('SPEC12 menu spec', () => {
  test('U19: macOS layout — app menu holds About/Settings/Quit; File has Open/Save/Save As/Close; Window present; Help has no About', () => {
    expect(titles(base)).toEqual(['Marky Mark', 'File', 'Edit', 'View', 'Window', 'Help']);
    const app = commandsIn(base, 'Marky Mark').map((i) => i.command);
    expect(app).toEqual(['about', 'checkUpdates', 'settings', 'close']);
    expect(find(base, 'Marky Mark', 'settings')!.accelerator).toBe('Mod+,');
    expect(find(base, 'Marky Mark', 'close')!.label).toBe('Quit Marky Mark');
    const file = commandsIn(base, 'File').map((i) => i.command);
    // SPEC21 §5.6 amendment: New… now leads the File menu.
    // PRD 002 §D14: the open/workspace group precedes the save group.
    expect(file).toEqual(['newFile', 'open', 'openFolder', 'openWorkspace', 'addFolderToWorkspace', 'saveWorkspaceAs', 'closeFile', 'closeWorkspace', 'save', 'saveAs', 'exportDoc', 'printDoc', 'close']);
    expect(find(base, 'File', 'close')!.label).toBe('Close Window');
    expect(commandsIn(base, 'Help').map((i) => i.command)).toEqual(['help']);
    // Edit: the predefined system items in the standard order, then the one
    // app command (SPEC20 follow-up: Insert Image…).
    const edit = buildMenuSpec(base).submenus.find((m) => m.title === 'Edit')!;
    const editKinds = edit.items.flatMap((i) => (i.type === 'predefined' && i.item !== 'Separator' ? [i.item] : []));
    expect(editKinds).toEqual(['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'SelectAll']);
    // SPEC30 §4.1 amendment: Find… joins the Edit menu ahead of Insert Image….
    expect(commandsIn(base, 'Edit').map((i) => i.command)).toEqual(['find', 'insertImage']);
    // View ends with Full Screen on mac; Window menu is predefined-only.
    const view = buildMenuSpec(base).submenus.find((m) => m.title === 'View')!;
    expect(view.items.some((i) => i.type === 'predefined' && i.item === 'Fullscreen')).toBe(true);
    const win = buildMenuSpec(base).submenus.find((m) => m.title === 'Window')!;
    expect(win.items.every((i) => i.type === 'predefined')).toBe(true);
  });

  test('U20: Windows layout — File carries Settings and Exit; Help carries About; no app/Window menu; no Full Screen', () => {
    const win = { ...base, isMac: false };
    expect(titles(win)).toEqual(['File', 'Edit', 'View', 'Help']);
    const file = commandsIn(win, 'File').map((i) => i.command);
    // SPEC21 §5.6 amendment: New… now leads the File menu.
    // PRD 002 §D14: the open/workspace group precedes the save group.
    expect(file).toEqual(['newFile', 'open', 'openFolder', 'openWorkspace', 'addFolderToWorkspace', 'saveWorkspaceAs', 'closeFile', 'closeWorkspace', 'save', 'saveAs', 'exportDoc', 'printDoc', 'settings', 'close']);
    expect(find(win, 'File', 'close')!.label).toBe('Exit');
    expect(find(win, 'File', 'settings')!.accelerator).toBe('Mod+,');
    expect(commandsIn(win, 'Help').map((i) => i.command)).toEqual(['help', 'about', 'checkUpdates']);
    const view = buildMenuSpec(win).submenus.find((m) => m.title === 'View')!;
    expect(view.items.some((i) => i.type === 'predefined' && i.item === 'Fullscreen')).toBe(false);
  });

  test('U21: dynamics — checkmarks follow state, live count, comments item vanishes with the master switch, rebinding moves one accelerator', () => {
    expect(find(base, 'View', 'toggleMode')!.checked).toBe(false);
    expect(find({ ...base, mode: 'edit' }, 'View', 'toggleMode')!.checked).toBe(true);
    expect(find(base, 'View', 'toggleComments')!.checked).toBe(true);
    expect(find({ ...base, showComments: false }, 'View', 'toggleComments')!.checked).toBe(false);
    expect(find(base, 'View', 'toggleComments')!.label).toBe('Comments');
    expect(find({ ...base, commentCount: 3 }, 'View', 'toggleComments')!.label).toBe('Comments (3)');
    expect(find({ ...base, commentsEnabled: false }, 'View', 'toggleComments')).toBeUndefined();
    const rebound = { ...base, hotkeys: { ...DEFAULT_HOTKEYS, save: 'Mod+K' } };
    expect(find(rebound, 'File', 'save')!.accelerator).toBe('Mod+K');
    expect(find(rebound, 'File', 'open')!.accelerator).toBe(DEFAULT_HOTKEYS.openFile);
    expect(find(rebound, 'View', 'toggleMode')!.accelerator).toBe(DEFAULT_HOTKEYS.toggleEdit);
  });

  test('U25: View carries Next/Previous Comment after Comments with hotkey accelerators; they vanish with the master switch', () => {
    for (const s of [base, { ...base, isMac: false }]) {
      const view = commandsIn(s, 'View').map((i) => i.command);
      const at = view.indexOf('toggleComments');
      expect(at).toBeGreaterThanOrEqual(0);
      expect(view.slice(at, at + 3)).toEqual(['toggleComments', 'nextComment', 'prevComment']);
      expect(find(s, 'View', 'nextComment')!.accelerator).toBe('Mod+Alt+ArrowDown');
      expect(find(s, 'View', 'prevComment')!.accelerator).toBe('Mod+Alt+ArrowUp');
    }
    const rebound = { ...base, hotkeys: { ...DEFAULT_HOTKEYS, nextComment: 'Mod+J' } };
    expect(find(rebound, 'View', 'nextComment')!.accelerator).toBe('Mod+J');
    expect(find(rebound, 'View', 'prevComment')!.accelerator).toBe('Mod+Alt+ArrowUp');
    const off = { ...base, commentsEnabled: false };
    expect(find(off, 'View', 'nextComment')).toBeUndefined();
    expect(find(off, 'View', 'prevComment')).toBeUndefined();
  });

  test('U34: exportDoc always present; toggleDiff only in edit modes tracking showDiff; palette accelerator follows rebinds', () => {
    // SPEC17 §5.1: Export… is unconditional — format gating lives in the dialog.
    for (const s of [base, { ...base, isMac: false }]) {
      expect(find(s, 'File', 'exportDoc')!.label).toBe('Export…');
    }

    // Diff toggle: absent in preview, checkbox tracking showDiff in edit.
    expect(find(base, 'View', 'toggleDiff')).toBeUndefined();
    const edit = { ...base, mode: 'edit' as const };
    expect(find(edit, 'View', 'toggleDiff')!.checked).toBe(false);
    expect(find({ ...edit, showDiff: true }, 'View', 'toggleDiff')!.checked).toBe(true);

    // Heading palette: always in View, rebindable accelerator.
    expect(find(base, 'View', 'headingPalette')!.accelerator).toBe('Mod+K');
    const rebound = { ...base, hotkeys: { ...DEFAULT_HOTKEYS, headingPalette: 'Mod+Shift+O' } };
    expect(find(rebound, 'View', 'headingPalette')!.accelerator).toBe('Mod+Shift+O');
  });

  test('U35: Word Count is a View checkbox tracking the setting, with a rebindable accelerator', () => {
    expect(find(base, 'View', 'toggleWordCount')!.label).toBe('Word Count');
    expect(find(base, 'View', 'toggleWordCount')!.checked).toBe(true);
    expect(find({ ...base, showWordCount: false }, 'View', 'toggleWordCount')!.checked).toBe(false);
    expect(find(base, 'View', 'toggleWordCount')!.accelerator).toBe('Mod+Shift+W');
    const rebound = { ...base, hotkeys: { ...DEFAULT_HOTKEYS, toggleWordCount: 'Mod+Shift+X' } };
    expect(find(rebound, 'View', 'toggleWordCount')!.accelerator).toBe('Mod+Shift+X');
  });

  test('U38: File carries Export… unconditionally on both layouts, right after Save As…', () => {
    for (const s of [base, { ...base, isMac: false }]) {
      const file = commandsIn(s, 'File').map((i) => i.command);
      expect(file.indexOf('exportDoc')).toBe(file.indexOf('saveAs') + 1);
      expect(find(s, 'File', 'exportDoc')!.label).toBe('Export…');
      expect(find(s, 'File', 'exportDoc')!.accelerator).toBeUndefined();
    }
  });

  test('U40: File carries Print… right after Export… with the fixed Mod+P accelerator', () => {
    for (const s of [base, { ...base, isMac: false }]) {
      const file = commandsIn(s, 'File').map((i) => i.command);
      expect(file.indexOf('printDoc')).toBe(file.indexOf('exportDoc') + 1);
      expect(find(s, 'File', 'printDoc')!.label).toBe('Print…');
      expect(find(s, 'File', 'printDoc')!.accelerator).toBe('Mod+P');
    }
  });

  test('U41: Check for Updates… sits directly after About on both layouts, no accelerator', () => {
    const app = commandsIn(base, 'Marky Mark').map((i) => i.command);
    expect(app.indexOf('checkUpdates')).toBe(app.indexOf('about') + 1);
    const help = commandsIn({ ...base, isMac: false }, 'Help').map((i) => i.command);
    expect(help.indexOf('checkUpdates')).toBe(help.indexOf('about') + 1);
    for (const s of [base, { ...base, isMac: false }]) {
      const item = find(s, s.isMac ? 'Marky Mark' : 'Help', 'checkUpdates')!;
      expect(item.label).toBe('Check for Updates…');
      expect(item.accelerator).toBeUndefined();
    }
  });

  test('U47: File starts with New then Open… on both layouts; the accelerator follows rebinds', () => {
    expect(DEFAULT_HOTKEYS.newFile).toBe('Mod+N');
    for (const s of [base, { ...base, isMac: false }]) {
      const file = commandsIn(s, 'File').map((i) => i.command);
      expect(file.indexOf('newFile')).toBe(0);
      expect(file.indexOf('open')).toBe(1);
      // SPEC22: no ellipsis — New doesn't ask for input anymore.
      expect(find(s, 'File', 'newFile')!.label).toBe('New');
      expect(find(s, 'File', 'newFile')!.accelerator).toBe(DEFAULT_HOTKEYS.newFile);
    }
    const rebound = { ...base, hotkeys: { ...DEFAULT_HOTKEYS, newFile: 'Mod+Shift+N' } };
    expect(find(rebound, 'File', 'newFile')!.accelerator).toBe('Mod+Shift+N');
    expect(find(rebound, 'File', 'open')!.accelerator).toBe(DEFAULT_HOTKEYS.openFile);
  });

  test('U53: View carries Split Edit right after Edit Mode — checkbox tracks the setting, accelerator rebinds', () => {
    expect(DEFAULT_HOTKEYS.toggleSplit).toBe('Mod+\\');
    for (const s of [base, { ...base, isMac: false }]) {
      const view = commandsIn(s, 'View').map((i) => i.command);
      expect(view.indexOf('toggleSplit')).toBe(view.indexOf('toggleMode') + 1);
      expect(find(s, 'View', 'toggleSplit')!.label).toBe('Split Edit');
      expect(find(s, 'View', 'toggleSplit')!.checked).toBe(true);
      expect(find(s, 'View', 'toggleSplit')!.accelerator).toBe(DEFAULT_HOTKEYS.toggleSplit);
    }
    expect(find({ ...base, splitEdit: false }, 'View', 'toggleSplit')!.checked).toBe(false);
    const rebound = { ...base, hotkeys: { ...DEFAULT_HOTKEYS, toggleSplit: 'Mod+Shift+L' } };
    expect(find(rebound, 'View', 'toggleSplit')!.accelerator).toBe('Mod+Shift+L');
    // Pre-SPEC25 settings files gain the default binding via the sanitizer.
    expect(parseSettings('{"hotkeys":{"save":"Mod+S"}}').hotkeys.toggleSplit).toBe('Mod+\\');
  });

  test('U55: View carries Front Matter after Word Count — checkbox, no accelerator; setting defaults true', () => {
    for (const s of [base, { ...base, isMac: false }]) {
      const view = commandsIn(s, 'View').map((i) => i.command);
      expect(view.indexOf('toggleFrontmatter')).toBe(view.indexOf('toggleWordCount') + 1);
      expect(find(s, 'View', 'toggleFrontmatter')!.label).toBe('Front Matter');
      expect(find(s, 'View', 'toggleFrontmatter')!.checked).toBe(true);
      expect(find(s, 'View', 'toggleFrontmatter')!.accelerator).toBeUndefined();
    }
    expect(find({ ...base, showFrontmatter: false }, 'View', 'toggleFrontmatter')!.checked).toBe(false);
    // The persisted default: true, explicit false honored, malformed falls back.
    expect(parseSettings('{}').showFrontmatter).toBe(true);
    expect(parseSettings('{"showFrontmatter":false}').showFrontmatter).toBe(false);
    expect(parseSettings('{"showFrontmatter":"nope"}').showFrontmatter).toBe(true);
  });

  test('U124: issue #10 — View carries Line Numbers as a checkbox tracking the setting, with no accelerator', () => {
    for (const s of [base, { ...base, isMac: false }]) {
      // Sits with the other view-chrome toggles, right after Front Matter.
      const view = commandsIn(s, 'View').map((i) => i.command);
      expect(view.indexOf('toggleLineNumbers')).toBe(view.indexOf('toggleFrontmatter') + 1);
      expect(find(s, 'View', 'toggleLineNumbers')!.label).toBe('Line Numbers');
      // A checkbox item mirroring MenuState, not a plain command…
      expect(find(s, 'View', 'toggleLineNumbers')!.checked).toBe(true);
      expect(find({ ...s, lineNumbers: false }, 'View', 'toggleLineNumbers')!.checked).toBe(false);
      // …and deliberately hotkey-less (the issue: "no need for hotkey").
      expect(find(s, 'View', 'toggleLineNumbers')!.accelerator).toBeUndefined();
    }
    // The persisted key is untouched by the move: still a User-scope setting
    // defaulting to true, with malformed values falling back.
    expect(parseSettings('{}').lineNumbers).toBe(true);
    expect(parseSettings('{"lineNumbers":false}').lineNumbers).toBe(false);
    expect(parseSettings('{"lineNumbers":"nope"}').lineNumbers).toBe(true);
  });

  test('U57: Open Recent submenu sits right after Open Workspace… — entries in order, separator, Clear Menu; Clear alone when empty', () => {
    const recents = [
      { path: '/docs/b.md', label: 'b.md' },
      { path: '/docs/a.md', label: 'a.md' },
    ];
    for (const st of [
      { ...base, recentFiles: recents },
      { ...base, isMac: false, recentFiles: recents },
    ]) {
      const file = buildMenuSpec(st).submenus.find((m) => m.title === 'File')!;
      // PRD 002 §D14: the submenu rides directly after Open Workspace….
      const idxOpen = file.items.findIndex((i) => i.type === 'command' && i.command === 'openWorkspace');
      const sub = file.items[idxOpen + 1];
      expect(sub.type).toBe('submenu');
      if (sub.type !== 'submenu') throw new Error('unreachable');
      expect(sub.title).toBe('Open Recent');
      expect(sub.items.map((i) => i.type)).toEqual(['recent', 'recent', 'predefined', 'command']);
      expect(sub.items.flatMap((i) => (i.type === 'recent' ? [i.path] : []))).toEqual(['/docs/b.md', '/docs/a.md']);
      expect(sub.items.flatMap((i) => (i.type === 'recent' ? [i.label] : []))).toEqual(['b.md', 'a.md']);
      const clear = sub.items[sub.items.length - 1];
      expect(clear.type === 'command' && clear.command).toBe('clearRecent');
      expect(clear.type === 'command' && clear.label).toBe('Clear Menu');
      // The File menu's TOP-LEVEL command list is exactly what U19/U20 pin.
      expect(commandsIn(st, 'File').map((i) => i.command)).toEqual(
        st.isMac
          ? ['newFile', 'open', 'openFolder', 'openWorkspace', 'addFolderToWorkspace', 'saveWorkspaceAs', 'closeFile', 'closeWorkspace', 'save', 'saveAs', 'exportDoc', 'printDoc', 'close']
          : ['newFile', 'open', 'openFolder', 'openWorkspace', 'addFolderToWorkspace', 'saveWorkspaceAs', 'closeFile', 'closeWorkspace', 'save', 'saveAs', 'exportDoc', 'printDoc', 'settings', 'close']
      );
    }
    // Empty list: the submenu holds just Clear Menu (macOS-style), no separator.
    const file = buildMenuSpec(base).submenus.find((m) => m.title === 'File')!;
    const sub = file.items.find((i) => i.type === 'submenu');
    expect(sub && sub.type === 'submenu' && sub.items.map((i) => i.type)).toEqual(['command']);
  });

  test('U66: File menu §D14 — full order and separator grouping; workspace items on both layouts', () => {
    for (const s of [base, { ...base, isMac: false }]) {
      const file = buildMenuSpec(s).submenus.find((m) => m.title === 'File')!;
      const shape = file.items.map((i) =>
        i.type === 'command' ? i.command : i.type === 'submenu' ? `submenu:${i.title}` : 'sep'
      );
      const head = [
        'newFile',
        'open',
        'openFolder',
        'openWorkspace',
        'submenu:Open Recent',
        'sep',
        'addFolderToWorkspace',
        'saveWorkspaceAs',
        'closeFile',
        'closeWorkspace',
        'sep',
        'save',
        'saveAs',
        'exportDoc',
        'printDoc',
        'sep',
      ];
      expect(shape).toEqual(s.isMac ? [...head, 'close'] : [...head, 'settings', 'sep', 'close']);
      expect(find(s, 'File', 'openWorkspace')!.label).toBe('Open Workspace…');
      expect(find(s, 'File', 'addFolderToWorkspace')!.label).toBe('Add Folder to Workspace…');
      expect(find(s, 'File', 'saveWorkspaceAs')!.label).toBe('Save Workspace As…');
      expect(find(s, 'File', 'closeWorkspace')!.label).toBe('Close Workspace');
    }
  });

  test('U67: Open Recent §D15 — workspaces first (kind-tagged), separator, files, separator, Clear Menu', () => {
    const ws = [
      { path: '/w/site.marky-workspace', label: 'site.marky-workspace' },
      { path: '/w/docs.marky-workspace', label: 'docs.marky-workspace' },
    ];
    const files = [{ path: '/docs/a.md', label: 'a.md' }];
    const sub = (s: MenuState) => {
      const file = buildMenuSpec(s).submenus.find((m) => m.title === 'File')!;
      const it = file.items.find((i) => i.type === 'submenu');
      if (!it || it.type !== 'submenu') throw new Error('no Open Recent');
      return it.items;
    };
    for (const isMac of [true, false]) {
      // Both sections: ws, ws, sep, file, sep, Clear.
      const both = sub({ ...base, isMac, recentWorkspaces: ws, recentFiles: files });
      expect(both.map((i) => i.type)).toEqual(['recent', 'recent', 'predefined', 'recent', 'predefined', 'command']);
      expect(both.flatMap((i) => (i.type === 'recent' ? [i.kind ?? 'file'] : []))).toEqual(['workspace', 'workspace', 'file']);
      expect(both.flatMap((i) => (i.type === 'recent' ? [i.path] : []))).toEqual([
        '/w/site.marky-workspace',
        '/w/docs.marky-workspace',
        '/docs/a.md',
      ]);
      // Workspaces only: no double separator.
      const wsOnly = sub({ ...base, isMac, recentWorkspaces: ws, recentFiles: [] });
      expect(wsOnly.map((i) => i.type)).toEqual(['recent', 'recent', 'predefined', 'command']);
      // Files only (legacy shape) and fully empty: unchanged from SPEC29.
      const filesOnly = sub({ ...base, isMac, recentWorkspaces: [], recentFiles: files });
      expect(filesOnly.map((i) => i.type)).toEqual(['recent', 'predefined', 'command']);
      const empty = sub({ ...base, isMac, recentWorkspaces: [], recentFiles: [] });
      expect(empty.map((i) => i.type)).toEqual(['command']);
    }
  });

  test('U59: Edit carries Find… with the rebindable Mod+F', () => {
    expect(DEFAULT_HOTKEYS.find).toBe('Mod+F');
    for (const s of [base, { ...base, isMac: false }]) {
      const edit = commandsIn(s, 'Edit');
      expect(edit.map((i) => i.command)).toEqual(['find', 'insertImage']);
      expect(edit[0].label).toBe('Find…');
      expect(edit[0].accelerator).toBe('Mod+F');
    }
    const rebound = { ...base, hotkeys: { ...DEFAULT_HOTKEYS, find: 'Mod+Shift+G' } };
    expect(find(rebound, 'Edit', 'find')!.accelerator).toBe('Mod+Shift+G');
    expect(parseSettings('{"hotkeys":{"save":"Mod+S"}}').hotkeys.find).toBe('Mod+F');
  });

  test('U120: issue #22 mode gating — workspace-only and folder-view items disable outside workspace mode; Close File follows docOpen; the open trio never disables', () => {
    const modes: Array<{ s: MenuState; wsDisabled: boolean; closeFileDisabled: boolean }> = [
      { s: { ...base, appMode: 'splash', docOpen: false }, wsDisabled: true, closeFileDisabled: true },
      { s: { ...base, appMode: 'file', docOpen: true }, wsDisabled: true, closeFileDisabled: false },
      { s: { ...base, appMode: 'workspace', docOpen: true }, wsDisabled: false, closeFileDisabled: false },
    ];
    for (const isMac of [true, false]) {
      for (const { s: m, wsDisabled, closeFileDisabled } of modes) {
        const s = { ...m, isMac };
        // File: the workspace trio gates on workspace mode; Close File on docOpen.
        for (const c of ['addFolderToWorkspace', 'saveWorkspaceAs', 'closeWorkspace'] as const) {
          expect(find(s, 'File', c)!.disabled ?? false).toBe(wsDisabled);
        }
        expect(find(s, 'File', 'closeFile')!.label).toBe('Close File');
        expect(find(s, 'File', 'closeFile')!.disabled ?? false).toBe(closeFileDisabled);
        // View: the folder views only exist in workspace mode.
        expect(find(s, 'View', 'toggleFolders')!.disabled ?? false).toBe(wsDisabled);
        expect(find(s, 'View', 'toggleOpenOnly')!.disabled ?? false).toBe(wsDisabled);
        // The open trio stays enabled in every mode.
        for (const c of ['open', 'openFolder', 'openWorkspace'] as const) {
          expect(find(s, 'File', c)!.disabled).toBeUndefined();
        }
      }
    }
    // Workspace mode with no document open: Close File alone grays out.
    const wsNoDoc = { ...base, appMode: 'workspace' as const, docOpen: false };
    expect(find(wsNoDoc, 'File', 'closeFile')!.disabled).toBe(true);
    expect(find(wsNoDoc, 'File', 'closeWorkspace')!.disabled).toBeUndefined();
  });

  test('U191: issue #40 — Edit Mode grays out with no document open (splash and workspace alike), enabled once one is', () => {
    for (const isMac of [true, false]) {
      // No document: disabled on the standalone splash AND in a workspace
      // with no file active.
      const splash = { ...base, isMac, appMode: 'splash' as const, docOpen: false };
      expect(find(splash, 'View', 'toggleMode')!.disabled).toBe(true);
      const wsNoDoc = { ...base, isMac, appMode: 'workspace' as const, docOpen: false };
      expect(find(wsNoDoc, 'View', 'toggleMode')!.disabled).toBe(true);
      // Document open (a file, or the untitled buffer — both set docOpen).
      for (const appMode of ['file', 'workspace'] as const) {
        expect(find({ ...base, isMac, appMode, docOpen: true }, 'View', 'toggleMode')!.disabled).toBeUndefined();
      }
    }
  });

  test('U61: View starts with Folders (Mod+Shift+E checkbox); File carries Open Folder… after Open Recent; settings clamp', () => {
    expect(DEFAULT_HOTKEYS.toggleFolders).toBe('Mod+Shift+E');
    for (const s of [base, { ...base, isMac: false }]) {
      const view = commandsIn(s, 'View').map((i) => i.command);
      expect(view[0]).toBe('toggleFolders');
      expect(find(s, 'View', 'toggleFolders')!.label).toBe('Folders');
      expect(find(s, 'View', 'toggleFolders')!.accelerator).toBe('Mod+Shift+E');
      expect(find(s, 'View', 'toggleFolders')!.checked).toBe(false);
      // PRD 002 §D14: Open Folder… sits directly after Open… now.
      const file = buildMenuSpec(s).submenus.find((m) => m.title === 'File')!;
      const openIdx = file.items.findIndex((i) => i.type === 'command' && i.command === 'open');
      const after = file.items[openIdx + 1];
      expect(after.type === 'command' && after.command).toBe('openFolder');
      expect(after.type === 'command' && after.label).toBe('Open Folder…');
      expect(after.type === 'command' && after.accelerator).toBeUndefined();
    }
    expect(find({ ...base, showFolders: true }, 'View', 'toggleFolders')!.checked).toBe(true);
    const rebound = { ...base, hotkeys: { ...DEFAULT_HOTKEYS, toggleFolders: 'Mod+Shift+D' } };
    expect(find(rebound, 'View', 'toggleFolders')!.accelerator).toBe('Mod+Shift+D');
    // Settings: default-off panel, clamped width, hotkey merge.
    expect(parseSettings('{}').showFolders).toBe(false);
    expect(parseSettings('{"showFolders":true}').showFolders).toBe(true);
    expect(parseSettings('{}').folderWidth).toBe(240);
    expect(parseSettings('{"folderWidth":100}').folderWidth).toBe(160);
    expect(parseSettings('{"folderWidth":999}').folderWidth).toBe(480);
    expect(parseSettings('{"hotkeys":{"save":"Mod+S"}}').hotkeys.toggleFolders).toBe('Mod+Shift+E');
  });

  test('U271: issue #84 — View carries Next/Previous Open File with live accelerators, gated on the open set', () => {
    const ws = { ...base, openFileCount: 2 };
    // Placed with the other open-file entries, straight after Only Open Files.
    const view = commandsIn(ws, 'View').map((i) => i.command);
    expect(view.slice(0, 4)).toEqual(['toggleFolders', 'toggleOpenOnly', 'nextFile', 'prevFile']);
    expect(find(ws, 'View', 'nextFile')!.label).toBe('Next Open File');
    expect(find(ws, 'View', 'prevFile')!.label).toBe('Previous Open File');
    expect(find(ws, 'View', 'nextFile')!.accelerator).toBe('Ctrl+Tab');
    expect(find(ws, 'View', 'prevFile')!.accelerator).toBe('Ctrl+Shift+Tab');
    expect(find(ws, 'View', 'nextFile')!.disabled).toBeUndefined();
    expect(find(ws, 'View', 'prevFile')!.disabled).toBeUndefined();
    // Accelerators follow a rebinding — including a strict-Ctrl recording.
    const rebound = {
      ...ws,
      hotkeys: { ...DEFAULT_HOTKEYS, nextFile: 'Mod+Alt+ArrowRight', prevFile: 'Ctrl+Alt+Tab' },
    };
    expect(find(rebound, 'View', 'nextFile')!.accelerator).toBe('Mod+Alt+ArrowRight');
    expect(find(rebound, 'View', 'prevFile')!.accelerator).toBe('Ctrl+Alt+Tab');
    // Cycling needs two open files in a workspace; below that it grays out.
    const grayed = [
      { ...ws, openFileCount: 1 },
      { ...ws, openFileCount: 0 },
      { ...base }, // openFileCount absent — reads as zero
      { ...ws, appMode: 'file' as const },
    ];
    for (const st of grayed) {
      expect(find(st, 'View', 'nextFile')!.disabled).toBe(true);
      expect(find(st, 'View', 'prevFile')!.disabled).toBe(true);
    }
  });
});
