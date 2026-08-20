/**
 * PRD 014 Req 9 (issue #153): what the Search panel says about a scan — the
 * settle-state machine (idle / error / scanning / no-results / results), the
 * totals line and the loud no-results message — derived as a pure function of
 * plain inputs. App wires it; neither App nor the panel re-derives, re-counts
 * or re-sums any of it, and the mutual exclusions (the no-results block never
 * beside the invalid-regex error, never while a scan is in flight) are
 * decided here where a unit test can pin them.
 */

import type { SearchResults } from './searchCore';

export type SearchViewState = 'idle' | 'error' | 'scanning' | 'no-results' | 'results';

export interface SearchViewInput {
  /** The DEBOUNCED query — the one the displayed results answer to. */
  query: string;
  /** True when `compileQuery` reported an invalid regex. */
  error: boolean;
  /** True while a scan of the current (query, options) is in flight. */
  scanning: boolean;
  /** The last COMPLETED scan's results — never a superseded run's. */
  results: SearchResults | null;
}

export interface SearchViewModel {
  state: SearchViewState;
  /** Show the scanning indicator. Cleared by every settle path via `state`. */
  scanning: boolean;
  /**
   * The totals line, or null when there is nothing to total. Always labels
   * the result set on screen — during a rescan the previous set stays up
   * beside the indicator, so its (old) totals stay with it; a new query's
   * numbers can only arrive with the new query's results.
   */
  totals: string | null;
  /**
   * The query the loud no-results block names, or null when it must not show:
   * exactly when the query is non-empty, compiles, the scan has settled and
   * zero files matched.
   */
  noResultsFor: string | null;
}

/**
 * PRD 014 Req 9: both numbers, grammatical at 1 — `1 match in 1 file`, never
 * `1 files`. A name-only hit is a real result with 0 content matches, so
 * `0 matches in 1 file` is truthful and stays.
 */
export function searchTotalsLabel(results: SearchResults): string {
  const files = results.fileCount === 1 ? '1 file' : `${results.fileCount} files`;
  const matches = results.matchCount === 1 ? '1 match' : `${results.matchCount} matches`;
  return `${matches} in ${files}`;
}

/** PRD 014 Req 9: the one derivation of everything the panel reports. */
export function deriveSearchView(input: SearchViewInput): SearchViewModel {
  const state: SearchViewState =
    input.query === ''
      ? 'idle' // an emptied query settles instantly — indicator and totals both drop
      : input.error
        ? 'error' // the inline search-error owns this state; nothing else shows
        : input.scanning
          ? 'scanning'
          : input.results === null
            ? 'idle' // nothing scanned yet (no seam, view never opened) — say nothing
            : input.results.fileCount === 0
              ? 'no-results'
              : 'results';
  const showTotals =
    (state === 'results' || state === 'scanning') && input.results !== null && input.results.fileCount > 0;
  return {
    state,
    scanning: state === 'scanning',
    totals: showTotals ? searchTotalsLabel(input.results as SearchResults) : null,
    noResultsFor: state === 'no-results' ? input.query : null,
  };
}
