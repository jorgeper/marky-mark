import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Chevron, paneWidthDrag } from './FolderPanel';
import { slideClasses, type SlidePhase } from '../lib/paneSlide';
import type { FileSearchResult, LineMatch, SearchOptions, SearchResults } from '../lib/searchCore';
import { SEARCH_OPTION_TOGGLES, toggleSearchOption } from '../lib/searchOptions';

/**
 * PRD 014 Req 6 (issue #152): the three query toggles — case-sensitive,
 * whole-word, regex — as a reusable control: a `SearchOptions` value in, the
 * flipped value out, state owned by the caller. The find bar (#154) mounts
 * this same control, so it carries no sidebar assumptions (no width, slide or
 * result coupling) and no matching logic — every semantic lives in
 * `searchCore.ts`'s `compileQuery`. Same pressed-state idiom as
 * `SidebarViewSwitch` (aria-pressed, data-active, an accented `.on` state).
 */
export function SearchOptionsBar({
  options,
  onChange,
}: {
  options: SearchOptions;
  onChange(next: SearchOptions): void;
}) {
  return (
    <span className="search-options" data-testid="search-options">
      {SEARCH_OPTION_TOGGLES.map(({ key, label, testId, glyph }) => {
        const on = options[key];
        return (
          <button
            key={key}
            className={`search-opt${on ? ' on' : ''}`}
            data-testid={testId}
            data-active={on ? 'true' : 'false'}
            aria-pressed={on}
            title={label}
            aria-label={label}
            // The caret stays in the query box across a flip: the button takes
            // the click without taking focus, so typing continues uninterrupted.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(toggleSearchOption(options, key))}
          >
            {glyph}
          </button>
        );
      })}
    </span>
  );
}

/**
 * PRD 014 Reqs 2/4/7/8 (issue #151): the Search view of the sidebar — the
 * third, mutually exclusive occupant of the one pane (PRD 012), in the
 * `FolderPanel` / `TocPanel` mold: a pure view, results in, callbacks out.
 * Every match and every group order was decided by `src/lib/searchCore.ts`
 * and the scan by the owner (App) through `src/lib/searchScan.ts`; this file
 * contains no matching logic and touches no platform seam.
 *
 * It reuses the `.folder-*` treatment deliberately (PRD 012 Req 1): the three
 * views are one pane, so they share the slide, the width, the divider and the
 * row look.
 */
export interface SearchPanelProps {
  /** The live (undebounced) query the input shows — the owner debounces the scan. */
  query: string;
  /** PRD 014 Req 6: the toggle states — owned by App, compiled by `searchCore`. */
  options: SearchOptions;
  /**
   * PRD 014 Req 6: the invalid-regex message from `compileQuery`'s
   * `{ kind: 'invalid-regex' }` result, or null when the query compiles —
   * rendered inline on the query box, never invented here.
   */
  queryError: string | null;
  /**
   * PRD 014 Req 7: the grouped results for the last scanned query — null
   * while the query is empty (nothing to say yet; the loud no-results state
   * is issue #153's scope).
   */
  results: SearchResults | null;
  /** PRD 014 Req 4: no folder root open — the panel says so instead of an empty list. */
  noRoots: boolean;
  /** PRD 014 Req 7: the collapsed file groups (paths), per unchanged query. */
  collapsed: ReadonlySet<string>;
  /** PRD 014 Req 2: bumped by the Search button — focus the query box. */
  focusTick: number;
  /** PRD 003 Req 9: the shared pane's open/close slide phase (App owns timing). */
  slide: SlidePhase;
  /** PRD 012 Req 1: `settings.folderWidth` — one width for the one pane. */
  width: number;
  /** PRD 012 Req 9: the view switch, rendered at the head of the header. */
  viewSwitch?: ReactNode;
  onQuery(query: string): void;
  /** PRD 014 Req 6: a toggle flip — the owner re-runs the current query with the new state. */
  onOptions(next: SearchOptions): void;
  /** PRD 014 Req 7: the group's disclosure triangle — the owner flips the set. */
  onToggleFile(path: string): void;
  /**
   * PRD 014 Req 8: a result click — a match row carries its `LineMatch`, the
   * group header (the filename match surface) carries null. The owner opens
   * the file and lands on the match; the results stay.
   */
  onOpenMatch(path: string, match: LineMatch | null): void;
  onClose(): void;
  onWidth(width: number): void;
}

/**
 * PRD 014 Req 7: one match row — the line's text with the hit highlighted in
 * context via a real `<mark>`, offsets straight from the `LineMatch` (no
 * re-search here).
 */
function MatchRow({ path, match, onOpen }: { path: string; match: LineMatch; onOpen(path: string, match: LineMatch): void }) {
  return (
    <button
      className="folder-item search-match"
      data-testid="search-match"
      data-line={match.line}
      title={match.lineText}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onOpen(path, match)}
    >
      <span className="search-match-text">
        {match.lineText.slice(0, match.start)}
        <mark>{match.lineText.slice(match.start, match.end)}</mark>
        {match.lineText.slice(match.end)}
      </span>
    </button>
  );
}

/**
 * PRD 014 Reqs 7/8: one file group — a header row showing the file name and
 * its match count, then a row per match. The header's disclosure triangle is
 * the folder row's (same `Chevron`, same stopPropagation split as the TOC
 * rows), and clicking the header itself opens the file — which is what a
 * filename match's click means.
 */
function FileGroup({
  file,
  collapsed,
  onToggle,
  onOpen,
}: {
  file: FileSearchResult;
  collapsed: boolean;
  onToggle(path: string): void;
  onOpen(path: string, match: LineMatch | null): void;
}) {
  return (
    <div>
      <button
        className="folder-item search-file"
        data-testid="search-file"
        data-path={file.path}
        data-name-match={file.nameMatch ? 'true' : 'false'}
        title={file.path}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onOpen(file.path, null)}
      >
        {file.matches.length > 0 ? (
          <span
            className="search-twisty"
            data-testid="search-twisty"
            role="button"
            aria-label={collapsed ? `Expand ${file.name}` : `Collapse ${file.name}`}
            aria-expanded={!collapsed}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              // The row opens the file; only the triangle folds — the TOC
              // rows' split, so the header keeps the folder row's hit area.
              e.stopPropagation();
              onToggle(file.path);
            }}
          >
            <Chevron open={!collapsed} />
          </span>
        ) : (
          // A name-only hit has nothing to disclose; the slot stays reserved
          // so file names line up.
          <span className="search-twisty" aria-hidden="true" />
        )}
        <span className="search-file-name">{file.name}</span>
        <span className="search-file-count" data-testid="search-file-count">
          {file.matchCount}
        </span>
      </button>
      {!collapsed && file.matches.map((m, i) => <MatchRow key={i} path={file.path} match={m} onOpen={onOpen} />)}
    </div>
  );
}

export function SearchPanel(p: SearchPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // PRD 012 Req 1: the folder pane's own width drag — one pane, one
  // `settings.folderWidth`, so dragging in any view moves the same edge.
  const dragWidth = paneWidthDrag({ panelRef, slideRef, width: p.width, onWidth: p.onWidth });

  // PRD 014 Req 2: the Search button's press focuses the query box — a tick,
  // not an autofocus, so a session that merely RESTORES on the Search view
  // (tick still 0) steals no focus from the document.
  useEffect(() => {
    if (p.focusTick > 0) inputRef.current?.select();
  }, [p.focusTick]);

  const { sliding, out } = slideClasses(p.slide);
  return (
    <div
      className={`folder-slide${sliding ? ' sliding' : ''}${out ? ' out' : ''}`}
      ref={slideRef}
      style={{ '--mm-folders': `${p.width}px` } as CSSProperties}
    >
      <div className="folder-panel search-panel" data-testid="search-panel" ref={panelRef}>
        <div className="folder-header" data-testid="search-header">
          {p.viewSwitch}
          <span className="folder-title">Search</span>
          <button
            data-testid="search-collapse"
            title="Hide the sidebar"
            aria-label="Hide the sidebar"
            onClick={p.onClose}
          >
            <Chevron dir="left" />
          </button>
        </div>
        <div className="search-query-row">
          <input
            ref={inputRef}
            className="search-query"
            data-testid="search-input"
            type="text"
            placeholder="Search files"
            aria-label="Search files"
            spellCheck={false}
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
          />
          {/* PRD 014 Req 6: the toggles ride the query box they modify. */}
          <SearchOptionsBar options={p.options} onChange={p.onOptions} />
        </div>
        {/* PRD 014 Req 6: an invalid regex says so inline — compileQuery's own
            message — while the result list below stays empty. */}
        {p.queryError !== null && (
          <div className="search-error" data-testid="search-error" role="alert">
            {p.queryError}
          </div>
        )}
        {/* PRD 014 Req 4: no roots ⇒ say so plainly, never an empty result list. */}
        {p.noRoots ? (
          <div className="folder-open-empty" data-testid="search-no-roots">
            Open a folder to search its files
          </div>
        ) : (
          <div className="folder-list search-list">
            {p.results?.files.map((file) => (
              <FileGroup
                key={file.path}
                file={file}
                collapsed={p.collapsed.has(file.path)}
                onToggle={p.onToggleFile}
                onOpen={p.onOpenMatch}
              />
            ))}
          </div>
        )}
        <div className="folder-divider" data-testid="search-divider" onPointerDown={dragWidth} />
      </div>
    </div>
  );
}
