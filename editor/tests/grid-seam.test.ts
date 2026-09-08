import { describe, expect, test } from 'vitest';
import { spanGeometry, type SpanGeometry } from '../src/lib/gridOffsets';
import { IDENTITY_SEAM, gridSeam } from '../src/lib/gridSeam';
import { layoutTable, parseTable } from '../src/lib/tableEdit';

/**
 * SPEC40 §2 (issue #357): two tables — the second with a cell that wraps at
 * the layout width — above prose. The canonical text is what the app
 * addresses; the display text is what the editor shows.
 */
const INTRO = '# Top\n\nintro\n\n';
const T1 = '| Name | Detail |\n| --- | --- |\n| alpha | one |\n| beta | two |';
const MID = '\n\nmiddle paragraph\n\n';
const T2 = '| Key | Value |\n| --- | --- |\n| zq | quick brown fox jumps over |\n| b | short |';
const OUTRO = '\n\n## Tail\n\nbottom prose here';
const CANON = INTRO + T1 + MID + T2 + OUTRO;

function grid(table: string, width: number): string {
  return layoutTable(parseTable(table, { start: 0, end: table.length }), width).text;
}

function build(width = 24): { raw: string; geoms: SpanGeometry[]; d1: string; d2: string } {
  const d1 = grid(T1, width);
  const d2 = grid(T2, width);
  const raw = INTRO + d1 + MID + d2 + OUTRO;
  const s1 = { from: INTRO.length, to: INTRO.length + d1.length };
  const s2 = { from: s1.to + MID.length, to: s1.to + MID.length + d2.length };
  const geoms = [
    spanGeometry(raw, s1, T1, INTRO.length, width),
    spanGeometry(raw, s2, T2, INTRO.length + T1.length + MID.length, width),
  ];
  return { raw, geoms, d1, d2 };
}

const lineOf = (text: string, needle: string): number => {
  const i = text.split('\n').findIndex((l) => l.includes(needle));
  expect(i).toBeGreaterThanOrEqual(0);
  return i + 1;
};

describe('SPEC40 §2 canonical ↔ display seam (issue #357)', () => {
  test('U1371: with no span tracked the seam is the frozen identity — the same object every time, no allocation', () => {
    const seam = gridSeam('plain text\n\n| a | b |\n| --- | --- |\n| 1 | 2 |', []);
    expect(seam).toBe(IDENTITY_SEAM);
    expect(Object.isFrozen(seam)).toBe(true);
    for (const n of [0, 7, 12.5, 999]) {
      expect(seam.canonicalToDisplay(n)).toBe(n);
      expect(seam.displayToCanonical(n)).toBe(n);
      expect(seam.canonicalLineToDisplay(n)).toBe(n);
      expect(seam.displayLineToCanonical(n)).toBe(n);
    }
  });

  test('U1372: offsets before the first grid are identity, after one grid shift by its delta, after two by both — both directions', () => {
    const { raw, geoms, d1, d2 } = build();
    const seam = gridSeam(raw, geoms);
    expect(geoms.every((g) => g.display !== null)).toBe(true);
    const delta1 = d1.length - T1.length;
    const delta2 = d2.length - T2.length;
    expect(delta1).toBeGreaterThan(0);
    expect(delta2).toBeGreaterThan(delta1); // the wrapped row adds more
    const intro = CANON.indexOf('intro');
    expect(seam.canonicalToDisplay(intro)).toBe(intro);
    expect(seam.displayToCanonical(intro)).toBe(intro);
    const mid = CANON.indexOf('middle');
    expect(seam.canonicalToDisplay(mid)).toBe(mid + delta1);
    expect(raw.slice(seam.canonicalToDisplay(mid), seam.canonicalToDisplay(mid) + 6)).toBe('middle');
    expect(seam.displayToCanonical(raw.indexOf('middle'))).toBe(mid);
    const bottom = CANON.indexOf('bottom prose');
    expect(seam.canonicalToDisplay(bottom)).toBe(bottom + delta1 + delta2);
    expect(seam.displayToCanonical(raw.indexOf('bottom prose'))).toBe(bottom);
    // The span edges are the same place in both texts.
    expect(seam.canonicalToDisplay(INTRO.length)).toBe(INTRO.length);
    expect(seam.canonicalToDisplay(INTRO.length + T1.length)).toBe(INTRO.length + d1.length);
    expect(seam.displayToCanonical(INTRO.length + d1.length)).toBe(INTRO.length + T1.length);
  });

  test('U1373: an offset inside a cell lands on that content character — first grid, header and body; second grid; every fragment of the wrapped cell', () => {
    const { raw, geoms, d2 } = build();
    const seam = gridSeam(raw, geoms);
    expect(d2.split('\n').length).toBeGreaterThan(4); // the long cell really wrapped
    for (const word of ['Name', 'Detail', 'alpha', 'two', 'Key', 'zq', 'quick', 'brown', 'fox', 'jumps', 'over', 'short']) {
      const c = CANON.indexOf(word);
      const d = seam.canonicalToDisplay(c);
      expect(raw.slice(d, d + word.length)).toBe(word);
    }
    // The wrapped cell's pieces sit on different display lines.
    const q = seam.canonicalToDisplay(CANON.indexOf('quick'));
    const o = seam.canonicalToDisplay(CANON.indexOf('over'));
    expect(raw.slice(q, o)).toContain('\n');
  });

  test('U1374: both directions round-trip on every content position of every cell, wrapped fragments included', () => {
    const { raw, geoms } = build();
    const seam = gridSeam(raw, geoms);
    for (const word of ['Name', 'Detail', 'alpha', 'one', 'beta', 'two', 'Key', 'Value', 'zq', 'quick', 'brown', 'fox', 'jumps', 'over', 'b', 'short']) {
      const c = CANON.indexOf(word);
      for (let i = 0; i <= word.length; i++) {
        const d = seam.canonicalToDisplay(c + i);
        expect(seam.displayToCanonical(d)).toBe(c + i);
      }
    }
  });

  test('U1375: no-home offsets snap instead of failing — delimiter ↔ alignment separator, a between-row rule → the next row, padding and pipes → the nearest content of their row', () => {
    const { raw, geoms, d1 } = build();
    const seam = gridSeam(raw, geoms);
    // Canonical delimiter line → the grid's alignment separator line start.
    const delim = CANON.indexOf('| --- | --- |');
    const sepLineStart = raw.indexOf('| ---');
    expect(seam.canonicalToDisplay(delim + 3)).toBe(sepLineStart);
    // …and back: anywhere on that separator line is the delimiter line's start.
    expect(seam.displayToCanonical(sepLineStart + 4)).toBe(delim);
    // A between-row rule (the grid's second separator) → the next row's first content.
    const lines = d1.split('\n');
    const secondSep = lines.findIndex((l, i) => i > 1 && /^\|[-\s|]+\|$/.test(l));
    expect(secondSep).toBeGreaterThan(1);
    const secondSepStart = INTRO.length + lines.slice(0, secondSep).join('\n').length + 1;
    expect(seam.displayToCanonical(secondSepStart + 2)).toBe(CANON.indexOf('beta'));
    // Display padding after `alpha` and the pipe after it → the end of `alpha`.
    const alphaEnd = raw.indexOf('alpha') + 'alpha'.length;
    const pipe = raw.indexOf('|', alphaEnd);
    expect(seam.displayToCanonical(alphaEnd + 1)).toBe(CANON.indexOf('alpha') + 'alpha'.length);
    expect(seam.displayToCanonical(pipe)).toBe(CANON.indexOf('alpha') + 'alpha'.length);
    // The canonical pipe before `one` → the display position of `one`'s cell start.
    const canonPipe = CANON.indexOf('| one |');
    const d = seam.canonicalToDisplay(canonPipe + 1);
    expect(raw.slice(d, d + 3)).toBe('one');
  });

  test('U1376: a span whose display is not trusted maps line-and-column, and its neighbours still shift', () => {
    const { raw, geoms, d1 } = build();
    const broken: SpanGeometry[] = [{ ...geoms[0], display: null }, geoms[1]];
    const seam = gridSeam(raw, broken);
    // Inside: same line, clamped column — a total answer inside the span.
    const alpha = CANON.indexOf('alpha');
    const d = seam.canonicalToDisplay(alpha);
    expect(d).toBeGreaterThanOrEqual(INTRO.length);
    expect(d).toBeLessThanOrEqual(INTRO.length + d1.length);
    expect(seam.displayToCanonical(d)).toBe(alpha);
    // Outside: the shift is unchanged.
    expect(seam.displayToCanonical(raw.indexOf('middle'))).toBe(CANON.indexOf('middle'));
    expect(seam.canonicalToDisplay(CANON.indexOf('bottom'))).toBe(raw.indexOf('bottom'));
  });

  test('U1377: lines — identity above the first grid, shifted by each grid\'s extra rows below it; the fractional part rides along', () => {
    const { raw, geoms } = build();
    const seam = gridSeam(raw, geoms);
    const top = lineOf(CANON, '# Top');
    expect(seam.canonicalLineToDisplay(top)).toBe(top);
    expect(seam.displayLineToCanonical(top + 0.25)).toBe(top + 0.25);
    const mid = lineOf(CANON, 'middle');
    expect(seam.canonicalLineToDisplay(mid)).toBe(lineOf(raw, 'middle'));
    expect(seam.displayLineToCanonical(lineOf(raw, 'middle'))).toBe(mid);
    const tail = lineOf(CANON, '## Tail');
    expect(lineOf(raw, '## Tail')).toBeGreaterThan(tail + 2);
    expect(seam.canonicalLineToDisplay(tail + 0.5)).toBe(lineOf(raw, '## Tail') + 0.5);
    expect(seam.displayLineToCanonical(lineOf(raw, '## Tail') + 0.5)).toBe(tail + 0.5);
  });

  test('U1378: lines inside a grid — a canonical row maps to its FIRST display line, every display line of a wrapped row maps back to the one canonical row, delimiter ↔ alignment separator', () => {
    const { raw, geoms, d2 } = build();
    const seam = gridSeam(raw, geoms);
    const rowCanon = lineOf(CANON, '| zq |');
    const rowFirst = lineOf(raw, 'zq');
    expect(seam.canonicalLineToDisplay(rowCanon)).toBe(rowFirst);
    // The wrapped row: its continuation lines all name the same canonical row.
    const d2Lines = d2.split('\n');
    const rowIdx = d2Lines.findIndex((l) => l.includes('zq'));
    let n = 0;
    for (let i = rowIdx; i < d2Lines.length && !/^\|[-\s|]+\|$/.test(d2Lines[i]); i++) {
      expect(seam.displayLineToCanonical(rowFirst + (i - rowIdx))).toBe(rowCanon);
      n++;
    }
    expect(n).toBeGreaterThan(1);
    // The next canonical row is the line after the between-row rule.
    expect(seam.canonicalLineToDisplay(rowCanon + 1)).toBe(lineOf(raw, '| b '));
    // The delimiter line and the grid's alignment separator name each other.
    const delimCanon = lineOf(CANON, '| --- |');
    const sepRaw = lineOf(raw, '| ---');
    expect(seam.canonicalLineToDisplay(delimCanon)).toBe(sepRaw);
    expect(seam.displayLineToCanonical(sepRaw)).toBe(delimCanon);
    // A between-row rule names the row after it.
    const secondSepRaw = lineOf(raw, '| b ') - 1;
    expect(seam.displayLineToCanonical(secondSepRaw)).toBe(rowCanon + 1);
    // Header rows agree too.
    expect(seam.canonicalLineToDisplay(lineOf(CANON, '| Key |'))).toBe(lineOf(raw, 'Key'));
    expect(seam.displayLineToCanonical(lineOf(raw, 'Key'))).toBe(lineOf(CANON, '| Key |'));
  });
});
