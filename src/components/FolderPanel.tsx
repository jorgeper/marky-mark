import { useEffect, useRef } from 'react';
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
                style={{ paddingLeft: 10 + depth * 14 }}
                onClick={() => p.onToggleDir(path)}
              >
                <span className="folder-chevron">{open ? '▾' : '▸'}</span>
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
            style={{ paddingLeft: 10 + depth * 14 }}
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
    const el = listRef.current?.querySelector(`[data-path="${CSS.escape(p.selectedPath)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
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
          ⌖
        </button>
        <button data-testid="folder-close" title="Hide folders" onClick={p.onClose}>
          ×
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
