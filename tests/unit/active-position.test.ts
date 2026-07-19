import { describe, expect, test } from 'vitest';
import { blockLineFor, wordAt } from '../../src/lib/activePosition';
import { countNormalized, findNormalized, findNormalizedNth, sourceRangeForVisibleMatch } from '../../src/lib/selectionMap';

describe('SPEC44 active position', () => {
  test('U76: wordAt affinity & Unicode, blockLineFor, nth-occurrence mapping both directions', () => {
    const t = 'hello wörld_9 x';
    // Interior, start, end (left affinity at the boundary just past a word).
    expect(wordAt(t, 2)).toEqual({ start: 0, end: 5 });
    expect(wordAt(t, 0)).toEqual({ start: 0, end: 5 });
    expect(wordAt(t, 5)).toEqual({ start: 0, end: 5 });
    // Unicode letters, digits, underscore are one word.
    expect(wordAt(t, 8)).toEqual({ start: 6, end: 13 });
    // Whitespace/punctuation runs and empty text yield null.
    expect(wordAt('a  b', 2)).toBeNull();
    expect(wordAt('...', 1)).toBeNull();
    expect(wordAt('', 0)).toBeNull();
    // Clamped offsets still resolve (caret at doc end on a word).
    expect(wordAt('end', 99)).toEqual({ start: 0, end: 3 });

    // blockLineFor: between anchors, exact hit, before-first, after-last.
    expect(blockLineFor([1, 5, 9], 7)).toBe(5);
    expect(blockLineFor([1, 5, 9], 5)).toBe(5);
    expect(blockLineFor([3, 5], 2)).toBeNull();
    expect(blockLineFor([1, 5], 40)).toBe(5);
    expect(blockLineFor([], 3)).toBeNull();

    // Normalized occurrence counting matches on both sides of the mirror.
    expect(countNormalized('the cat category cat', 'cat')).toBe(3); // incl. "category"
    expect(countNormalized('a  b\n c', 'b c')).toBe(1);
    expect(countNormalized('', 'x')).toBe(0);
    // findNormalized stays ambiguity-shy; the nth variant is not.
    expect(findNormalized('cat cat', 'cat')).toBeNull();
    expect(findNormalizedNth('cat cat', 'cat', 1)).toEqual({ start: 4, end: 7 });
    expect(findNormalizedNth('cat cat', 'cat', 2)).toBeNull();

    // Source mapping of the nth visible occurrence, markup stripped.
    const src = 'intro\n\nthe **cat** sat, cat too\n';
    expect(sourceRangeForVisibleMatch(src, 3, 3, 'cat', 0)).toEqual({ from: 13, to: 16 });
    expect(sourceRangeForVisibleMatch(src, 3, 3, 'cat', 1)).toEqual({ from: 24, to: 27 });
    expect(sourceRangeForVisibleMatch(src, 3, 3, 'cat', 2)).toBeNull();
    expect(sourceRangeForVisibleMatch(src, 1, 3, 'intro', 0)).toEqual({ from: 0, to: 5 });
  });
});
