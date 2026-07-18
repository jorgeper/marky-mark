import { useEffect, useRef, type CSSProperties } from 'react';
import { displayEntries, isMarkdownFile, type DirEntry } from '../lib/folderTree';
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
  /** SPEC36 §3.1: on mac ⌘ is the additive click; Ctrl stays the menu's. */
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
}

/**
 * A markdown (or dim) file row — shared by the tree and the only-open flat
 * list. Open rows are tab pills carrying the dirty ● and the hover ✕ (a
 * span with role=button: the row itself is already a <button>).
 */
function FileRow({ path, name, depth, p }: { path: string; name: string; depth: number | null; p: FolderPanelProps }) {
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
      disabled={!md}
      // Selection starts on mousedown: WebKit word-selects on double / fast
      // repeated (⌘)clicks even under user-select:none — swallow it here.
      onMouseDown={(e) => e.preventDefault()}
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
}: {
  dir: string;
  depth: number;
  p: FolderPanelProps;
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
          return (
            <div key={path}>
              <button
                className="folder-item folder-item-dir"
                data-testid="folder-item"
                data-path={path}
                style={{ '--mm-depth': `${10 + depth * 14}px` } as CSSProperties}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => p.onToggleDir(path)}
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
              {open && <Rows dir={path} depth={depth + 1} p={p} />}
            </div>
          );
        }
        return <FileRow key={path} path={path} name={e.name} depth={depth} p={p} />;
      })}
    </>
  );
}

export function FolderPanel(p: FolderPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
            p.openFiles.map((path) => <FileRow key={path} path={path} name={p.basename(path)} depth={null} p={p} />)
          )}
        </div>
      ) : p.root ? (
        <div className="folder-list" ref={listRef}>
          <Rows dir={p.root} depth={0} p={p} />
        </div>
      ) : (
        <div className="folder-empty">
          <button data-testid="folder-open-btn" onClick={p.onOpenFolder}>
            Open Folder…
          </button>
        </div>
      )}
      <div className="folder-divider" data-testid="folder-divider" onPointerDown={dragWidth} />
    </div>
  );
}
