import { useRef, type CSSProperties, type ReactNode } from 'react';
import { Chevron, paneWidthDrag } from './FolderPanel';
import { slideClasses, type SlidePhase } from '../lib/paneSlide';
import type { VisibleTocEntry } from '../lib/tocModel';
import type { SidebarView } from '../lib/settings';

/**
 * PRD 012 Reqs 1–4: the Table of Contents view of the sidebar — the second,
 * mutually exclusive occupant of the one pane the folder tree already owns.
 * A pure view in the `FolderPanel` mold: rows in, callbacks out. Every rule it
 * draws (which rows are visible, which have children, which are collapsed) was
 * decided by `src/lib/tocModel.ts`; this file invents none of them and touches
 * no platform seam, which is why the view also renders in `file` mode and on
 * the web where the folder tree does not exist (Req 12).
 *
 * It reuses the `.folder-*` treatment deliberately (Req 1): the two views are
 * one pane, so they share the slide, the width, the divider and the row look.
 */
export interface TocPanelProps {
  /** PRD 012 Req 4: `visibleTocEntries()` output — the rows, already filtered. */
  rows: VisibleTocEntry[];
  /**
   * PRD 012 Req 7: the entry the viewport is currently in — `activeTocReveal`'s
   * answer, decided by `src/lib/tocModel.ts`. Null in the preamble and in a
   * heading-less document, and then no row claims to be active.
   */
  activeId: string | null;
  /** PRD 003 Req 9: the shared pane's open/close slide phase (App owns timing). */
  slide: SlidePhase;
  /** PRD 012 Req 1: `settings.folderWidth` — one width for the one pane. */
  width: number;
  /** PRD 012 Req 9: the Folders/TOC switch, rendered at the head of the header. */
  viewSwitch?: ReactNode;
  /** PRD 012 Req 4: the disclosure triangle — the owner flips the collapse set. */
  onToggle(id: string): void;
  /** PRD 012 Reqs 5–6: a row click — the owner navigates to this row's line. */
  onSelect(row: VisibleTocEntry): void;
  onClose(): void;
  onWidth(width: number): void;
}

/**
 * PRD 012 Req 4: one heading row. The disclosure triangle is the folder row's
 * — same `Chevron`, same click-to-toggle — and it occupies the slot even for a
 * childless heading so titles at one depth line up. Indent is `depth`, in the
 * `--mm-depth` variable `.folder-item` already reads.
 *
 * PRD 012 Req 3: the key and `data-toc-id` are the positional `SectionNode`
 * id, never the title, so two identically-titled headings stay two rows.
 *
 * PRD 012 Req 7: the active row says so with `aria-current="true"` and
 * `data-active` — "you are here", which is why it is `aria-current` and not the
 * folder row's `selected` (that one means "you picked this", and pairs with a
 * different treatment). At most one row carries it: the id comes from one
 * resolver call.
 */
function TocRow({
  row,
  active,
  onToggle,
  onSelect,
}: {
  row: VisibleTocEntry;
  active: boolean;
  onToggle(id: string): void;
  onSelect(row: VisibleTocEntry): void;
}) {
  const { entry, hasChildren, collapsed } = row;
  return (
    <button
      className={`folder-item toc-item${active ? ' toc-active' : ''}`}
      data-testid="toc-item"
      aria-current={active ? 'true' : undefined}
      data-active={active ? 'true' : 'false'}
      data-toc-id={entry.id}
      data-depth={entry.depth}
      data-line={entry.headingLine}
      title={entry.title}
      style={{ '--mm-depth': `${10 + (entry.depth - 1) * 14}px` } as CSSProperties}
      // Same guard as the folder rows: WebKit word-selects on fast repeated
      // clicks even under user-select:none.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onSelect(row)}
    >
      {hasChildren ? (
        <span
          className="toc-twisty"
          data-testid="toc-twisty"
          role="button"
          aria-label={collapsed ? `Expand ${entry.title}` : `Collapse ${entry.title}`}
          aria-expanded={!collapsed}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            // The row navigates; only the triangle folds. Both live on one
            // button so the row keeps the folder row's hit area and styling.
            e.stopPropagation();
            onToggle(entry.id);
          }}
        >
          <Chevron open={!collapsed} />
        </span>
      ) : (
        // The slot stays reserved so titles at one depth line up whether or
        // not the heading has children.
        <span className="toc-twisty" aria-hidden="true" />
      )}
      <span className="toc-label">{entry.title}</span>
    </button>
  );
}

export function TocPanel(p: TocPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);

  // PRD 012 Req 1: the folder pane's own width drag — one pane, one
  // `settings.folderWidth`, so dragging in either view moves the same edge.
  const dragWidth = paneWidthDrag({ panelRef, slideRef, width: p.width, onWidth: p.onWidth });

  const { sliding, out } = slideClasses(p.slide);
  return (
    <div
      className={`folder-slide${sliding ? ' sliding' : ''}${out ? ' out' : ''}`}
      ref={slideRef}
      style={{ '--mm-folders': `${p.width}px` } as CSSProperties}
    >
      <div className="folder-panel toc-panel" data-testid="toc-panel" ref={panelRef}>
        <div className="folder-header" data-testid="toc-header">
          {p.viewSwitch}
          <span className="folder-title">Contents</span>
          <button
            data-testid="toc-collapse"
            title="Hide the sidebar"
            aria-label="Hide the sidebar"
            onClick={p.onClose}
          >
            <Chevron dir="left" />
          </button>
        </div>
        {/* PRD 012 Req 8: a document with no headings says so — a blank pane
            reads as a bug, and "no headings yet" is the true statement. */}
        {p.rows.length === 0 ? (
          <div className="folder-open-empty" data-testid="toc-empty">
            No headings in this document
          </div>
        ) : (
          <div className="folder-list toc-list">
            {p.rows.map((row) => (
              <TocRow
                key={row.entry.id}
                row={row}
                active={row.entry.id === p.activeId}
                onToggle={p.onToggle}
                onSelect={p.onSelect}
              />
            ))}
          </div>
        )}
        <div className="folder-divider" data-testid="toc-divider" onPointerDown={dragWidth} />
      </div>
    </div>
  );
}

/**
 * PRD 012 Req 9: the two-button switch that says which view the one pane is
 * showing and puts either one on screen. It renders in exactly one place at a
 * time — inside whichever panel header is up, or in the closed pane's edge
 * cluster — so a test's `getByTestId` always resolves to one button.
 *
 * Each button is its own toggle: pressing the view that is already showing
 * hides the sidebar, pressing the other one switches to it (opening the
 * sidebar if it was closed). `aria-pressed` and `data-active` carry which is
 * live; the owner decides all of it, this only reports the clicks.
 */
export function SidebarViewSwitch({
  active,
  folders,
  toc,
  onFolders,
  onToc,
}: {
  /** The view on screen, or null while the sidebar is hidden. */
  active: SidebarView | null;
  /** Whether the folders button exists at all (the folder seam, Req 12). */
  folders: boolean;
  /** Whether the TOC button exists at all (a document is open, Req 12). */
  toc: boolean;
  onFolders(): void;
  onToc(): void;
}) {
  return (
    <span className="sidebar-switch" data-testid="sidebar-switch">
      {folders && (
        <button
          className={`sidebar-switch-btn${active === 'folders' ? ' on' : ''}`}
          data-testid="sidebar-view-folders"
          data-active={active === 'folders' ? 'true' : 'false'}
          aria-pressed={active === 'folders'}
          title={active === 'folders' ? 'Hide the sidebar' : 'Show the folders'}
          aria-label={active === 'folders' ? 'Hide the sidebar' : 'Show the folders'}
          onClick={onFolders}
        >
          {/* A folder tab. */}
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <g stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12.4V4.2a1 1 0 0 1 1-1h3.1l1.6 1.8H13a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" />
            </g>
          </svg>
        </button>
      )}
      {toc && (
        <button
          className={`sidebar-switch-btn${active === 'toc' ? ' on' : ''}`}
          data-testid="sidebar-view-toc"
          data-active={active === 'toc' ? 'true' : 'false'}
          aria-pressed={active === 'toc'}
          title={active === 'toc' ? 'Hide the sidebar' : 'Show the table of contents'}
          aria-label={active === 'toc' ? 'Hide the sidebar' : 'Show the table of contents'}
          onClick={onToc}
        >
          {/* An indented list — the heading tree. */}
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <g stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round">
              <line x1="2.4" y1="3.6" x2="13.6" y2="3.6" />
              <line x1="5.4" y1="6.9" x2="13.6" y2="6.9" />
              <line x1="5.4" y1="10.1" x2="13.6" y2="10.1" />
              <line x1="2.4" y1="13.4" x2="13.6" y2="13.4" />
            </g>
          </svg>
        </button>
      )}
    </span>
  );
}
