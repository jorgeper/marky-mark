import type { AppMode } from './appMode';
import { DEFAULT_START_ACTIONS, type StartActionId } from './startActions';
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
  /**
   * Issue #22: true ⇒ the item is grayed out (mode gating). The Tauri layer
   * renders it as a disabled native item; the browser shim records it and
   * refuses click()s on it. Only ever present when true.
   */
  disabled?: boolean;
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
  /** PRD 002 §D15: 'workspace' entries open .marky-workspace files; absent = file. */
  kind?: 'file' | 'workspace';
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

/**
 * PRD 009 Req 12: everything the View menu is derived from — the slice of
 * MenuState `buildViewItems` reads, so the in-app menu (lib/appMenu.ts) can
 * feed the SAME builder without inventing the File-menu state it has no use
 * for. MenuState extends it, so the native call sites are unchanged.
 */
export interface ViewMenuState {
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
  /** Issue #10: the line-number gutter (persisted setting). */
  lineNumbers: boolean;
  /** SPEC34 §4.1: the folder sidebar's visibility (persisted setting). */
  showFolders: boolean;
  /**
   * PRD 007 Req 17: whether this user may change the open document at all.
   * OPTIONAL so every pre-#79 MenuState call site (and frozen test fixtures)
   * keeps its exact menus: absent reads as "no permission model" — the
   * desktop, shim and web flavors, where everything stays as it was. False
   * grays out Edit Mode, Save and Save As… (and their accelerators, which
   * App gates in the command handlers), so nothing offers a route to a write
   * the server would only refuse.
   */
  canEdit?: boolean;
  /**
   * SPEC36 §5.2: the only-open-files view's checkbox. OPTIONAL so pre-36
   * MenuState call sites (and frozen test fixtures) stay valid; absent
   * reads as off.
   */
  openOnly?: boolean;
  /**
   * Issue #84: how many files are in the open set — gates the Next/Previous
   * Open File items (cycling under two is a no-op). OPTIONAL so pre-#84
   * MenuState call sites (and frozen test fixtures) stay valid; absent
   * reads as zero.
   */
  openFileCount?: number;
  /**
   * Issue #22: the three-mode model (splash | file | workspace) — the
   * derived deriveAppMode() value. Drives the per-item disabled gating:
   * workspace-only items gray out outside workspace mode.
   */
  appMode: AppMode;
  /** Issue #22: a document (file or untitled buffer) is open — gates Close File. */
  docOpen: boolean;
  /**
   * PRD 013 Reqs 13–14: the file tab strip's checkbox. OPTIONAL so every
   * pre-#144 ViewMenuState call site (and frozen test fixtures) keeps its
   * exact View menu: absent reads as "no tab-strip seam" and the row is
   * simply not there — the semanticZoom idiom, chosen over the
   * WORKSPACE_VIEW_COMMANDS omission set (lib/appMenu.ts) because that set
   * keys on the workspace capability, which the hosted flavor HAS while its
   * build must still show no strip (PRD 013 non-goal).
   */
  fileTabs?: boolean;
  /**
   * PRD 011 Reqs 2+23: the Experimental semantic-zoom switch. OPTIONAL so
   * every pre-#117 ViewMenuState call site (and frozen test fixtures) keeps
   * its exact View menu: absent reads as off, and the rows are simply not
   * there — absent, not disabled.
   */
  semanticZoom?: boolean;
  /**
   * Issue #167: the split panes' sync-scroll checkbox. OPTIONAL so every
   * pre-#167 ViewMenuState call site (and frozen test fixtures) keeps its
   * exact View menu: absent reads as "no row". Supplied, the row rides
   * beside Split Edit and dispatches the same `toggleSyncScroll` command as
   * the corner button, so the state stays reachable when
   * `showSyncScrollButton` hides that button.
   */
  syncScroll?: boolean;
}

/** Everything the whole native menu bar is derived from (SPEC12 §3.2). */
export interface MenuState extends ViewMenuState {
  /** SPEC29 §3: Open Recent entries, most-recent-first (label ready-made). */
  recentFiles: Array<{ path: string; label: string }>;
  /**
   * PRD 002 §D15: recent workspaces, most-recent-first — the section above
   * the files in Open Recent. OPTIONAL so pre-existing MenuState call sites
   * (and frozen test fixtures) stay valid; absent reads as empty.
   */
  recentWorkspaces?: Array<{ path: string; label: string }>;
  /**
   * PRD 007 Req 19: whether the flavor offers single-file upload/download at
   * all, and whether this user holds the verb. OPTIONAL so every pre-#76
   * MenuState call site (and frozen test fixtures) keeps its exact File menu:
   * absent reads as "no such seam", and the items are simply not there.
   */
  canUpload?: boolean;
  canDownload?: boolean;
  /**
   * PRD 007 Req 22: the entry actions this flavor can honour (lib/
   * startActions.ts) — the SAME list the start page shows, so the two
   * surfaces cannot diverge: whatever the start page offers, File offers.
   * OPTIONAL so every pre-#78 MenuState call site (and frozen test fixture)
   * keeps its exact File menu: absent reads as the desktop set.
   */
  entryActions?: StartActionId[];
}

const sep: PredefinedItemSpec = { type: 'predefined', item: 'Separator' };
const pre = (item: PredefinedItem, label?: string): PredefinedItemSpec =>
  label ? { type: 'predefined', item, label } : { type: 'predefined', item };
const cmd = (
  command: CommandId,
  label: string,
  accelerator?: string,
  checked?: boolean,
  disabled?: boolean
): CommandItemSpec => ({
  type: 'command',
  command,
  label,
  ...(accelerator ? { accelerator } : {}),
  ...(checked !== undefined ? { checked } : {}),
  ...(disabled ? { disabled: true } : {}),
});

/**
 * PRD 009 Req 12: the View items, in ONE place. The native menu bar's View
 * submenu is this list, and the in-app menu's View ▸ flyout is this list
 * mapped to rows (lib/appMenu.ts) — adding an item here adds it to both, and
 * neither surface holds a second copy to drift from.
 */
export function buildViewItems(s: ViewMenuState): MenuItemSpec[] {
  const wsOpen = s.appMode === 'workspace';
  // Issue #84: cycling needs two open files in a workspace to mean anything.
  const noCycle = !wsOpen || (s.openFileCount ?? 0) < 2;
  // PRD 007 Req 17: absent ⇒ no permission model ⇒ every writing item stays.
  const noEdit = s.canEdit === false;

  return [
    // SPEC34 §4.1: layout chrome ahead of the mode toggles. Issue #22:
    // folder views only exist in workspace mode.
    cmd('toggleFolders', 'Folders', s.hotkeys.toggleFolders, s.showFolders, !wsOpen),
    // SPEC36 §5.2: the only-open-files view rides directly after Folders.
    cmd('toggleOpenOnly', 'Only Open Files', s.hotkeys.toggleOpenOnly, s.openOnly ?? false, !wsOpen),
    // Issue #84 (SPEC36 §6.4, amended): the cycle is discoverable, not
    // hotkey-only — accelerators follow the live map.
    cmd('nextFile', 'Next Open File', s.hotkeys.nextFile, undefined, noCycle),
    cmd('prevFile', 'Previous Open File', s.hotkeys.prevFile, undefined, noCycle),
    // PRD 013 Req 13: the strip's checkbox closes the workspace/layout group.
    // Present only where the tab-strip seam exists (state supplied — see the
    // ViewMenuState field above); grayed with no document open, where the
    // strip cannot render (Req 1). Deliberately hotkey-less (PRD non-goal).
    ...(s.fileTabs !== undefined ? [cmd('toggleFileTabs', 'File Tabs', undefined, s.fileTabs, !s.docOpen)] : []),
    // Issue #40: edit mode needs an open document (file or untitled) —
    // grayed on the splash and workspace-no-file states alike.
    cmd('toggleMode', 'Edit Mode', s.hotkeys.toggleEdit, s.mode === 'edit', !s.docOpen || noEdit),
    // SPEC25 §3: split is a first-class toggle, not just a Settings checkbox.
    cmd('toggleSplit', 'Split Edit', s.hotkeys.toggleSplit, s.splitEdit),
    // Issue #167: sync scrolling rides directly under the split it modifies —
    // a checkbox mirroring the persisted `syncScroll`, hotkey-less, on both
    // menu surfaces, so it stays reachable with the corner button hidden.
    ...(s.syncScroll !== undefined ? [cmd('toggleSyncScroll', 'Sync Scrolling', undefined, s.syncScroll)] : []),
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
    // Issue #10: the gutter's only home now that Settings dropped it — a
    // checkbox mirroring the persisted setting, deliberately hotkey-less.
    cmd('toggleLineNumbers', 'Line Numbers', undefined, s.lineNumbers),
    sep,
    // Zoom In sits on the = key (⌘+ without Shift), the platform convention.
    cmd('zoomIn', 'Zoom In', 'Mod+='),
    cmd('zoomOut', 'Zoom Out', 'Mod+-'),
    cmd('zoomReset', 'Actual Size', 'Mod+0'),
    // PRD 011 Reqs 2+23: the semantic-zoom rows exist only while the
    // Experimental feature is on, and are labelled so the two zooms are not
    // confusable with the three text-zoom rows directly above.
    ...(s.semanticZoom
      ? [
          sep,
          cmd('semanticZoomOut', 'Zoom Out Semantically', 'Mod+Shift+-'),
          cmd('semanticZoomIn', 'Zoom In Semantically', 'Mod+Shift+='),
          cmd('semanticZoomReset', 'Full Document', 'Mod+Shift+0'),
        ]
      : []),
    ...(s.isMac ? [sep, pre('Fullscreen')] : []),
  ];
}

/** SPEC12 §1: the full native menu layout for the current platform + state. */
export function buildMenuSpec(s: MenuState): MenuSpec {
  // Issue #22: workspace-only items gray out outside workspace mode; Close
  // File grays out with no document open. Open…/Open Folder…/Open Workspace…
  // stay enabled in every mode.
  const wsOpen = s.appMode === 'workspace';
  // PRD 007 Req 17: absent ⇒ no permission model ⇒ every writing item stays.
  const noEdit = s.canEdit === false;
  // PRD 007 Req 22: Open Folder… / New Workspace… / Open Workspace… exist
  // only where the flavor can honour them — hosted has no local folder to
  // open, the single-file web build has neither folder nor workspace seam.
  const entry = new Set(s.entryActions ?? DEFAULT_START_ACTIONS);
  const entryItems = [
    ...(entry.has('openFolder') ? [cmd('openFolder', 'Open Folder…')] : []),
    ...(entry.has('newWorkspace') ? [cmd('newWorkspace', 'New Workspace…')] : []),
    ...(entry.has('openWorkspace') ? [cmd('openWorkspace', 'Open Workspace…')] : []),
  ];
  // SPEC29 §3.2 + PRD 002 §D15: workspaces first, separator, files, separator,
  // Clear Menu — Clear alone when both sections are empty.
  const recentWs = s.recentWorkspaces ?? [];
  const openRecent: SubmenuItemSpec = {
    type: 'submenu',
    title: 'Open Recent',
    items: [
      ...recentWs.map((r): RecentItemSpec => ({ type: 'recent', path: r.path, label: r.label, kind: 'workspace' })),
      ...(recentWs.length > 0 && s.recentFiles.length > 0 ? [sep] : []),
      ...s.recentFiles.map((r): RecentItemSpec => ({ type: 'recent', path: r.path, label: r.label })),
      ...(recentWs.length + s.recentFiles.length > 0 ? [sep] : []),
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
      // SPEC30 §1: one find bar for both modes (replace appears in edit).
      cmd('find', 'Find…', s.hotkeys.find),
      // SPEC20 follow-up: pick an image file, copy it into the images folder
      // next to the doc, reference it at the cursor (edit mode).
      cmd('insertImage', 'Insert Image…'),
    ],
  };

  // PRD 009 Req 12: the shared list — the in-app menu builds its View ▸ rows
  // from this very builder (lib/appMenu.ts), so the two cannot drift.
  const viewMenu: SubmenuSpec = { title: 'View', items: buildViewItems(s) };

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
            // SPEC34 §4.2: Open Folder… opens a folder as the sidebar root (no
            // file opens); PRD 002 §D14 + PRD 007 Req 22: the workspace flows
            // ride beside it, each present only where the flavor supports it.
            ...entryItems,
            openRecent,
            sep,
            cmd('addFolderToWorkspace', 'Add Folder to Workspace…', undefined, undefined, !wsOpen),
            cmd('saveWorkspaceAs', 'Save Workspace As…', undefined, undefined, !wsOpen),
            // Issue #22: the close cluster — both land on the splash.
            // Issue #158: Close File carries the rebindable Mod+W (the map's
            // default), taken over from Close Window below.
            cmd('closeFile', 'Close File', s.hotkeys.closeFile, undefined, !s.docOpen),
            cmd('closeWorkspace', 'Close Workspace', undefined, undefined, !wsOpen),
            sep,
            // PRD 007 Req 19: single-file transfer, present only where the
            // platform offers it AND the user holds the verb (Req 17).
            ...(s.canUpload ? [cmd('uploadFile', 'Upload File…')] : []),
            ...(s.canDownload ? [cmd('downloadFile', 'Download', undefined, undefined, !s.docOpen)] : []),
            cmd('save', 'Save', s.hotkeys.save, undefined, noEdit),
            cmd('saveAs', 'Save As…', 'Mod+Shift+S', undefined, noEdit),
            cmd('exportDoc', 'Export…'),
            cmd('printDoc', 'Print…', 'Mod+P'),
            sep,
            // Issue #158: ⌘W now belongs to Close File above — this row keeps
            // no accelerator so no two enabled items claim one chord. ⌘Q still
            // quits; a focused aux window still closes via SPEC13 §1.3.
            cmd('close', 'Close Window'),
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
          // PRD 007 Req 22: same capability-gated trio as the mac branch —
          // the start page's list, in menu form.
          ...entryItems,
          openRecent,
          sep,
          cmd('addFolderToWorkspace', 'Add Folder to Workspace…', undefined, undefined, !wsOpen),
          cmd('saveWorkspaceAs', 'Save Workspace As…', undefined, undefined, !wsOpen),
          // Issue #22: the close cluster — both land on the splash.
          // Issue #158: same rebindable chord as the mac branch (Ctrl+W here).
          cmd('closeFile', 'Close File', s.hotkeys.closeFile, undefined, !s.docOpen),
          cmd('closeWorkspace', 'Close Workspace', undefined, undefined, !wsOpen),
          sep,
          // PRD 007 Req 19: single-file transfer, present only where the
          // platform offers it AND the user holds the verb (Req 17).
          ...(s.canUpload ? [cmd('uploadFile', 'Upload File…')] : []),
          ...(s.canDownload ? [cmd('downloadFile', 'Download', undefined, undefined, !s.docOpen)] : []),
          cmd('save', 'Save', s.hotkeys.save, undefined, noEdit),
          cmd('saveAs', 'Save As…', 'Mod+Shift+S', undefined, noEdit),
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
