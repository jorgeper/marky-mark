import { useEffect, useRef, type CSSProperties } from 'react';
import { isMarkdownFile, type DirEntry } from '../lib/folderTree';
import { FOLDER_WIDTH_MAX, FOLDER_WIDTH_MIN } from '../lib/settings';

/**
 * SPEC34 §3: the folder sidebar — pure view. The owner (App) holds the
 * root, the expanded set, the per-directory listings, and all I/O; this
 * component renders rows, forwards clicks, and runs the width drag with
 * the split-divider pointer-capture pattern (live CSS variable, one
 * persisted commit on release).
 */

export interface FolderPanelProps {
  root: string | null;
  /** Directory path → its (visible, sorted) children; missing = not loaded. */
  children: Record<string, DirEntry[]>;
  expanded: Set<string>;
  /** The open document's path (row gets `selected`); null clears. */
  selectedPath: string | null;
  width: number;
  join(...parts: string[]): string;
  basename(path: string): string;
  onToggleDir(path: string): void;
  onOpenFile(path: string): void;
  onOpenFolder(): void;
  onSync(): void;
  onClose(): void;
  onWidth(width: number): void;
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
  const entries = p.children[dir];
  if (!entries) return null;
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
        const md = isMarkdownFile(e.name);
        return (
          <button
            key={path}
            className={`folder-item${md ? '' : ' folder-item-dim'}${p.selectedPath === path ? ' selected' : ''}`}
            data-testid="folder-item"
            data-path={path}
            style={{ '--mm-depth': `${10 + depth * 14}px` } as CSSProperties}
            disabled={!md}
            onClick={md ? () => p.onOpenFile(path) : undefined}
          >
            <span className="folder-glyph">{md ? '#' : '·'}</span>
            {e.name}
          </button>
        );
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
  }, [p.selectedPath, p.expanded, p.children]);

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
          data-testid="folder-sync"
          title="Reveal the current document"
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
        <button data-testid="folder-close" title="Hide folders" onClick={p.onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <line x1="4.4" y1="4.4" x2="11.6" y2="11.6" />
              <line x1="11.6" y1="4.4" x2="4.4" y2="11.6" />
            </g>
          </svg>
        </button>
      </div>
      {p.root ? (
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
