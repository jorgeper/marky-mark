import { describe, expect, test } from 'vitest';
import { fuzzyFilter } from '../../src/lib/fuzzy';

const id = (s: string) => s;

describe('SPEC16 fuzzy filter', () => {
  test('U32: subsequence matching, word-start ranking, case-insensitivity, empty query, exclusion', () => {
    // Empty query preserves order.
    expect(fuzzyFilter('', ['b', 'a', 'c'], id)).toEqual(['b', 'a', 'c']);

    // Case-insensitive subsequence.
    expect(fuzzyFilter('wc', ['Word Count', 'watch'], id)).toContain('Word Count');
    expect(fuzzyFilter('WC', ['word count'], id)).toEqual(['word count']);

    // Word-start matches rank above scattered mid-word matches.
    const ranked = fuzzyFilter('wc', ['awkward chorus', 'Word Count'], id);
    expect(ranked[0]).toBe('Word Count');

    // Non-matches are excluded entirely.
    expect(fuzzyFilter('zzz', ['alpha', 'beta'], id)).toEqual([]);

    // Consecutive runs beat scattered letters.
    const run = fuzzyFilter('the', ['t h e scattered', 'Themes'], id);
    expect(run[0]).toBe('Themes');
  });
});
