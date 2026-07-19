import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { displayEntries, isMarkdownFile, type DirEntry } from '../lib/folderTree';
import { folderContextMenu, validateEntryName } from '../lib/folderOps';
import { FOLDER_WIDTH_MAX, FOLDER_WIDTH_MIN } from '../lib/settings';

/**
 * SPEC34 §3: the folder sidebar — pure view. The owner (App) holds the
 * root, the expanded set, the per-directory listings, the open-file set
 * (SPEC36), and all I/O; this component renders rows, forwards clicks,
 * and runs the width drag with the split-divider pointer-capture pattern
 * (live CSS variable, one persisted commit on release).
 */

export interface FolderPanelProps {
  root: string | null;
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
  onSync(): void;
  onClose(): void;
  onWidth(width: number): void;
  /** SPEC35 §2.5: which seam-backed menu items exist on this platform. */
  caps: { canReveal: boolean; canTrash: boolean; canRename: boolean; canCopy: boolean };
  /** SPEC35 §3: an invoked menu item — the owner runs the operation. */
  onMenuAction(id: string, target: { kind: 'dir' | 'file' | 'root'; path: string }): void;
  /** SPEC35 §5: the row whose label is an in-place rename input; null = none. */
  renamingPath: string | null;
  /** A failed commit's fs error — surfaces in the input's title (§5.4). */
  renameError: string | null;
  onRenameCommit(oldPath: string, newName: string): void;
  onRenameCancel(): void;
}

type MenuTarget = { kind: 'dir' | 'file' | 'root'; path: string; x: number; y: number };

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
  onRowMenu,
}: {
  path: string;
  name: string;
  depth: number | null;
  p: FolderPanelProps;
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
  onRowMenu,
}: {
  dir: string;
  depth: number;
  p: FolderPanelProps;
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
                {open && <Rows dir={path} depth={depth + 1} p={p} onRowMenu={onRowMenu} />}
              </div>
            );
          }
          return (
            <div key={path}>
              <button
                className="folder-item folder-item-dir"
                data-testid="folder-item"
                data-path={path}
                style={{ '--mm-depth': `${10 + depth * 14}px` } as CSSProperties}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => p.onToggleDir(path)}
                onContextMenu={(ev) => onRowMenu('dir', path, ev)}
              >
                <span className="folder-chevron" aria-hidden="true">
                  {open ? (
                    <svg width="16" height="16" viewBox="0 0 16 16">
                      <path d="M3.5 6 L8 10.5 L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16">
                      <path d="M6 3.5 L10.5 8 L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                {e.name}
              </button>
              {open && <Rows dir={path} depth={depth + 1} p={p} onRowMenu={onRowMenu} />}
            </div>
          );
        }
        if (p.renamingPath === path) return <RenameRow key={path} p={p} dir={dir} entry={e} depth={depth} />;
        return <FileRow key={path} path={path} name={e.name} depth={depth} p={p} onRowMenu={onRowMenu} />;
      })}
    </>
  );
}

export function FolderPanel(p: FolderPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);

  const openMenu = (kind: MenuTarget['kind'], path: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ kind, path, x: e.clientX, y: e.clientY });
  };

  // SPEC35 §3.2: positioned at the pointer, clamped to the viewport.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !menu) return;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4))}px`;
  }, [menu]);

  // SPEC35 §3.2: dismissed by Esc, any outside pointer-down, scroll, resize.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

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

  const dragWidth = (e: React.PointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (!panel) return;
    e.preventDefault();
    const divider = e.currentTarget;
    divider.setPointerCapture(e.pointerId);
    const left = panel.getBoundingClientRect().left;
    let w = p.width;
    const onMove = (ev: PointerEvent) => {
      w = Math.min(FOLDER_WIDTH_MAX, Math.max(FOLDER_WIDTH_MIN, ev.clientX - left));
      panel.style.setProperty('--mm-folders', `${w}px`);
    };
    const onUp = () => {
      divider.removeEventListener('pointermove', onMove);
      divider.removeEventListener('pointerup', onUp);
      p.onWidth(Math.round(w));
    };
    divider.addEventListener('pointermove', onMove);
    divider.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className="folder-panel"
      data-testid="folder-panel"
      ref={panelRef}
      style={{ '--mm-folders': `${p.width}px` } as React.CSSProperties}
      onContextMenu={(e) => e.preventDefault()} // SPEC35 §3.1: no native menu in the panel
    >
      <div className="folder-header" data-testid="folder-header">
        <span className="folder-title">{p.root ? p.basename(p.root) : 'Folders'}</span>
        <button
          data-testid="folder-open-only"
          className={p.openOnly ? 'filter-on' : undefined}
          title={p.openOnly ? 'Show the folder tree' : 'Show only open files'}
          disabled={!p.root && p.openFiles.length === 0}
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
          disabled={!p.root || p.openOnly}
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
        <button data-testid="folder-close" title="Close the folder panel" onClick={p.onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <line x1="4.4" y1="4.4" x2="11.6" y2="11.6" />
              <line x1="11.6" y1="4.4" x2="4.4" y2="11.6" />
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
              <FileRow key={path} path={path} name={p.basename(path)} depth={null} p={p} onRowMenu={openMenu} />
            ))
          )}
        </div>
      ) : p.root ? (
        <div
          className="folder-list"
          ref={listRef}
          onContextMenu={(e) => {
            // Rows handle their own menus; the remaining surface is the
            // empty area — the `root` menu (SPEC35 §3.1, root always set here).
            if ((e.target as HTMLElement).closest('[data-path]')) return;
            if (p.root) openMenu('root', p.root, e);
          }}
        >
          <Rows dir={p.root} depth={0} p={p} onRowMenu={openMenu} />
        </div>
      ) : (
        <div className="folder-empty">
          <button data-testid="folder-open-btn" onClick={p.onOpenFolder}>
            Open Folder…
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
  );
}
