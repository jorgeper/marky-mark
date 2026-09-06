import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Chevron, paneWidthDrag } from './FolderPanel';
import { slideClasses, type SlidePhase } from '../lib/paneSlide';
import { IconButton } from './ui/IconButton';
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
  /**
   * PRD 012 Req 4 (issue #255): the header's search toggle is pressed — the box
   * is open. Session state owned by `src/App.tsx`; this view only reports the
   * clicks, exactly as it does for the collapse set.
   */
  searchOpen: boolean;
  /** PRD 012 Req 4 (issue #255): the live query the box shows (`''` while closed). */
  searchQuery: string;
  /** PRD 012 Req 4: the disclosure triangle — the owner flips the collapse set. */
  onToggle(id: string): void;
  /** PRD 012 Reqs 5–6: a row click — the owner navigates to this row's line. */
  onSelect(row: VisibleTocEntry): void;
  /** PRD 012 Req 4 (issue #255): the header toggle — the owner flips it open/closed. */
  onSearchToggle(): void;
  /** PRD 012 Req 4 (issue #255): a keystroke in the box — the owner holds the query. */
  onSearchQuery(query: string): void;
  /** PRD 012 Req 4 (issue #255): Esc in the box — the owner closes it and clears the query. */
  onSearchClose(): void;
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
      className={`folder-item btn-quiet toc-item${active ? ' toc-active' : ''}`}
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

/**
 * The sidebar's search glyph, drawn once: the TOC header's heading-search
 * toggle and the view switch's Search button name the same verb, so they show
 * the same icon.
 */
function Magnifier() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round">
        <circle cx="7" cy="7" r="4.2" />
        <line x1="10.2" y1="10.2" x2="13.6" y2="13.6" />
      </g>
    </svg>
  );
}

export function TocPanel(p: TocPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // PRD 012 Req 4 (issue #255): opening the box puts the caret in it — the
  // palette's one genuinely good habit, kept. It fires on the OPEN edge only,
  // so a re-render while the reader types (a new row set, a scroll) never
  // re-grabs focus.
  useEffect(() => {
    if (p.searchOpen) searchRef.current?.focus();
  }, [p.searchOpen]);

  // PRD 012 Req 1: the folder pane's own width drag — one pane, one
  // `settings.folderWidth`, so dragging in either view moves the same edge.
  const dragWidth = paneWidthDrag({ panelRef, slideRef, width: p.width, onWidth: p.onWidth });

  /* PRD 012 Req 8: a document with no headings says so — a blank pane reads as
     a bug, and "no headings yet" is the true statement. Issue #255: a live
     query that matched nothing gets the same treatment with its own true
     statement, so "you filtered everything out" never reads as "this document
     has no headings". */
  const emptyState =
    p.searchOpen && p.searchQuery.trim() !== '' ? (
      <div className="folder-open-empty" data-testid="toc-search-empty">
        No headings match “{p.searchQuery}”
      </div>
    ) : (
      <div className="folder-open-empty" data-testid="toc-empty">
        No headings in this document
      </div>
    );

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
          {/* PRD 012 Req 4 (issue #255): the search toggle — a header button of
              the TOC pane, so it exists only where the heading list does and
              never joins the three-member view switch. Pressed state is the
              sidebar's shared idiom (aria-pressed + data-active + the
              `.icon-btn.on` accent), and the title is a constant: it says what
              the button searches, never "hide". */}
          <IconButton
            className={p.searchOpen ? 'on' : undefined}
            data-testid="toc-search-toggle"
            data-active={p.searchOpen ? 'true' : 'false'}
            aria-pressed={p.searchOpen}
            title="Search headings"
            aria-label="Search headings"
            onClick={p.onSearchToggle}
          >
            <Magnifier />
          </IconButton>
          <IconButton
            data-testid="toc-collapse"
            title="Hide sidebar"
            aria-label="Hide sidebar"
            onClick={p.onClose}
          >
            <Chevron dir="left" />
          </IconButton>
        </div>
        {/* PRD 012 Req 4 (issue #255): the query box, between the header and the
            list — the `SearchPanel` query-row treatment (a `.field` primitive in
            a flex row), because it is the same control doing the same job one
            view over. Enter jumps the top-ranked match, which is the ranking
            `p.rows` already arrived in; Esc closes and clears. Neither key
            dismisses the pane: this is a filter, not a modal. */}
        {p.searchOpen && (
          <div className="toc-search-row">
            <input
              ref={searchRef}
              className="field toc-search-input"
              data-testid="toc-search-input"
              type="text"
              placeholder="Filter headings"
              aria-label="Filter headings"
              spellCheck={false}
              value={p.searchQuery}
              onChange={(e) => p.onSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  p.onSearchClose();
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const top = p.rows[0];
                  if (top) p.onSelect(top);
                }
              }}
            />
          </div>
        )}
        {p.rows.length === 0 ? (
          emptyState
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
 * PRD 012 Req 9 (amended by issue #257): the switch that says which view the
 * one pane is showing and puts any of them on screen. It renders inside
 * whichever panel header is up, and NOWHERE while the sidebar is hidden —
 * these buttons only choose what is inside the sidebar, so a test's
 * `getByTestId` resolves to one button while it shows and to none while it
 * does not.
 *
 * Issue #257: the buttons are stateless mode switches. Each tooltip is a
 * constant — it never turns into "hide" for the live view — and pressing the
 * button whose view is already showing does nothing at all; hiding belongs to
 * the header's Hide sidebar chevron, the View ▸ Sidebar row and the hotkeys.
 * `aria-pressed`, `data-active` and `.on` still mark the live view; the owner
 * decides all of it, this only reports the clicks.
 *
 * PRD 014 Req 2: the Search button is the third member, with the same
 * semantics and its own stable testid.
 */
export function SidebarViewSwitch({
  active,
  folders,
  toc,
  search,
  onFolders,
  onToc,
  onSearch,
}: {
  /** The view on screen (the switch is unmounted while the sidebar is not). */
  active: SidebarView;
  /** Whether the folders button exists at all (the folder seam, Req 12). */
  folders: boolean;
  /** Whether the TOC button exists at all (a document is open, Req 12). */
  toc: boolean;
  /** Whether the Search button exists at all (the folder seam — PRD 014 Req 4's scope). */
  search: boolean;
  onFolders(): void;
  onToc(): void;
  onSearch(): void;
}) {
  return (
    <span className="sidebar-switch" data-testid="sidebar-switch">
      {folders && (
        <IconButton
          className={`sidebar-switch-btn${active === 'folders' ? ' on' : ''}`}
          data-testid="sidebar-view-folders"
          data-active={active === 'folders' ? 'true' : 'false'}
          aria-pressed={active === 'folders'}
          title="Show workspace files"
          aria-label="Show workspace files"
          onClick={onFolders}
        >
          {/* A folder tab. */}
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <g stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12.4V4.2a1 1 0 0 1 1-1h3.1l1.6 1.8H13a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" />
            </g>
          </svg>
        </IconButton>
      )}
      {toc && (
        <IconButton
          className={`sidebar-switch-btn${active === 'toc' ? ' on' : ''}`}
          data-testid="sidebar-view-toc"
          data-active={active === 'toc' ? 'true' : 'false'}
          aria-pressed={active === 'toc'}
          title="Show the table of contents"
          aria-label="Show the table of contents"
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
        </IconButton>
      )}
      {search && (
        <IconButton
          className={`sidebar-switch-btn${active === 'search' ? ' on' : ''}`}
          data-testid="sidebar-view-search"
          data-active={active === 'search' ? 'true' : 'false'}
          aria-pressed={active === 'search'}
          title="Search in workspace"
          aria-label="Search in workspace"
          onClick={onSearch}
        >
          <Magnifier />
        </IconButton>
      )}
    </span>
  );
}
