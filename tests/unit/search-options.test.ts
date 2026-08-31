import { describe, expect, test } from 'vitest';
import { compileQuery } from '../../src/lib/searchCore';
import { DEFAULT_SEARCH_OPTIONS, SEARCH_OPTION_TOGGLES, toggleSearchOption } from '../../src/lib/searchOptions';

/**
 * PRD 014 Req 6 (issue #152): the option STATE behind the search toggles —
 * the default, the flip, and the descriptor list the toggle surfaces render
 * from. Matching semantics live in search-core.test.ts; nothing here matches.
 */

describe('PRD 014 Req 6 — search option state', () => {
  test('U921: the default state is all off — a case-insensitive literal substring query', () => {
    expect(DEFAULT_SEARCH_OPTIONS).toEqual({ caseSensitive: false, wholeWord: false, regex: false });
    // And the default state feeds compileQuery unchanged: today's behaviour.
    const compiled = compileQuery('CAT', DEFAULT_SEARCH_OPTIONS);
    if (compiled.kind !== 'matcher') throw new Error('default options can never be invalid');
    expect(compiled.matcher.test('concatenate')).toBe(true);
  });

  test('U922: flipping one option leaves the other two alone, and flips back cleanly', () => {
    const one = toggleSearchOption(DEFAULT_SEARCH_OPTIONS, 'wholeWord');
    expect(one).toEqual({ caseSensitive: false, wholeWord: true, regex: false });
    const two = toggleSearchOption(one, 'regex');
    expect(two).toEqual({ caseSensitive: false, wholeWord: true, regex: true });
    expect(toggleSearchOption(two, 'wholeWord')).toEqual({ caseSensitive: false, wholeWord: false, regex: true });
  });

  test('U704: the flip is pure — the input state is not mutated', () => {
    const before = { ...DEFAULT_SEARCH_OPTIONS };
    toggleSearchOption(DEFAULT_SEARCH_OPTIONS, 'caseSensitive');
    expect(DEFAULT_SEARCH_OPTIONS).toEqual(before);
  });

  test('U705: the descriptor list covers each option exactly once, with stable hooks and names', () => {
    expect(SEARCH_OPTION_TOGGLES.map((t) => t.key)).toEqual(['caseSensitive', 'wholeWord', 'regex']);
    for (const t of SEARCH_OPTION_TOGGLES) {
      expect(t.testId).toMatch(/^search-opt-/);
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.glyph.length).toBeGreaterThan(0);
    }
    // The testids are the e2e contract — pinned so they cannot drift.
    expect(SEARCH_OPTION_TOGGLES.map((t) => t.testId)).toEqual([
      'search-opt-case',
      'search-opt-word',
      'search-opt-regex',
    ]);
  });
});
