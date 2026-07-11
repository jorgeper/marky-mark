import { describe, expect, test } from 'vitest';
import { buildMenuSpec, type CommandItemSpec, type MenuState } from '../../src/lib/menuSpec';
import { DEFAULT_HOTKEYS } from '../../src/lib/hotkeys';

const base: MenuState = {
  isMac: true,
  mode: 'preview',
  showComments: true,
  commentsEnabled: true,
  commentCount: 0,
  hotkeys: { ...DEFAULT_HOTKEYS },
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
    expect(app).toEqual(['about', 'settings', 'close']);
    expect(find(base, 'Marky Mark', 'settings')!.accelerator).toBe('Mod+,');
    expect(find(base, 'Marky Mark', 'close')!.label).toBe('Quit Marky Mark');
    const file = commandsIn(base, 'File').map((i) => i.command);
    expect(file).toEqual(['open', 'save', 'saveAs', 'close']);
    expect(find(base, 'File', 'close')!.label).toBe('Close Window');
    expect(commandsIn(base, 'Help').map((i) => i.command)).toEqual(['help']);
    // Edit is entirely predefined system items, in the standard order.
    const edit = buildMenuSpec(base).submenus.find((m) => m.title === 'Edit')!;
    expect(edit.items.every((i) => i.type === 'predefined')).toBe(true);
    const editKinds = edit.items.flatMap((i) => (i.type === 'predefined' && i.item !== 'Separator' ? [i.item] : []));
    expect(editKinds).toEqual(['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'SelectAll']);
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
    expect(file).toEqual(['open', 'save', 'saveAs', 'settings', 'close']);
    expect(find(win, 'File', 'close')!.label).toBe('Exit');
    expect(find(win, 'File', 'settings')!.accelerator).toBe('Mod+,');
    expect(commandsIn(win, 'Help').map((i) => i.command)).toEqual(['help', 'about']);
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
});
