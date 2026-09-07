import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { displayEntries, isMarkdownFile, type DirEntry } from '../lib/folderTree';
import { folderContextMenu, validateEntryName } from '../lib/folderOps';
import { FOLDER_WIDTH_MAX, FOLDER_WIDTH_MIN, type ViewMode } from '../lib/settings';
import { untitledDisplayName, type ScratchPresence } from '../lib/docName';
import { useAnchoredMenu } from '@marky-mark/editor';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';

/**
 * SPEC34 §3: the folder sidebar — pure view. The owner (App) holds the
 * root, the expanded set, the per-directory listings, the open-file set
 * (SPEC36), and all I/O; this component renders rows, forwards clicks,
 * and runs the width drag with the split-divider pointer-capture pattern
 * (live CSS variable, one persisted commit on release).
 */

export interface FolderPanelProps {
  /**
   * PRD 002 §D17: the workspace's member folders, in order. Empty = the
   * root-less empty state; one root renders exactly as the classic single
   * tree; several roots each get their own independently-collapsible
   * header row (expansion rides the shared `expanded` set).
   */
  roots: string[];
  /** Directory path → its (visible, sorted) children; missing = not loaded. */
  children: Record<string, DirEntry[]>;
  expanded: Set<string>;
  /** The open document's path (row gets `selected`); null clears. */
  selectedPath: string | null;
  /** Issue #257: View ▸ Show All Files — list non-markdown files too (dim,
      inert). The panel only READS it now; the flip is a menu row. */
  showNonMd: boolean;
  /** SPEC36 §1: the open set, tree-ordered — these rows render as tabs. */
  openFiles: string[];
  /** SPEC36 §5: the only-open-files flat view. */
  openOnly: boolean;
  /** SPEC36 §3.6: open paths whose buffer is dirty (active or parked). */
  dirtyFiles: Set<string>;
  /** SPEC36 §3.1 + SPEC35 §2.5: ⌘ is the additive click on mac (Ctrl stays
      the context menu's); also picks the platform reveal label. */
  isMac: boolean;
  width: number;
  join(...parts: string[]): string;
  basename(path: string): string;
  onToggleDir(path: string): void;
  onOpenFile(path: string): void;
  /** SPEC36 §3.1: Mod+click — open in addition and activate. */
  onModOpenFile(path: string): void;
  /** SPEC36 §3.4: the row ✕ — close this open file. */
  onCloseFile(path: string): void;
  /**
   * Issue #311: the scratchpad's boot-opened scratch buffer, while alive —
   * active (row `selected`) or parked (row `open`) — with its dirtiness. Null
   * (or absent: desktop, the shim, the single-file build) renders no row; an
   * ordinary "Untitled" buffer never gets one (PRD 023 Req 8). The row sits
   * outside the path-keyed open set: first under the root in tree view and
   * first in the only-open list.
   */
  scratch?: ScratchPresence | null;
  /** Issue #311: the scratch row's click — restore the parked buffer (no-op while active). */
  onOpenScratch?(): void;
  onOpenFolder(): void;
  /**
   * PRD 007 Req 22: the root-less state of a workspace that HAS been created
   * but holds no folder yet — the new local New Workspace… lands exactly
   * there, so the empty panel must offer the way to add one. Absent (no
   * workspace open) ⇒ the empty panel offers Open Folder… as before.
   */
  onAddFolder?(): void;
  onSync(): void;
  onClose(): void;
  onWidth(width: number): void;
  /**
   * SPEC35 §2.5: which seam-backed menu items exist on this platform, and
   * (PRD 007 Req 17) which of them the signed-in user is permitted to use.
   * The panel never asks which flavor it is in: a Viewer on a hosted
   * workspace and a desktop build with no rename seam both arrive here as
   * the same false flag.
   */
  caps: {
    canReveal: boolean;
    canTrash: boolean;
    canRename: boolean;
    canCopy: boolean;
    canCreate: boolean;
    canCreateFolder: boolean;
    canUpload: boolean;
    canDownload: boolean;
  };
  /**
   * PRD 020 Req 15/17 (issue #259): the share URL of a file row, or null when
   * that row has no address to share. Present only where share links exist —
   * hosted — and its presence IS the seam test: with it, a file row's menu
   * copies the row's link instead of the two filesystem paths (which mean
   * nothing to a cloud user); absent, the menu is exactly what it was.
   */
  shareUrl?(path: string): string | null;
  /**
   * PRD 007 Req 18: a row was dragged onto a folder row — move it there. The
   * owner validates the target (`moveTarget` in lib/folderOps.ts) and runs
   * the rename seam. Absent ⇒ rows are not draggable at all.
   */
  onMoveEntry?(source: string, destDir: string): void;
  /**
   * PRD 007 Req 19: OS files dropped onto the sidebar — upload into `dir`.
   * Absent ⇒ the panel does not accept an external drop.
   */
  onUploadDrop?(dir: string, files: FileList): void;
  /** A rejected upload or refused move, shown in the panel until dismissed. */
  notice: string | null;
  onDismissNotice(): void;
  /** SPEC35 §3: an invoked menu item — the owner runs the operation. */
  onMenuAction(id: string, target: { kind: 'dir' | 'file' | 'root'; path: string }): void;
  /** SPEC35 §5: the row whose label is an in-place rename input; null = none. */
  renamingPath: string | null;
  /** A failed commit's fs error — surfaces in the input's title (§5.4). */
  renameError: string | null;
  onRenameCommit(oldPath: string, newName: string): void;
  onRenameCancel(): void;
  /**
   * PRD 012 Req 9: the sidebar's Folders/TOC switch, handed in as a node so
   * this panel keeps knowing nothing about the other view. It renders at the
   * head of the header, where the TOC view puts the identical control — the
   * two views read as one pane with one switch.
   */
  viewSwitch?: React.ReactNode;
}

type MenuTarget = { kind: 'dir' | 'file' | 'root'; path: string; x: number; y: number };

/**
 * SPEC35 §2.5 + PRD 020 Req 15/17 (issue #259): what the open menu's file
 * branch copies. Asked as the menu opens, so the answer is for THIS row and
 * reads the address bar as it stands — not as it stood at the owner's last
 * render. No share seam (every build but hosted) keeps today's two path
 * items; a seam with no URL for this row (Req 17: unaddressable) gets
 * neither them nor a link. Dir and root menus never consult it.
 */
function fileCopyMode(shareUrl: FolderPanelProps['shareUrl'], menu: MenuTarget): 'paths' | 'link' | 'none' {
  if (menu.kind !== 'file' || !shareUrl) return 'paths';
  return shareUrl(menu.path) === null ? 'none' : 'link';
}

/**
 * PRD 007 Req 18: the sidebar's drag-and-drop, as one object threaded down
 * the row tree. Two drops land on a folder row: another row (a move) or OS
 * files (an upload). The dragged path also rides in `dataTransfer` so a
 * synthetic drop — which never runs a dragstart — still carries it, and the
 * live ref keeps `dragover` decidable (dataTransfer data is unreadable there
 * by design).
 */
interface Dnd {
  /** Whether rows can be picked up at all (the move seam + permission). */
  movable: boolean;
  /** Whether an OS file drop is accepted. */
  uploads: boolean;
  dragging: React.MutableRefObject<string | null>;
  over: string | null;
  setOver(path: string | null): void;
  drop(dir: string, e: React.DragEvent): void;
}

/** Handlers that make a row draggable (a no-op spread when it is not). */
function dragSource(dnd: Dnd, path: string): React.HTMLAttributes<HTMLElement> & { draggable?: boolean } {
  if (!dnd.movable) return {};
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      dnd.dragging.current = path;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', path);
    },
    onDragEnd: () => {
      dnd.dragging.current = null;
      dnd.setOver(null);
    },
  };
}

/** Handlers that make a directory row (or the root surface) a drop target. */
function dropTarget(dnd: Dnd, dir: string): React.HTMLAttributes<HTMLElement> {
  if (!dnd.movable && !dnd.uploads) return {};
  return {
    onDragOver: (e: React.DragEvent) => {
      // Only claim the drop when there is something droppable: a dragged row
      // (move) or OS files (upload). Otherwise the browser's default wins.
      const files = e.dataTransfer.types.includes('Files');
      if (!(files ? dnd.uploads : dnd.movable)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = files ? 'copy' : 'move';
      dnd.setOver(dir);
    },
    onDragLeave: () => dnd.setOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dnd.drop(dir, e);
    },
  };
}

/**
 * A directory row's disclosure chevron: right collapsed, down open. The
 * pane's collapse/expand toggles (PRD 003 Reqs 1–2) reuse it with an
 * explicit direction instead of the open flag.
 */
const CHEVRON_PATHS = {
  left: 'M10 3.5 L5.5 8 L10 12.5',
  right: 'M6 3.5 L10.5 8 L6 12.5',
  down: 'M3.5 6 L8 10.5 L12.5 6',
} as const;

/** The disclosure/edge triangle — shared with the sidebar's TOC view (PRD 012). */
export function Chevron({ open, dir }: { open?: boolean; dir?: 'left' | 'right' }) {
  const direction = dir ?? (open ? 'down' : 'right');
  return (
    <span className="folder-chevron" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path d={CHEVRON_PATHS[direction]} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/**
 * SPEC34 §3: the pane's width drag — the split divider's pointer-capture
 * pattern. The live width lands on the slide wrapper's `--mm-folders` (the
 * wrapper and the panel both read it, so they track the pointer together) and
 * only the settled width is handed back to the owner to persist.
 *
 * PRD 012 Req 1: both views of the one pane drag the one `settings.folderWidth`
 * — shared from here so the two panels cannot drift apart.
 */
export function paneWidthDrag({
  panelRef,
  slideRef,
  width,
  onWidth,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  slideRef: React.RefObject<HTMLDivElement | null>;
  width: number;
  onWidth(width: number): void;
}) {
  return (e: React.PointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    const slideEl = slideRef.current;
    if (!panel || !slideEl) return;
    e.preventDefault();
    const divider = e.currentTarget;
    divider.setPointerCapture(e.pointerId);
    const left = panel.getBoundingClientRect().left;
    let w = width;
    const onMove = (ev: PointerEvent) => {
      w = Math.min(FOLDER_WIDTH_MAX, Math.max(FOLDER_WIDTH_MIN, ev.clientX - left));
      slideEl.style.setProperty('--mm-folders', `${w}px`);
    };
    const onUp = () => {
      divider.removeEventListener('pointermove', onMove);
      divider.removeEventListener('pointerup', onUp);
      onWidth(Math.round(w));
    };
    divider.addEventListener('pointermove', onMove);
    divider.addEventListener('pointerup', onUp);
  };
}

/**
 * PRD 003 Req 2: the closed pane's reopen chevron, pinned at the workspace's
 * top-left edge. The owner renders it only where the sidebar itself could
 * show — the folder seam, or an open document for the TOC view (issue #257,
 * which took the view switch out of the collapsed state) — so the web build
 * still keeps zero folder-pane DOM.
 *
 * Issue #257: it is the ONE show control for the whole sidebar, so it is
 * worded for the sidebar ("Show sidebar"), not for the folder panel.
 */
export function FolderExpandButton({ onClick }: { onClick(): void }) {
  return (
    <IconButton
      className="folder-expand"
      data-testid="folder-expand"
      title="Show sidebar"
      aria-label="Show sidebar"
      onClick={onClick}
    >
      <Chevron dir="right" />
    </IconButton>
  );
}

/**
 * PRD 003 Reqs 6–7: the split preview's edge toggle, pinned at the
 * workspace's top-right edge in edit mode — a click collapses the open
 * preview into the full-screen editor, or reopens the split. The same
 * compact edge tab as FolderExpandButton, mirrored to the opposite edge;
 * it lives here to share the IconButton/edge-tab pattern. The owner
 * dispatches the existing `toggleSplit` command — only `settings.splitEdit`
 * flips, so the menu checkbox, Mod+\, and the Settings toggle stay in sync.
 *
 * Issue #307: the glyph is a split pane, not a chevron, so it can be told
 * apart from the comments toggle beside it. The frame and divider are the
 * same in both states; the text lines sit in the right (preview) half while
 * the preview is open and in the left (editor) half while it is closed — one
 * glyph, two visibly different states, pinned by `data-icon` for tests.
 */
export function PreviewToggleButton({ open, onClick }: { open: boolean; onClick(): void }) {
  const label = open ? 'Hide the preview pane' : 'Show the preview pane';
  return (
    <IconButton
      className="preview-edge"
      data-testid={open ? 'preview-collapse' : 'preview-expand'}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        aria-hidden="true"
        data-testid="preview-toggle-icon"
        data-icon={open ? 'preview-open' : 'preview-closed'}
      >
        <g stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="M8 3v10" />
          {open ? <path d="M10 5.5h2M10 8h2M10 10.5h2" /> : <path d="M4 5.5h2M4 8h2M4 10.5h2" />}
        </g>
      </svg>
    </IconButton>
  );
}

/**
 * PRD 023 §14 (issue #284): the comments pane's edge toggle — immediately
 * right of the preview toggle in the workspace's top-right cluster, in every
 * document mode. The same compact edge tab as its two siblings. The owner
 * dispatches the existing `toggleComments` command — only the persisted
 * `settings.showComments` flips, so View → Comments and Mod+Shift+C stay in
 * sync.
 *
 * Issue #307: the glyph is a speech bubble, not a chevron, so it reads as
 * "comments" next to the preview toggle's split pane. Open shows the bubble
 * with its text lines; closed shows the empty outline — pinned by
 * `data-icon` for tests.
 */
export function CommentsToggleButton({ open, onClick }: { open: boolean; onClick(): void }) {
  const label = open ? 'Hide the comments pane' : 'Show the comments pane';
  return (
    <IconButton
      className="comments-edge"
      data-testid={open ? 'comments-collapse' : 'comments-expand'}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        aria-hidden="true"
        data-testid="comments-toggle-icon"
        data-icon={open ? 'comments-open' : 'comments-closed'}
      >
        <g stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 3.5A1.5 1.5 0 0 1 4 2h8a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 12 11H7.5L4.5 13.8V11H4a1.5 1.5 0 0 1-1.5-1.5z" />
          {open ? <path d="M5.5 5.5h5M5.5 8h3" /> : null}
        </g>
      </svg>
    </IconButton>
  );
}

/**
 * Issue #125: the edit/preview switch — immediately left of the preview
 * chevron in the workspace's top-right cluster. One icon button in the
 * chevron's own style; the glyph names the mode a click moves TO (pencil ⇒
 * edit, eye ⇒ read), like the chevron points where it will take you, and
 * `data-mode` still carries the current mode. The owner dispatches the
 * existing `toggleMode` command, so the selection and reading-position
 * carry-over, autosave-on-toggle and the edit-grant guard behave exactly as
 * they do for the labelled ModeToggleButton beside it and Mod+E.
 */
export function ModeSwitchButton({ mode, onClick }: { mode: ViewMode; onClick(): void }) {
  const toEdit = mode !== 'edit';
  const label = toEdit ? 'Switch to edit' : 'Switch to preview';
  return (
    <IconButton
      className="mode-edge"
      data-testid="mode-switch"
      data-mode={mode}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" data-testid="mode-switch-icon" data-icon={toEdit ? 'pencil' : 'eye'}>
        {toEdit ? (
          <g stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11.2 2.6l2.2 2.2L5.6 12.6l-3 .8.8-3z" />
            <path d="M9.8 4l2.2 2.2" />
          </g>
        ) : (
          <g stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.6 8c1.6-2.9 3.8-4.4 6.4-4.4S12.8 5.1 14.4 8c-1.6 2.9-3.8 4.4-6.4 4.4S3.2 10.9 1.6 8z" />
            <circle cx="8" cy="8" r="2.1" />
          </g>
        )}
      </svg>
    </IconButton>
  );
}

/**
 * PRD 025 Req 19 (issue #330): the labelled edit/preview toggle — "Edit ⌘E"
 * / "Preview ⌘E" — moved out of the toolbar (SPEC2 §4.1 / SPEC12 header,
 * both amended) to be the LAST member of the page-level control group, after
 * the comments chevron, styled `.btn-quiet` like its neighbours. Everything
 * the toolbar button had is kept verbatim: the `edit-toggle` testid, the
 * label, the `<kbd>` combo hint (the `toggleEdit` hotkey, display-formatted
 * for the platform), the tooltip and the `on` state in edit mode. The owner
 * dispatches `toggleMode`, so the icon `mode-switch`, Mod+E and the View ▸
 * menu row all share one command path; the render gate stays in App.tsx.
 */
export function ModeToggleButton({ mode, combo, onClick }: { mode: ViewMode; combo: string; onClick(): void }) {
  return (
    <button
      className={`btn btn-quiet btn-sm mode-toggle${mode === 'edit' ? ' on' : ''}`}
      data-testid="edit-toggle"
      title={`Toggle edit / preview (${combo})`}
      onClick={onClick}
    >
      {mode === 'edit' ? 'Preview' : 'Edit'}
      <kbd>{combo}</kbd>
    </button>
  );
}

/**
 * Issue #167: the sync-scroll toggle — immediately beside the mode switch in
 * the workspace's top-right cluster, split edit only (the owner gates it).
 * Same edge-tab style as its two neighbours above; the glyph is two pane
 * arrows, linked while the panes scroll together, and the label names the
 * move a click makes. The owner dispatches the `toggleSyncScroll` command —
 * only `settings.syncScroll` flips, so the View ▸ checkbox stays in step and
 * the button holds no toggle logic of its own.
 */
export function SyncScrollButton({ on, onClick }: { on: boolean; onClick(): void }) {
  const label = on ? 'Scroll panes independently' : 'Scroll panes together';
  return (
    <IconButton
      className="sync-edge"
      data-testid="sync-scroll-toggle"
      data-state={on ? 'on' : 'off'}
      aria-pressed={on}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <g stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 3v10M2.7 5l1.8-2 1.8 2M2.7 11l1.8 2 1.8-2" />
          <path d="M11.5 3v10M9.7 5l1.8-2 1.8 2M9.7 11l1.8 2 1.8-2" />
          {on ? <path d="M6.5 8h3" /> : <path d="M6 10.5l4-5" />}
        </g>
      </svg>
    </IconButton>
  );
}

/**
 * SPEC35 §5: the row's label swapped for a text input. Enter commits, Esc
 * cancels, blur commits; an invalid or unchanged value cancels instead.
 * Validation runs on every keystroke — name rules plus a case-insensitive
 * sibling collision check against the live listing (excluding itself).
 */
function RenameRow({ p, dir, entry, depth }: { p: FolderPanelProps; dir: string; entry: DirEntry; depth: number }) {
  const path = p.join(dir, entry.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  const [value, setValue] = useState(entry.name);
  const siblings = (p.children[dir] ?? [])
    .map((s) => s.name)
    .filter((n) => n.toLowerCase() !== entry.name.toLowerCase());
  const error =
    validateEntryName(value) ??
    (siblings.some((n) => n.toLowerCase() === value.toLowerCase()) ? 'Already exists here' : null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (entry.isDir) el.select();
    else el.setSelectionRange(0, entry.name.replace(/\.[^.]+$/, '').length); // the stem
  }, []);
  useEffect(() => {
    if (p.renameError) doneRef.current = false; // the commit failed — the input lives on
  }, [p.renameError]);
  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (!commit || error || value === entry.name) p.onRenameCancel();
    else p.onRenameCommit(path, value);
  };
  return (
    <div className="folder-item folder-rename" style={{ '--mm-depth': `${10 + depth * 14}px` } as CSSProperties}>
      <input
        ref={inputRef}
        data-testid="folder-rename-input"
        // PRD 018 §E26 (issue #205): class-targeted (was `.folder-rename
        // input` in styles.css) — the lint bans bare element descendants.
        className={error ? 'folder-rename-input invalid' : 'folder-rename-input'}
        title={p.renameError ?? error ?? undefined}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation(); // the panel's other interactions stay inert
          if (e.key === 'Enter') finish(true);
          else if (e.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)}
      />
    </div>
  );
}

/** The markdown-file glyph every file row leads with. */
function MdGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <line x1="5.6" y1="2.6" x2="5.6" y2="13.4" />
        <line x1="10.4" y1="2.6" x2="10.4" y2="13.4" />
        <line x1="2.6" y1="6.7" x2="13.4" y2="5" />
        <line x1="2.6" y1="10.2" x2="13.4" y2="10.2" />
      </g>
    </svg>
  );
}

/**
 * SPEC36 §3.4/§3.6: the trailing slot on an open row — the dirty ● swaps for
 * the ✕ on hover (styles.css). A span with role=button: the row itself is
 * already a <button>. Issue #320: with no `onClose` (the scratch row) the
 * slot renders no ✕ at all and keeps its ● through hover — `no-close`
 * cancels the swap — so the row cannot be closed and never reflows.
 */
function TabSlot({ dirty, onClose }: { dirty: boolean; onClose?(): void }) {
  return (
    <span className={`folder-tab-slot${onClose ? '' : ' no-close'}`}>
      {dirty && <span className="folder-dirty" data-testid="folder-dirty" aria-hidden="true" />}
      {onClose && (
        <span
          className="folder-tab-close"
          data-testid="folder-tab-close"
          role="button"
          title="Close file"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
            <g stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <line x1="4.4" y1="4.4" x2="11.6" y2="11.6" />
              <line x1="11.6" y1="4.4" x2="4.4" y2="11.6" />
            </g>
          </svg>
        </span>
      )}
    </span>
  );
}

/**
 * Issue #311: the scratchpad's scratch buffer as a folder-panel row — the
 * same tab pill an open file gets (SPEC36 §4: `selected` while active, `open`
 * while parked, the ●/✕ slot), labelled from the shared name resolution and
 * carrying `.scratch-name` so it resolves the --mm-scratch-name token pair
 * exactly like the toolbar name and the tab label (PRD 023 Req 7). Its own
 * test id (never `folder-item`, so existing row counts are untouched). No
 * context menu, no drag source, no rename: it is not a file. Issue #320: and
 * no ✕ — inside the owner's scratchpad the buffer is always alive, so the
 * slot carries the dirty ● alone.
 */
function ScratchRow({ depth, p }: { depth: number | null; p: FolderPanelProps }) {
  const s = p.scratch;
  if (!s) return null;
  const { name } = untitledDisplayName(true);
  return (
    <button
      className={`folder-item btn-quiet${s.active ? ' selected' : ' open'}`}
      data-testid="folder-item-scratch"
      data-scratch="true"
      style={depth === null ? undefined : ({ '--mm-depth': `${10 + depth * 14}px` } as CSSProperties)}
      onMouseDown={(e) => e.preventDefault()}
      // Right-click opens nothing — and must not bubble to the list's
      // root menu (this row has no data-path for that handler to skip on).
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      // Clicking the active row is a no-op; the parked one restores.
      onClick={s.active ? undefined : p.onOpenScratch}
    >
      <span className="folder-glyph">
        <MdGlyph />
      </span>
      <span className="scratch-name" data-scratch="true">
        {name}
      </span>
      <TabSlot dirty={s.dirty} />
    </button>
  );
}

/**
 * A markdown (or dim) file row — shared by the tree and the only-open flat
 * list. Open rows are tab pills carrying the dirty ● and the hover ✕ (a
 * span with role=button: the row itself is already a <button>).
 */
function FileRow({
  path,
  name,
  depth,
  p,
  dnd,
  onRowMenu,
}: {
  path: string;
  name: string;
  depth: number | null;
  p: FolderPanelProps;
  dnd: Dnd;
  onRowMenu(kind: 'dir' | 'file', path: string, e: React.MouseEvent): void;
}) {
  const md = isMarkdownFile(name);
  const open = p.openFiles.includes(path);
  const selected = p.selectedPath === path;
  return (
    <button
      // PRD 018 §E27 (issue #205): the class template sits inline so the
      // style lint can see the static `btn-quiet` primitive token.
      className={`folder-item btn-quiet${md ? '' : ' folder-item-dim'}${open && !selected ? ' open' : ''}${selected ? ' selected' : ''}`}
      data-testid="folder-item"
      data-path={path}
      {...dragSource(dnd, path)}
      style={depth === null ? undefined : ({ '--mm-depth': `${10 + depth * 14}px` } as CSSProperties)}
      // Not `disabled` — a disabled button swallows the SPEC35 §3.1
      // contextmenu; dim rows stay click-inert via the absent onClick.
      // Selection starts on mousedown: WebKit word-selects on double / fast
      // repeated (⌘)clicks even under user-select:none — swallow it here.
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(ev) => onRowMenu('file', path, ev)}
      onClick={
        md
          ? (e) => {
              // SPEC36 §3.1: on mac a plain Ctrl+click belongs to the (SPEC35)
              // context menu — never an open. ⌘ (mac) / Ctrl (elsewhere) adds.
              if (p.isMac && e.ctrlKey) return;
              if (p.isMac ? e.metaKey : e.ctrlKey) p.onModOpenFile(path);
              else p.onOpenFile(path);
            }
          : undefined
      }
    >
      <span className="folder-glyph">{md ? <MdGlyph /> : '·'}</span>
      {name}
      {open && <TabSlot dirty={p.dirtyFiles.has(path)} onClose={() => p.onCloseFile(path)} />}
    </button>
  );
}

function Rows({
  dir,
  depth,
  p,
  dnd,
  onRowMenu,
}: {
  dir: string;
  depth: number;
  p: FolderPanelProps;
  dnd: Dnd;
  onRowMenu(kind: 'dir' | 'file', path: string, e: React.MouseEvent): void;
}) {
  const listed = p.children[dir];
  if (!listed) return null;
  const entries = displayEntries(listed, p.showNonMd);
  return (
    <>
      {entries.map((e) => {
        const path = p.join(dir, e.name);
        if (e.isDir) {
          const open = p.expanded.has(path);
          if (p.renamingPath === path) {
            return (
              <div key={path}>
                <RenameRow p={p} dir={dir} entry={e} depth={depth} />
                {open && <Rows dir={path} depth={depth + 1} p={p} dnd={dnd} onRowMenu={onRowMenu} />}
              </div>
            );
          }
          return (
            <div key={path}>
              <button
                className={`folder-item btn-quiet folder-item-dir${dnd.over === path ? ' drop-target' : ''}`}
                data-testid="folder-item"
                data-path={path}
                style={{ '--mm-depth': `${10 + depth * 14}px` } as CSSProperties}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => p.onToggleDir(path)}
                onContextMenu={(ev) => onRowMenu('dir', path, ev)}
                {...dragSource(dnd, path)}
                {...dropTarget(dnd, path)}
              >
                <Chevron open={open} />
                {e.name}
              </button>
              {open && <Rows dir={path} depth={depth + 1} p={p} dnd={dnd} onRowMenu={onRowMenu} />}
            </div>
          );
        }
        if (p.renamingPath === path) return <RenameRow key={path} p={p} dir={dir} entry={e} depth={depth} />;
        return <FileRow key={path} path={path} name={e.name} depth={depth} p={p} dnd={dnd} onRowMenu={onRowMenu} />;
      })}
    </>
  );
}

export function FolderPanel(p: FolderPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [dropOver, setDropOver] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);

  // PRD 007 Req 17: a gesture exists only where the seam does AND the user
  // holds the verb — the panel asks nothing about which flavor it is in.
  const movable = !!p.onMoveEntry && p.caps.canRename;
  const uploads = !!p.onUploadDrop && p.caps.canUpload;

  // PRD 007 Req 18/19: one drop handler for both kinds of payload. OS files
  // are an upload into the target folder; anything else is the dragged row,
  // taken from the live ref or (for a synthetic drop) the transfer data.
  const dnd: Dnd = {
    movable,
    uploads,
    dragging: draggingRef,
    over: dropOver,
    setOver: setDropOver,
    drop(dir, e) {
      setDropOver(null);
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        if (uploads) p.onUploadDrop?.(dir, files);
        return;
      }
      const source = draggingRef.current ?? e.dataTransfer.getData('text/plain');
      draggingRef.current = null;
      if (source && movable) p.onMoveEntry?.(source, dir);
    },
  };

  const openMenu = (kind: MenuTarget['kind'], path: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ kind, path, x: e.clientX, y: e.clientY });
  };

  // SPEC35 §3.2: anchored at the pointer, dismissed by Esc / outside
  // pointer-down / scroll / resize — the shared menu behaviour.
  const menuRef = useAnchoredMenu(menu, () => setMenu(null));

  // Reveal follow-through: whenever the selection changes, bring its row
  // into view (the owner has already expanded the ancestors).
  useEffect(() => {
    if (!p.selectedPath) return;
    const list = listRef.current;
    const el = list?.querySelector(`[data-path="${CSS.escape(p.selectedPath)}"]`);
    if (!list || !el) return;
    // Vertical-only reveal: scrollIntoView also scrolls horizontally toward
    // the row's right edge, which would drag the tree's left column (the
    // depth indents) off-screen in a horizontally-scrollable tree.
    const x = list.scrollLeft;
    el.scrollIntoView({ block: 'nearest' });
    list.scrollLeft = x;
  }, [p.selectedPath, p.expanded, p.children, p.openOnly]);

  const dragWidth = paneWidthDrag({ panelRef, slideRef, width: p.width, onWidth: p.onWidth });

  // PRD 025 Req 12 (issue #328): the wrapper is a plain fixed-width
  // container — the pane mounts and unmounts in place, no slide phases, no
  // transform (a transform would turn the panel into the containing block
  // for the fixed-position context menu). paneWidthDrag writes --mm-folders
  // onto it.
  return (
    <div
      className="folder-slide"
      ref={slideRef}
      style={{ '--mm-folders': `${p.width}px` } as React.CSSProperties}
    >
      <div
        className="folder-panel"
        data-testid="folder-panel"
        ref={panelRef}
        onContextMenu={(e) => e.preventDefault()} // SPEC35 §3.1: no native menu in the panel
      >
        <div className="folder-header" data-testid="folder-header">
          {/* The collapse chevron leads the header, so it sits exactly where
              the closed pane's reopen chevron sits (FolderExpandButton at the
              head of the left cluster): open or closed, one spot, one glyph
              that only flips direction. Issue #257: it hides the SIDEBAR —
              the same wording the TOC and Search panels' chevrons carry, the
              pane being whatever view is showing. */}
          <IconButton
            data-testid="folder-collapse"
            title="Hide sidebar"
            aria-label="Hide sidebar"
            onClick={p.onClose}
          >
            <Chevron dir="left" />
          </IconButton>
          {p.viewSwitch}
          <span className="folder-title">{p.roots.length === 1 ? p.basename(p.roots[0]) : 'Folders'}</span>
          {/* Issue #257: the header keeps ONE right-side button. The two
              filters it used to carry — Only Open Files and the
              markdown-only/all-files switch — are View menu rows now
              (lib/menuSpec.ts `buildViewItems`), reached from both View
              surfaces; no hidden or disabled remnant stays here. */}
          <IconButton
            data-testid="folder-sync"
            title="Navigate to the open file"
            disabled={!p.selectedPath}
            onClick={p.onSync}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <g stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round">
                <circle cx="8" cy="8" r="4.2" />
                <line x1="8" y1="0.9" x2="8" y2="3.2" />
                <line x1="8" y1="12.8" x2="8" y2="15.1" />
                <line x1="0.9" y1="8" x2="3.2" y2="8" />
                <line x1="12.8" y1="8" x2="15.1" y2="8" />
              </g>
            </svg>
          </IconButton>
        </div>
        {p.openOnly ? (
          // SPEC36 §5.3: the flat only-open list — tree order, no chevrons, no
          // indent, full tab styling; the root-less empty state never shows here.
          <div className="folder-list" ref={listRef}>
            {p.openFiles.length === 0 && !p.scratch ? (
              <div className="folder-open-empty" data-testid="folder-open-empty">
                No open files
              </div>
            ) : (
              <>
                {/* Issue #311: the scratch buffer leads the only-open list. */}
                <ScratchRow depth={null} p={p} />
                {p.openFiles.map((path) => (
                  <FileRow key={path} path={path} name={p.basename(path)} depth={null} p={p} dnd={dnd} onRowMenu={openMenu} />
                ))}
              </>
            )}
          </div>
        ) : p.roots.length === 1 ? (
          <div
            className={`folder-list${dropOver === p.roots[0] ? ' drop-target' : ''}`}
            ref={listRef}
            {...dropTarget(dnd, p.roots[0])}
            onContextMenu={(e) => {
              // Rows handle their own menus; the remaining surface is the
              // empty area — the `root` menu (SPEC35 §3.1, root always set here).
              if ((e.target as HTMLElement).closest('[data-path]')) return;
              openMenu('root', p.roots[0], e);
            }}
          >
            {/* Issue #311: the scratch buffer is the first row under the root. */}
            <ScratchRow depth={0} p={p} />
            <Rows dir={p.roots[0]} depth={0} p={p} dnd={dnd} onRowMenu={openMenu} />
          </div>
        ) : p.roots.length > 1 ? (
          // PRD 002 §D17: multiple roots — each gets a collapsible header row
          // and, when expanded, the exact same lazy tree as the single case.
          <div className="folder-list" ref={listRef}>
            {/* Issue #311: the scratch buffer leads the multi-root list too. */}
            <ScratchRow depth={0} p={p} />
            {p.roots.map((root) => {
              const open = p.expanded.has(root);
              return (
                <div key={root}>
                  <button
                    className={`folder-item btn-quiet folder-item-dir folder-root${dnd.over === root ? ' drop-target' : ''}`}
                    data-testid="folder-root"
                    data-path={root}
                    title={root}
                    {...dropTarget(dnd, root)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => p.onToggleDir(root)}
                    onContextMenu={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      openMenu('root', root, ev);
                    }}
                  >
                    <Chevron open={open} />
                    {p.basename(root)}
                  </button>
                  {open && <Rows dir={root} depth={1} p={p} dnd={dnd} onRowMenu={openMenu} />}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="folder-empty">
            {p.onAddFolder ? (
              <Button pill data-testid="folder-add-btn" onClick={p.onAddFolder}>
                Add Folder to Workspace…
              </Button>
            ) : (
              <Button pill data-testid="folder-open-btn" onClick={p.onOpenFolder}>
                Open Folder…
              </Button>
            )}
          </div>
        )}
        {/* PRD 007 Req 19: a refused upload or move says WHICH rule stopped
            it, right where the drop happened, until the user dismisses it. */}
        {p.notice && (
          <div className="folder-notice" data-testid="folder-notice" role="alert">
            <span>{p.notice}</span>
            <IconButton data-testid="folder-notice-dismiss" title="Dismiss" onClick={p.onDismissNotice}>
              ✕
            </IconButton>
          </div>
        )}
        {menu && (
          <div
            className="menu theme-menu folder-menu"
            data-testid="folder-menu"
            ref={menuRef}
            style={{ left: menu.x, top: menu.y }}
          >
            {folderContextMenu(menu.kind, {
              isMac: p.isMac,
              ...p.caps,
              fileCopy: fileCopyMode(p.shareUrl, menu),
            }).map((it, i) =>
              it === 'sep' ? (
                <div key={`sep-${i}`} className="menu-sep" />
              ) : (
                <button
                  key={it.id}
                  className="menu-item"
                  data-testid={`folder-menu-${it.id}`}
                  onClick={() => {
                    const m = menu;
                    setMenu(null);
                    p.onMenuAction(it.id, { kind: m.kind, path: m.path });
                  }}
                >
                  <span>{it.label}</span>
                </button>
              )
            )}
          </div>
        )}
        <div className="folder-divider" data-testid="folder-divider" onPointerDown={dragWidth} />
      </div>
    </div>
  );
}
