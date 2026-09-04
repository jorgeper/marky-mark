/**
 * PRD 014 Req 6 (issue #152): the option-state side of the search toggles —
 * the default all-off state, the one flip operation, and the descriptor list
 * both toggle surfaces (the Search sidebar view here, the find bar in #154)
 * render from. `SearchOptions` itself lives in `searchCore.ts` and is the
 * single option shape; this module only produces values of it and never
 * compiles or matches anything.
 */

import type { SearchOptions } from '@marky-mark/editor';

/** PRD 014 Req 6: all off = today's case-insensitive literal substring. */
export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

/**
 * PRD 014 Req 6: flip one option, leaving the other two alone — the options
 * combine, so a flip never resets its siblings. Pure: the input is untouched.
 */
export function toggleSearchOption(options: SearchOptions, key: keyof SearchOptions): SearchOptions {
  return { ...options, [key]: !options[key] };
}

/** One toggle's rendering contract: which option it flips, and its stable UI hooks. */
export interface SearchOptionToggle {
  key: keyof SearchOptions;
  /** The accessible name (aria-label and title). */
  label: string;
  /** The stable e2e hook. */
  testId: string;
  /** The compact glyph the button shows. */
  glyph: string;
}

/**
 * PRD 014 Req 6: the three toggles, in the order every surface shows them —
 * case-sensitive, whole-word, regex — so the control reads the same wherever
 * it is mounted.
 */
export const SEARCH_OPTION_TOGGLES: readonly SearchOptionToggle[] = [
  { key: 'caseSensitive', label: 'Match case', testId: 'search-opt-case', glyph: 'Aa' },
  { key: 'wholeWord', label: 'Whole word', testId: 'search-opt-word', glyph: 'ab' },
  { key: 'regex', label: 'Regular expression', testId: 'search-opt-regex', glyph: '.*' },
];
