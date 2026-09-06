/**
 * PRD 014 Req 8 (issue #313): the pure half of landing a Search-view result
 * on the document — resolving a canonical, line-relative `LineMatch` against
 * the text a surface ACTUALLY holds. No React, no platform, no DOM: the
 * callers hand in the surface's text and take back offsets or an index.
 *
 * Why this exists: the results are scanned over the canonical buffer, but
 * neither surface shows canonical text. The editor holds SPEC40's expanded
 * form (a gridded table occupies more characters and more lines than its
 * source), so a canonical document offset dispatched straight into it lands
 * on the wrong characters for every match at or below the first table. The
 * preview holds rendered text, where a match's line has no offset at all —
 * only its block, and its position among that block's hits.
 */

import type { LineMatch } from '@marky-mark/editor';

/** One raw editor line a canonical line maps to: where it starts, what it says. */
export interface RawLine {
  /** Document offset of the line's first character. */
  from: number;
  /** The line's text, terminator excluded. */
  text: string;
}

/** A half-open span of canonical source lines, `[from, to)`; `to` may be Infinity. */
export interface LineRange {
  from: number;
  to: number;
}

/**
 * PRD 014 Req 8 (issue #313): the editor document offsets of a match, given
 * the raw editor lines its canonical line maps to (`canonicalLineMapper`'s
 * answer, read through the editor's sync handle).
 *
 * A line the grid did not touch is the common case and exact: the raw line
 * IS the canonical line, so the match's own offsets apply. Inside a gridded
 * table the canonical row's cells are re-laid on one or more display rows
 * with box-drawing separators and padding, so the hit is re-found by TEXT:
 * the matched substring's occurrence index within the canonical line
 * (counting occurrences that begin before the hit, overlaps included) picks
 * the same occurrence in the display rows, in order. Null when the display
 * rows do not contain that occurrence (a hit spanning a cell boundary, or a
 * cell wrapped mid-word) — the caller degrades to the first row's start. A
 * zero-length match (a regex that can match nothing) lands as a caret at the
 * first row's start rather than hunting for an empty needle.
 */
export function rawMatchOffsets(rows: readonly RawLine[], match: LineMatch): { from: number; to: number } | null {
  const first = rows[0];
  if (!first) return null;
  if (rows.length === 1 && first.text === match.lineText) {
    return { from: first.from + match.start, to: first.from + match.end };
  }
  const needle = match.lineText.slice(match.start, match.end);
  if (needle === '') return { from: first.from, to: first.from };
  const wanted = occurrencesBefore(match.lineText, needle, match.start);
  let seen = 0;
  for (const row of rows) {
    for (let i = row.text.indexOf(needle); i !== -1; i = row.text.indexOf(needle, i + 1)) {
      if (seen === wanted) return { from: row.from + i, to: row.from + i + needle.length };
      seen++;
    }
  }
  return null;
}

/** How many occurrences of `needle` begin before `at` in `text` (overlaps counted). */
function occurrencesBefore(text: string, needle: string, at: number): number {
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1 && i < at; i = text.indexOf(needle, i + 1)) n++;
  return n;
}

/**
 * PRD 014 Req 8 (issue #313): the source-line span a rendered block covers,
 * from the anchor lines the preview carries (`data-mm-line`, one per anchored
 * block). The block is the nearest anchor at or above `line`; its span runs
 * to the next anchor above that (exclusive), or to the end of the document
 * when it is the last block. Null when no anchor sits at or above the line
 * (nothing rendered yet, or a match before the first block).
 */
export function blockLineRange(anchorLines: readonly number[], line: number): LineRange | null {
  let from = -1;
  let to = Infinity;
  for (const n of anchorLines) {
    if (n <= line) {
      if (n > from) from = n;
    } else if (n < to) to = n;
  }
  return from === -1 ? null : { from, to };
}

/**
 * PRD 014 Req 8 (issue #313): which of a block's rendered occurrences the
 * clicked match is — its index among the file's matches (document order,
 * the order `findMatches` yields) whose line falls inside the block's span.
 * The block's rendered text carries the same hits in the same order, so the
 * k-th match of the span is the k-th occurrence the compiled matcher finds
 * in that text. −1 when the match is not in the list at all.
 */
export function blockOccurrenceIndex(matches: readonly LineMatch[], match: LineMatch, range: LineRange): number {
  let index = 0;
  for (const m of matches) {
    if (m.line < range.from || m.line >= range.to) continue;
    if (sameMatch(m, match)) return index;
    index++;
  }
  return -1;
}

const sameMatch = (a: LineMatch, b: LineMatch): boolean =>
  a === b || (a.line === b.line && a.start === b.start && a.end === b.end);
