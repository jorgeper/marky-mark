import { describe, expect, test } from 'vitest';
import type { SearchResults } from '../../src/lib/searchCore';
import { deriveSearchView, searchTotalsLabel } from '../../src/lib/searchView';

/**
 * PRD 014 Req 9 (issue #153): the Search panel's settle-state derivation —
 * the one place that decides when the scanning indicator, the totals line and
 * the loud no-results block show, and pins their mutual exclusions.
 */

const results = (fileCount: number, matchCount: number): SearchResults => ({
  files: [],
  fileCount,
  matchCount,
});

describe('PRD 014 Req 9: deriveSearchView — the settle-state machine', () => {
  test('U710: precedence — empty query is idle over everything, error owns its state, scanning owns in-flight', () => {
    // An emptied query settles instantly: no indicator, no totals, no block,
    // whatever a still-resolving scan or stale results might say.
    const emptied = deriveSearchView({ query: '', error: false, scanning: true, results: results(3, 5) });
    expect(emptied).toEqual({ state: 'idle', scanning: false, totals: null, noResultsFor: null });

    // An invalid regex is the search-error's state alone — never the
    // no-results block, never the indicator, even with stale results around.
    const invalid = deriveSearchView({ query: '[x', error: true, scanning: true, results: results(0, 0) });
    expect(invalid).toEqual({ state: 'error', scanning: false, totals: null, noResultsFor: null });

    // In flight: the indicator shows; the no-results block must NOT.
    const inFlight = deriveSearchView({ query: 'cat', error: false, scanning: true, results: null });
    expect(inFlight.state).toBe('scanning');
    expect(inFlight.scanning).toBe(true);
    expect(inFlight.noResultsFor).toBeNull();

    // Nothing scanned yet (no seam, view never opened): plain idle.
    const unstarted = deriveSearchView({ query: 'cat', error: false, scanning: false, results: null });
    expect(unstarted).toEqual({ state: 'idle', scanning: false, totals: null, noResultsFor: null });
  });

  test('U711: totals — both numbers, grammatical at 1, absent when there is nothing to total', () => {
    expect(searchTotalsLabel(results(1, 1))).toBe('1 match in 1 file');
    expect(searchTotalsLabel(results(2, 5))).toBe('5 matches in 2 files');
    // A name-only hit is a real result with 0 content matches.
    expect(searchTotalsLabel(results(1, 0))).toBe('0 matches in 1 file');

    const settled = deriveSearchView({ query: 'cat', error: false, scanning: false, results: results(2, 5) });
    expect(settled.state).toBe('results');
    expect(settled.totals).toBe('5 matches in 2 files');

    // A rescan keeps the PREVIOUS set on screen beside the indicator — its
    // own totals stay with it, so stale results are never labelled with the
    // new query's numbers (those can only arrive with the new results).
    const rescanning = deriveSearchView({ query: 'ca', error: false, scanning: true, results: results(2, 5) });
    expect(rescanning.totals).toBe('5 matches in 2 files');
    expect(rescanning.scanning).toBe(true);

    // Nothing to total: the zero result (the no-results state) and idle.
    expect(deriveSearchView({ query: 'cat', error: false, scanning: false, results: results(0, 0) }).totals).toBeNull();
    expect(deriveSearchView({ query: '', error: false, scanning: false, results: null }).totals).toBeNull();
  });

  test('U712: the no-results block shows exactly when a non-empty, compiling query settled on zero files', () => {
    const settledEmpty = deriveSearchView({ query: 'xyzzy', error: false, scanning: false, results: results(0, 0) });
    expect(settledEmpty.state).toBe('no-results');
    expect(settledEmpty.noResultsFor).toBe('xyzzy'); // the message names the query
    expect(settledEmpty.totals).toBeNull();
    expect(settledEmpty.scanning).toBe(false);

    // NOT while in flight, NOT on an error, NOT on an empty query.
    expect(deriveSearchView({ query: 'xyzzy', error: false, scanning: true, results: results(0, 0) }).noResultsFor).toBeNull();
    expect(deriveSearchView({ query: '[x', error: true, scanning: false, results: results(0, 0) }).noResultsFor).toBeNull();
    expect(deriveSearchView({ query: '', error: false, scanning: false, results: results(0, 0) }).noResultsFor).toBeNull();
  });
});
