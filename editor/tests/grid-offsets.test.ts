import { describe, expect, test } from 'vitest';
import {
  canonToDocOffset,
  canonToDocRanges,
  docToCanonOffset,
  normalizedOffset,
  rawIndexForNormalized,
  spanGeometry,
  type SpanGeometry,
} from '../src/lib/gridOffsets';
import { HARD_BREAK, layoutTable, parseTable } from '../src/lib/tableEdit';

/**
 * Issue #344: a document with one table, laid out narrow enough that the
 * first cell wraps onto a continuation line — the canonical text is what
 * annotations anchor to, the display text is what the editor shows.
 */
const INTRO = 'intro\n\n';
const TBL = '| Name | Detail |\n| --- | --- |\n| quick brown fox jumps | b |';
const OUTRO = '\n\noutro';
const CANON = INTRO + TBL + OUTRO;

function build(width: number, table = TBL): { raw: string; geoms: SpanGeometry[]; display: string } {
  const model = parseTable(table, { start: 0, end: table.length });
  const display = layoutTable(model, width).text;
  const raw = INTRO + display + OUTRO;
  const span = { from: INTRO.length, to: INTRO.length + display.length };
  return { raw, display, geoms: [spanGeometry(raw, span, table, INTRO.length, width)] };
}

const sliceAll = (raw: string, ranges: { from: number; to: number }[] | null) =>
  ranges ? ranges.map((r) => raw.slice(r.from, r.to)) : null;

describe('PRD 022 Req 12 / SPEC40 §2 (issue #344): canonical → display offsets across a table grid', () => {
  test('U1350: an offset before the first table maps by identity', () => {
    const { raw, geoms } = build(24);
    expect(geoms[0].display).not.toBeNull();
    expect(canonToDocOffset(geoms, 3)).toBe(3);
    expect(sliceAll(raw, canonToDocRanges(geoms, 0, 5))).toEqual(['intro']);
    // A range ending exactly where the table begins is still an outside range.
    expect(sliceAll(raw, canonToDocRanges(geoms, 0, INTRO.length))).toEqual([INTRO]);
  });

  test('U1351: an offset inside a cell on the first display line lands on that content character', () => {
    const { raw, geoms, display } = build(24);
    // The narrow budget wraps the long cell: "quick brown" then "fox jumps".
    expect(display.split('\n')).toHaveLength(4);
    const q = CANON.indexOf('quick');
    const pos = canonToDocOffset(geoms, q)!;
    expect(raw.slice(pos, pos + 5)).toBe('quick');
    expect(sliceAll(raw, canonToDocRanges(geoms, q, q + 'quick brown'.length))).toEqual(['quick brown']);
    // The header row (row −1) maps too.
    const d = CANON.indexOf('Detail');
    expect(sliceAll(raw, canonToDocRanges(geoms, d, d + 6))).toEqual(['Detail']);
  });

  test('U1352: a range that word-wraps paints one piece per fragment — never the joining space, padding or pipes', () => {
    const { raw, geoms } = build(24);
    const b = CANON.indexOf('brown');
    const pieces = canonToDocRanges(geoms, b, b + 'brown fox jumps'.length);
    expect(sliceAll(raw, pieces)).toEqual(['brown', 'fox jumps']);
    // The two pieces sit on different display lines.
    expect(raw.slice(pieces![0].to, pieces![1].from)).toContain('\n');
  });

  test('U1353: cell boundaries — the whole cell maps to its fragments, a range crossing into the next cell skips, the delimiter line skips', () => {
    const { raw, geoms } = build(24);
    const start = CANON.indexOf('quick');
    const end = start + 'quick brown fox jumps'.length;
    expect(sliceAll(raw, canonToDocRanges(geoms, start, end))).toEqual(['quick brown', 'fox jumps']);
    // The end offset sits on the cell boundary (right before " |"): the
    // single-offset mapping lands at the end of the last fragment.
    const endPos = canonToDocOffset(geoms, end)!;
    expect(raw.slice(endPos - 'jumps'.length, endPos)).toBe('jumps');
    // "jumps | b" — two cells: skipped, never painted at a guessed place.
    const j = CANON.indexOf('jumps');
    expect(canonToDocRanges(geoms, j, CANON.indexOf('| b |') + 3)).toBeNull();
    // The delimiter row has no honest home.
    expect(canonToDocOffset(geoms, CANON.indexOf('---'))).toBeNull();
    // One end outside the table, one inside: skipped.
    expect(canonToDocRanges(geoms, 0, start + 3)).toBeNull();
    // A canonical range in padding only (no content) is skipped.
    expect(canonToDocRanges(geoms, start - 1, start)).toBeNull();
  });

  test('U1354: an offset after the table shifts by the span delta', () => {
    const { raw, geoms, display } = build(24);
    const delta = display.length - TBL.length;
    expect(delta).toBeGreaterThan(0);
    const o = CANON.indexOf('outro');
    expect(canonToDocOffset(geoms, o)).toBe(o + delta);
    expect(sliceAll(raw, canonToDocRanges(geoms, o, o + 5))).toEqual(['outro']);
    // A range starting exactly where the table ends is an outside range.
    const tblEnd = INTRO.length + TBL.length;
    expect(sliceAll(raw, canonToDocRanges(geoms, tblEnd, tblEnd + 2))).toEqual(['\n\n']);
  });

  test('U1355: display → canonical is the inverse over every content character; a separator line maps to null', () => {
    const { raw, geoms } = build(24);
    const words = ['quick', 'brown', 'fox', 'jumps', 'Name', 'Detail', 'b'];
    for (const word of words) {
      const c = CANON.indexOf(word);
      for (let i = 0; i <= word.length; i++) {
        const doc = canonToDocOffset(geoms, c + i)!;
        expect(docToCanonOffset(geoms, doc, raw)).toBe(c + i);
      }
    }
    // Outside the table: identity before, shifted after.
    expect(docToCanonOffset(geoms, 3, raw)).toBe(3);
    const o = raw.indexOf('outro');
    expect(docToCanonOffset(geoms, o, raw)).toBe(CANON.indexOf('outro'));
    // On the grid's separator line: null.
    const sep = raw.indexOf('| ---');
    expect(docToCanonOffset(geoms, sep + 3, raw)).toBeNull();
  });

  test('U1356: a hard-broken word paints its pieces without the ↩ marker', () => {
    const table = '| Name | D |\n| --- | --- |\n| abcdefghijklmnopqrstuvwxyz | b |';
    const { raw, geoms, display } = build(24, table);
    expect(display).toContain(HARD_BREAK);
    const canon = INTRO + table + OUTRO;
    const w = canon.indexOf('abcdefghij');
    const pieces = canonToDocRanges(geoms, w, w + 26)!;
    expect(pieces.length).toBeGreaterThan(1);
    const texts = sliceAll(raw, pieces)!;
    for (const t of texts) expect(t).not.toContain(HARD_BREAK);
    expect(texts.join('')).toBe('abcdefghijklmnopqrstuvwxyz');
    // And back: every character of the broken word round-trips.
    for (let i = 0; i < 26; i++) expect(docToCanonOffset(geoms, canonToDocOffset(geoms, w + i)!, raw)).toBe(w + i);
  });

  test('U1357: hand-formatted cell whitespace collapses like the display does, both directions', () => {
    expect(normalizedOffset('quick   brown', 0)).toBe(0);
    expect(normalizedOffset('quick   brown', 5)).toBe(5);
    expect(normalizedOffset('quick   brown', 7)).toBe(5); // inside the run: left affinity
    expect(normalizedOffset('quick   brown', 8)).toBe(6);
    expect(normalizedOffset('quick   brown', 13)).toBe(11);
    expect(rawIndexForNormalized('quick   brown', 5)).toBe(5);
    expect(rawIndexForNormalized('quick   brown', 6)).toBe(8);
    expect(rawIndexForNormalized('quick   brown', 11)).toBe(13);
    // A hand-padded canonical table: the range over "brown" still lands on it.
    const table = '| Name | D |\n| --- | --- |\n| quick   brown | b |';
    const { raw, geoms } = build(40, table);
    const canon = INTRO + table + OUTRO;
    const b = canon.indexOf('brown');
    expect(sliceAll(raw, canonToDocRanges(geoms, b, b + 5))).toEqual(['brown']);
    expect(docToCanonOffset(geoms, canonToDocOffset(geoms, b)!, raw)).toBe(b);
  });

  test('U1358: a span whose display does not round-trip has no cell mapping — inside skips, outside still shifts', () => {
    const { raw, geoms } = build(24);
    const broken: SpanGeometry[] = [{ ...geoms[0], display: null }];
    expect(canonToDocOffset(broken, CANON.indexOf('quick'))).toBeNull();
    expect(canonToDocRanges(broken, CANON.indexOf('quick'), CANON.indexOf('quick') + 5)).toBeNull();
    expect(docToCanonOffset(broken, raw.indexOf('quick'), raw)).toBeNull();
    const o = CANON.indexOf('outro');
    expect(canonToDocOffset(broken, o)).toBe(raw.indexOf('outro'));
    // A doc slice that is not its own layout (a foreign edit ate the cell
    // padding) builds an untrusted geometry.
    const edited = raw.replace('| quick', '|quick');
    const g = spanGeometry(edited, { from: geoms[0].from, to: geoms[0].to - 1 }, TBL, INTRO.length, 24);
    expect(g.display).toBeNull();
  });
});
