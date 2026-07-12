import type { CommandId } from './commands';
import type { HotkeyMap } from './hotkeys';

/**
 * Pure menu description (SPEC12 §3.2): buildMenuSpec(state) → plain data.
 * No Tauri imports — the platform layer turns this into real native menus,
 * the browser shim records it for e2e, and unit tests assert on it directly.
 * Accelerators are canonical combo strings ("Mod+E"); the platform converts
 * them to its own syntax and keeps them in sync with rebindable hotkeys.
 */

export type PredefinedItem =
  | 'Separator'
  | 'Undo'
  | 'Redo'
  | 'Cut'
  | 'Copy'
  | 'Paste'
  | 'SelectAll'
  | 'Minimize'
  | 'Maximize'
  | 'Fullscreen'
  | 'Hide'
  | 'HideOthers'
  | 'ShowAll'
  | 'Services'
  | 'BringAllToFront';

export interface CommandItemSpec {
  type: 'command';
  command: CommandId;
  label: string;
  accelerator?: string;
  /** Present ⇒ checkbox item. */
  checked?: boolean;
}

export interface PredefinedItemSpec {
  type: 'predefined';
  item: PredefinedItem;
  /** Optional label override (e.g. macOS calls Maximize "Zoom"). */
  label?: string;
}

/** SPEC29 §3.1: an Open Recent entry — a path, not a CommandId. */
export interface RecentItemSpec {
  type: 'recent';
  path: string;
  label: string;
}

/** SPEC29 §3.1: real nesting (File → Open Recent → …). */
export interface SubmenuItemSpec {
  type: 'submenu';
  title: string;
  items: MenuItemSpec[];
}

export type MenuItemSpec = CommandItemSpec | PredefinedItemSpec | RecentItemSpec | SubmenuItemSpec;

export interface SubmenuSpec {
  title: string;
  items: MenuItemSpec[];
}

export interface MenuSpec {
  submenus: SubmenuSpec[];
}

export interface MenuState {
  isMac: boolean;
  mode: 'preview' | 'edit';
  /** SPEC25 §3: the Split Edit checkbox mirrors the persisted setting. */
  splitEdit: boolean;
  showComments: boolean;
  commentsEnabled: boolean;
  commentCount: number;
  hotkeys: HotkeyMap;
  /** SPEC16 §2: Changes Since Save checkbox state (edit modes only). */
  showDiff: boolean;
  /** Word-count chip visibility (persisted setting). */
  showWordCount: boolean;
  /** SPEC26 §3: the front-matter card's SESSION visibility. */
  showFrontmatter: boolean;
  /** SPEC29 §3: Open Recent entries, most-recent-first (label ready-made). */
  recentFiles: Array<{ path: string; label: string }>;
}

const sep: PredefinedItemSpec = { type: 'predefined', item: 'Separator' };
const pre = (item: PredefinedItem, label?: string): PredefinedItemSpec =>
  label ? { type: 'predefined', item, label } : { type: 'predefined', item };
const cmd = (command: CommandId, label: string, accelerator?: string, checked?: boolean): CommandItemSpec => ({
  type: 'command',
  command,
  label,
  ...(accelerator ? { accelerator } : {}),
  ...(checked !== undefined ? { checked } : {}),
});

/** SPEC12 §1: the full native menu layout for the current platform + state. */
export function buildMenuSpec(s: MenuState): MenuSpec {
  // SPEC29 §3.2: recents (MRU), separator, Clear Menu — Clear alone when empty.
  const openRecent: SubmenuItemSpec = {
    type: 'submenu',
    title: 'Open Recent',
    items: [
      ...s.recentFiles.map((r): RecentItemSpec => ({ type: 'recent', path: r.path, label: r.label })),
      ...(s.recentFiles.length > 0 ? [sep] : []),
      cmd('clearRecent', 'Clear Menu'),
    ],
  };
  const editMenu: SubmenuSpec = {
    title: 'Edit',
    items: [
      pre('Undo'),
      pre('Redo'),
      sep,
      pre('Cut'),
      pre('Copy'),
      pre('Paste'),
      pre('SelectAll'),
      sep,
      // SPEC20 follow-up: pick an image file, copy it into the images folder
      // next to the doc, reference it at the cursor (edit mode).
      cmd('insertImage', 'Insert Image…'),
    ],
  };

  const viewMenu: SubmenuSpec = {
    title: 'View',
    items: [
      cmd('toggleMode', 'Edit Mode', s.hotkeys.toggleEdit, s.mode === 'edit'),
      // SPEC25 §3: split is a first-class toggle, not just a Settings checkbox.
      cmd('toggleSplit', 'Split Edit', s.hotkeys.toggleSplit, s.splitEdit),
      // Master switch off (SPEC7 §2): the comments UI is gone, menu included —
      // navigation items too (SPEC14 §2.3).
      ...(s.commentsEnabled
        ? [
            cmd(
              'toggleComments',
              s.commentCount > 0 ? `Comments (${s.commentCount})` : 'Comments',
              s.hotkeys.toggleComments,
              s.showComments
            ),
            cmd('nextComment', 'Next Comment', s.hotkeys.nextComment),
            cmd('prevComment', 'Previous Comment', s.hotkeys.prevComment),
          ]
        : []),
      // SPEC16 §2: diff toggle exists only where an editor does.
      ...(s.mode === 'edit' ? [cmd('toggleDiff', 'Changes Since Save', undefined, s.showDiff)] : []),
      cmd('headingPalette', 'Go to Heading…', s.hotkeys.headingPalette),
      cmd('toggleWordCount', 'Word Count', s.hotkeys.toggleWordCount, s.showWordCount),
      // SPEC26 §3: session toggle for the metadata card (no accelerator).
      cmd('toggleFrontmatter', 'Front Matter', undefined, s.showFrontmatter),
      sep,
      // Zoom In sits on the = key (⌘+ without Shift), the platform convention.
      cmd('zoomIn', 'Zoom In', 'Mod+='),
      cmd('zoomOut', 'Zoom Out', 'Mod+-'),
      cmd('zoomReset', 'Actual Size', 'Mod+0'),
      ...(s.isMac ? [sep, pre('Fullscreen')] : []),
    ],
  };

  const helpItem = cmd('help', 'Marky Mark Help');

  if (s.isMac) {
    return {
      submenus: [
        {
          title: 'Marky Mark',
          items: [
            cmd('about', 'About Marky Mark'),
            cmd('checkUpdates', 'Check for Updates…'),
            sep,
            cmd('settings', 'Settings…', 'Mod+,'),
            sep,
            pre('Services'),
            sep,
            pre('Hide'),
            pre('HideOthers'),
            pre('ShowAll'),
            sep,
            // Custom, not predefined Quit: must route through the unsaved-
            // changes guard (SPEC12 §1.5) — no data-loss path.
            cmd('close', 'Quit Marky Mark', 'Mod+Q'),
          ],
        },
        {
          title: 'File',
          items: [
            // SPEC22 §1: New opens an untitled buffer — no dialog, no ellipsis.
            cmd('newFile', 'New', s.hotkeys.newFile),
            cmd('open', 'Open…', s.hotkeys.openFile),
            openRecent,
            sep,
            cmd('save', 'Save', s.hotkeys.save),
            cmd('saveAs', 'Save As…', 'Mod+Shift+S'),
            cmd('exportDoc', 'Export…'),
            cmd('printDoc', 'Print…', 'Mod+P'),
            sep,
            cmd('close', 'Close Window', 'Mod+W'),
          ],
        },
        editMenu,
        viewMenu,
        { title: 'Window', items: [pre('Minimize'), pre('Maximize', 'Zoom'), sep, pre('BringAllToFront')] },
        { title: 'Help', items: [helpItem] },
      ],
    };
  }

  return {
    submenus: [
      {
        title: 'File',
        items: [
          cmd('newFile', 'New', s.hotkeys.newFile),
          cmd('open', 'Open…', s.hotkeys.openFile),
          openRecent,
          sep,
          cmd('save', 'Save', s.hotkeys.save),
          cmd('saveAs', 'Save As…', 'Mod+Shift+S'),
          cmd('exportDoc', 'Export…'),
          cmd('printDoc', 'Print…', 'Mod+P'),
          sep,
          cmd('settings', 'Settings…', 'Mod+,'),
          sep,
          cmd('close', 'Exit'),
        ],
      },
      editMenu,
      viewMenu,
      {
        title: 'Help',
        items: [helpItem, sep, cmd('about', 'About Marky Mark'), cmd('checkUpdates', 'Check for Updates…')],
      },
    ],
  };
}
