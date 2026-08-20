import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { displayEntries, isMarkdownFile, type DirEntry } from '../lib/folderTree';
import { folderContextMenu, validateEntryName } from '../lib/folderOps';
import { FOLDER_WIDTH_MAX, FOLDER_WIDTH_MIN, type ViewMode } from '../lib/settings';
import { slideClasses, type SlidePhase } from '../lib/paneSlide';
import { useAnchoredMenu } from './anchoredMenu';

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
  /** The eye toggle: list non-markdown files too (dim, inert). */
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
  /** PRD 003 Req 9: the open/close slide phase — drives the wrapper's
      width transition and the panel's transform (App owns the timing). */
  slide: SlidePhase;
  width: number;
  join(...parts: string[]): string;
  basename(path: string): string;
  onToggleDir(path: string): void;
  onToggleNonMd(): void;
  onOpenFile(path: string): void;
  /** SPEC36 §3.1: Mod+click — open in addition and activate. */
  onModOpenFile(path: string): void;
  /** SPEC36 §3.4: the row ✕ — close this open file. */
  onCloseFile(path: string): void;
  onToggleOpenOnly(): void;
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
 * top-left edge. The owner renders it only in workspace mode on platforms
 * with the folder seam — the web build keeps zero folder-pane DOM.
 */
export function FolderExpandButton({ onClick }: { onClick(): void }) {
  return (
    <button
      className="folder-expand"
      data-testid="folder-expand"
      title="Show the folder panel"
      aria-label="Show the folder panel"
      onClick={onClick}
    >
      <Chevron dir="right" />
    </button>
  );
}

/**
 * PRD 003 Reqs 6–7: the split preview's edge chevron, pinned at the
 * workspace's top-right edge in edit mode — right collapses the open
 * preview into the full-screen editor, left reopens the split. The same
 * compact edge tab as FolderExpandButton, mirrored to the opposite edge;
 * it lives here to share the Chevron/edge-tab pattern. The owner
 * dispatches the existing `toggleSplit` command — only `settings.splitEdit`
 * flips, so the menu checkbox, Mod+\, and the Settings toggle stay in sync.
 */
export function PreviewToggleButton({ open, onClick }: { open: boolean; onClick(): void }) {
  const label = open ? 'Hide the preview pane' : 'Show the preview pane';
  return (
    <button
      className="preview-edge"
      data-testid={open ? 'preview-collapse' : 'preview-expand'}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <Chevron dir={open ? 'right' : 'left'} />
    </button>
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
 * they do for the toolbar button and Mod+E.
 */
export function ModeSwitchButton({ mode, onClick }: { mode: ViewMode; onClick(): void }) {
  const toEdit = mode !== 'edit';
  const label = toEdit ? 'Switch to edit' : 'Switch to preview';
  return (
    <button
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
    <button
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
    </button>
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
        className={error ? 'invalid' : undefined}
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
  const cls = `folder-item${md ? '' : ' folder-item-dim'}${open && !selected ? ' open' : ''}${selected ? ' selected' : ''}`;
  return (
    <button
      className={cls}
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
      <span className="folder-glyph">
        {md ? (
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
              <line x1="5.6" y1="2.6" x2="5.6" y2="13.4" />
              <line x1="10.4" y1="2.6" x2="10.4" y2="13.4" />
              <line x1="2.6" y1="6.7" x2="13.4" y2="5" />
              <line x1="2.6" y1="10.2" x2="13.4" y2="10.2" />
            </g>
          </svg>
        ) : (
          '·'
        )}
      </span>
      {name}
      {open && (
        <span className="folder-tab-slot">
          {p.dirtyFiles.has(path) && <span className="folder-dirty" data-testid="folder-dirty" aria-hidden="true" />}
          <span
            className="folder-tab-close"
            data-testid="folder-tab-close"
            role="button"
            title="Close file"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              p.onCloseFile(path);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
              <g stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <line x1="4.4" y1="4.4" x2="11.6" y2="11.6" />
                <line x1="11.6" y1="4.4" x2="4.4" y2="11.6" />
              </g>
            </svg>
          </span>
        </span>
      )}
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
                className={`folder-item folder-item-dir${dnd.over === path ? ' drop-target' : ''}`}
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
    // the row's right edge, which would drag the selected tab's left gap
    // off-screen in a horizontally-scrollable tree.
    const x = list.scrollLeft;
    el.scrollIntoView({ block: 'nearest' });
    list.scrollLeft = x;
  }, [p.selectedPath, p.expanded, p.children, p.openOnly]);

  const dragWidth = paneWidthDrag({ panelRef, slideRef, width: p.width, onWidth: p.onWidth });

  // PRD 003 Req 9: the slide wrapper animates its width (the workspace
  // follows) while the panel inside keeps its full width and translates —
  // both on the same 180ms ease, so the pane edge and the workspace edge
  // track pixel-for-pixel. The transform lives only on the sliding phases:
  // steady-state transforms would turn the panel into the containing block
  // for the fixed-position context menu.
  const { sliding, out } = slideClasses(p.slide);
  return (
    <div
      className={`folder-slide${sliding ? ' sliding' : ''}${out ? ' out' : ''}`}
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
              that only flips direction. */}
          <button
            data-testid="folder-collapse"
            title="Hide the folder panel"
            aria-label="Hide the folder panel"
            onClick={p.onClose}
          >
            <Chevron dir="left" />
          </button>
          {p.viewSwitch}
          <span className="folder-title">{p.roots.length === 1 ? p.basename(p.roots[0]) : 'Folders'}</span>
          <button
            data-testid="folder-open-only"
            className={p.openOnly ? 'filter-on' : undefined}
            title={p.openOnly ? 'Show the folder tree' : 'Show only open files'}
            disabled={p.roots.length === 0 && p.openFiles.length === 0}
            onClick={p.onToggleOpenOnly}
          >
            {/* Two stacked tab cards — the open files, front and behind. */}
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <g stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2.2" y="5.4" width="9.2" height="7.6" rx="1.7" />
                <path d="M5.4 2.8h6.7a1.7 1.7 0 0 1 1.7 1.7v5.9" />
              </g>
            </svg>
          </button>
          <button
            data-testid="folder-filter"
            className={p.showNonMd ? undefined : 'filter-on'}
            title={p.showNonMd ? 'Show markdown files only' : 'Show all files'}
            disabled={p.roots.length === 0 || p.openOnly}
            onClick={p.onToggleNonMd}
          >
            {/* The app icon's hash: straight bars, except the top one tilts -9°. */}
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <g stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round">
                <line x1="5.6" y1="2.6" x2="5.6" y2="13.4" />
                <line x1="10.4" y1="2.6" x2="10.4" y2="13.4" />
                <line x1="2.6" y1="6.7" x2="13.4" y2="5" />
                <line x1="2.6" y1="10.2" x2="13.4" y2="10.2" />
              </g>
            </svg>
          </button>
          <button
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
          </button>
        </div>
        {p.openOnly ? (
          // SPEC36 §5.3: the flat only-open list — tree order, no chevrons, no
          // indent, full tab styling; the root-less empty state never shows here.
          <div className="folder-list" ref={listRef}>
            {p.openFiles.length === 0 ? (
              <div className="folder-open-empty" data-testid="folder-open-empty">
                No open files
              </div>
            ) : (
              p.openFiles.map((path) => (
                <FileRow key={path} path={path} name={p.basename(path)} depth={null} p={p} dnd={dnd} onRowMenu={openMenu} />
              ))
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
            <Rows dir={p.roots[0]} depth={0} p={p} dnd={dnd} onRowMenu={openMenu} />
          </div>
        ) : p.roots.length > 1 ? (
          // PRD 002 §D17: multiple roots — each gets a collapsible header row
          // and, when expanded, the exact same lazy tree as the single case.
          <div className="folder-list" ref={listRef}>
            {p.roots.map((root) => {
              const open = p.expanded.has(root);
              return (
                <div key={root}>
                  <button
                    className={`folder-item folder-item-dir folder-root${dnd.over === root ? ' drop-target' : ''}`}
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
              <button data-testid="folder-add-btn" onClick={p.onAddFolder}>
                Add Folder to Workspace…
              </button>
            ) : (
              <button data-testid="folder-open-btn" onClick={p.onOpenFolder}>
                Open Folder…
              </button>
            )}
          </div>
        )}
        {/* PRD 007 Req 19: a refused upload or move says WHICH rule stopped
            it, right where the drop happened, until the user dismisses it. */}
        {p.notice && (
          <div className="folder-notice" data-testid="folder-notice" role="alert">
            <span>{p.notice}</span>
            <button data-testid="folder-notice-dismiss" title="Dismiss" onClick={p.onDismissNotice}>
              ✕
            </button>
          </div>
        )}
        {menu && (
          <div
            className="theme-menu folder-menu"
            data-testid="folder-menu"
            ref={menuRef}
            style={{ left: menu.x, top: menu.y }}
          >
            {folderContextMenu(menu.kind, { isMac: p.isMac, ...p.caps }).map((it, i) =>
              it === 'sep' ? (
                <div key={`sep-${i}`} className="folder-menu-sep" />
              ) : (
                <button
                  key={it.id}
                  className="theme-option"
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
