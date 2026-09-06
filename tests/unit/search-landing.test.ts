import { describe, expect, test } from 'vitest';
import { compileQuery, findMatches, type LineMatch } from '@marky-mark/editor';
import { blockLineRange, blockOccurrenceIndex, rawMatchOffsets } from '../../src/lib/searchLanding';

/**
 * PRD 014 Req 8 (issue #313): landing a Search-view result on the text a
 * surface actually holds — the SPEC40-expanded editor document (a gridded
 * table is wider and taller than its source) and the preview's rendered
 * blocks (where a hit is located by its index among the block's occurrences).
 */

const matchOf = (lineText: string, needle: string, line = 1, nth = 0): LineMatch => {
  let start = lineText.indexOf(needle);
  for (let i = 0; i < nth; i++) start = lineText.indexOf(needle, start + 1);
  return { line, lineText, start, end: start + needle.length };
};

describe('PRD 014 Req 8 (issue #313): rawMatchOffsets — canonical match → raw editor offsets', () => {
  test('U1264: a line the grid did not touch is exact — the match offsets apply to the raw line as-is', () => {
    const m = matchOf('> quoted needleword five', 'needleword five', 5);
    expect(rawMatchOffsets([{ from: 120, text: '> quoted needleword five' }], m)).toEqual({ from: 129, to: 144 });
  });

  test('U1258: inside a gridded row the hit is re-found by text on the display row — the same occurrence, not the canonical offset', () => {
    const m = matchOf('| cell | needleword four |', 'needleword four', 3);
    const rows = [{ from: 40, text: '│ cell  │ needleword four │' }];
    expect(rawMatchOffsets(rows, m)).toEqual({ from: 40 + 10, to: 40 + 25 });
  });

  test('U1259: a repeated needle keeps its occurrence index across the re-layout — the second canonical hit is the second display hit', () => {
    const lineText = '| aa | aa |';
    const second = matchOf(lineText, 'aa', 3, 1);
    const rows = [{ from: 0, text: '│ aa    │ aa    │' }];
    expect(rawMatchOffsets(rows, second)).toEqual({ from: 10, to: 12 });
    const first = matchOf(lineText, 'aa', 3, 0);
    expect(rawMatchOffsets(rows, first)).toEqual({ from: 2, to: 4 });
  });

  test('U1260: a wrapped cell spreads the row over several display rows — the hit is found on whichever row carries it', () => {
    const m = matchOf('| short | long text needleword |', 'needleword', 3);
    const rows = [
      { from: 0, text: '│ short │ long text  │' },
      { from: 23, text: '│       │ needleword │' },
    ];
    expect(rawMatchOffsets(rows, m)).toEqual({ from: 23 + 10, to: 23 + 20 });
  });

  test('U1261: a hit the display rows cannot show (split mid-word by wrapping, or spanning a cell boundary) is null; no rows at all is null; an empty hit is a caret at the first row', () => {
    const split = matchOf('| a | needleword |', 'needleword', 3);
    const wrapped = [
      { from: 0, text: '│ a │ needle │' },
      { from: 15, text: '│   │ word   │' },
    ];
    expect(rawMatchOffsets(wrapped, split)).toBeNull();
    const spanning = matchOf('| cell | needle |', 'cell | needle', 3);
    expect(rawMatchOffsets([{ from: 0, text: '│ cell │ needle │' }], spanning)).toBeNull();
    expect(rawMatchOffsets([], split)).toBeNull();
    const empty: LineMatch = { line: 1, lineText: 'abc', start: 1, end: 1 };
    expect(rawMatchOffsets([{ from: 7, text: 'a b c' }], empty)).toEqual({ from: 7, to: 7 });
  });
});

describe('PRD 014 Req 8 (issue #313): blockLineRange / blockOccurrenceIndex — the preview block a match renders in', () => {
  test('U1262: the block is the nearest anchor at or above the line and spans to the next anchor; the last block runs to the end; before the first anchor is null', () => {
    const anchors = [1, 3, 7, 12];
    expect(blockLineRange(anchors, 5)).toEqual({ from: 3, to: 7 });
    expect(blockLineRange(anchors, 7)).toEqual({ from: 7, to: 12 });
    expect(blockLineRange(anchors, 40)).toEqual({ from: 12, to: Infinity });
    expect(blockLineRange([4, 9], 2)).toBeNull();
    expect(blockLineRange([], 2)).toBeNull();
  });

  test('U1263: the occurrence index counts only the file matches inside the block span, in document order — so a hit below a table is its block-relative ordinal, not its file ordinal', () => {
    const text = [
      'Intro needleword one.',
      '',
      '| col a | col b |',
      '| --- | --- |',
      '| cell | needleword four |',
      '',
      '> quoted needleword five',
      '',
      'Tail **needleword six** and needleword seven.',
    ].join('\n');
    const q = compileQuery('needleword', { caseSensitive: false, wholeWord: false, regex: false });
    if (q.kind !== 'matcher') throw new Error('query did not compile');
    const matches = findMatches(text, q.matcher);
    expect(matches).toHaveLength(5);
    // The anchors a render of that document carries: p, table, blockquote, p.
    const anchors = [1, 3, 7, 9];
    const rangeOf = (m: LineMatch) => blockLineRange(anchors, m.line)!;
    expect(blockOccurrenceIndex(matches, matches[0], rangeOf(matches[0]))).toBe(0);
    expect(blockOccurrenceIndex(matches, matches[1], rangeOf(matches[1]))).toBe(0); // the table's only hit
    expect(blockOccurrenceIndex(matches, matches[2], rangeOf(matches[2]))).toBe(0); // the quote's only hit
    expect(blockOccurrenceIndex(matches, matches[3], rangeOf(matches[3]))).toBe(0);
    expect(blockOccurrenceIndex(matches, matches[4], rangeOf(matches[4]))).toBe(1); // second hit of the tail block
    // Equality is by position, so a re-scanned copy of the match still resolves; a stranger is −1.
    expect(blockOccurrenceIndex(matches, { ...matches[4] }, rangeOf(matches[4]))).toBe(1);
    expect(blockOccurrenceIndex(matches, { line: 99, lineText: '', start: 0, end: 0 }, { from: 1, to: Infinity })).toBe(-1);
  });
});
