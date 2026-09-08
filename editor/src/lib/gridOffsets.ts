/**
 * Issue #344 — canonical ⇄ display offsets across SPEC40 table grids.
 *
 * Comment and highlight ranges are anchored to the CANONICAL file text
 * (SPEC6), while the editor shows every table in SPEC40's padded, wrapped
 * grid form. PRD 022 Req 12 mapped canonical offsets outside a grid span by
 * shifting them past each earlier span's length delta, and skipped any offset
 * inside a span. This module gives an offset inside a span its honest home:
 * the cell holding it (row, col) and its offset into the cell's normalized
 * content, resolved through the same `layoutTable` display map SPEC40 uses
 * (`DisplayMap.fragments`), so a range lands on the cell fragment(s) that
 * show that text and never on padding, pipes, separator lines or the `↩`
 * continuation marker. The reverse direction (display → canonical) is what
 * the annotation seam uses to anchor a grid-cell selection to file text
 * (PRD 023 §19).
 *
 * The PRD 022 Req 12 skip rule stands: a range that cannot be placed
 * confidently — its ends in two different cells, on a delimiter line, or in
 * a span whose display no longer round-trips — maps to null and is never
 * painted at a guessed position.
 */

import {
  displayCellAt,
  displayPosOf,
  layoutTable,
  lineCellSpans,
  parseDisplay,
  type CellSpan,
  type DisplayMap,
  type ParsedDisplay,
} from './tableEdit';

/** One tracked grid span, with everything both directions of the mapping need. */
export interface SpanGeometry {
  /** The span's editor-document range (the display text). */
  from: number;
  to: number;
  /** Where the span starts in the canonical text (`from` minus earlier deltas). */
  canonFrom: number;
  /** The span's canonical (collapsed) text. */
  canon: string;
  /**
   * The display side, when the span's editor text parses and re-lays out to
   * itself byte-for-byte (SPEC38 §2.4's trust rule); null means no per-cell
   * mapping is possible and everything inside the span skips.
   */
  display: { parsed: ParsedDisplay; map: DisplayMap } | null;
}

export interface DocRange {
  from: number;
  to: number;
}

/**
 * Build one span's geometry. `raw` is the whole editor document, `canon` the
 * span's collapsed text (what `canonicalizeAll` splices in for it) and
 * `canonFrom` its start in the canonical text.
 */
export function spanGeometry(
  raw: string,
  span: { from: number; to: number },
  canon: string,
  canonFrom: number,
  width: number
): SpanGeometry {
  const region = { start: span.from, end: span.to };
  const parsed = parseDisplay(raw, region);
  let display: SpanGeometry['display'] = null;
  if (parsed) {
    const laid = layoutTable(parsed.model, width);
    if (laid.text === raw.slice(span.from, span.to)) display = { parsed, map: laid.map };
  }
  return { from: span.from, to: span.to, canonFrom, canon, display };
}

/** A canonical-text location inside a table: cell plus normalized content offset. */
export interface CellLoc {
  row: number; // −1 header
  col: number;
  /** Offset into the cell's whitespace-normalized content (the display model's cell). */
  contentOffset: number;
}

/**
 * Normalized-content offset of a raw index into a cell's raw content, where
 * normalization is `layoutTable`'s: whitespace runs collapse to one space,
 * edges trim. A raw index inside a whitespace run maps to the end of the
 * word before it (left affinity), and to 0 inside leading whitespace.
 */
export function normalizedOffset(rawContent: string, rawIndex: number): number {
  let out = 0;
  let pendingSpace = false;
  const at = Math.max(0, Math.min(rawIndex, rawContent.length));
  for (let i = 0; i < at; i++) {
    if (/\s/.test(rawContent[i])) {
      if (out > 0) pendingSpace = true;
    } else {
      if (pendingSpace) {
        out++;
        pendingSpace = false;
      }
      out++;
    }
  }
  // Standing on the word after a run: the joining space is already emitted.
  if (pendingSpace && at < rawContent.length && !/\s/.test(rawContent[at])) out++;
  return out;
}

/**
 * The inverse: the raw index at which normalized offset `n` begins — the
 * raw index of the character that becomes normalized character `n`, or the
 * raw index just past the last content character when `n` is the
 * normalized length. A joining space maps to the raw whitespace run's start.
 */
export function rawIndexForNormalized(rawContent: string, n: number): number {
  let out = 0;
  let pendingSpace = false;
  let lastContentEnd = 0;
  let runStart = -1;
  for (let i = 0; i < rawContent.length; i++) {
    if (/\s/.test(rawContent[i])) {
      if (out > 0 && !pendingSpace) {
        pendingSpace = true;
        runStart = i;
      }
    } else {
      if (pendingSpace) {
        if (out === n) return runStart;
        out++;
        pendingSpace = false;
      }
      if (out === n) return i;
      out++;
      lastContentEnd = i + 1;
    }
  }
  return lastContentEnd;
}

/** Canonical table lines: [start, end] per line, relative to the canonical span text. */
function canonLines(canon: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let pos = 0;
  for (const line of canon.split('\n')) {
    out.push({ start: pos, end: pos + line.length });
    pos += line.length + 1;
  }
  return out;
}

/** Line index (0 header, 1 delimiter, 2+ rows) of a canonical-relative offset. */
function canonLineIndexAt(lines: Array<{ start: number; end: number }>, offset: number): number {
  for (let i = 0; i < lines.length; i++) if (offset <= lines[i].end) return i;
  return lines.length - 1;
}

/** The canonical cell holding a canonical-relative offset, or null on the delimiter line. */
function canonCellAt(canon: string, offset: number): { loc: CellLoc; cell: CellSpan } | null {
  const lines = canonLines(canon);
  const li = canonLineIndexAt(lines, offset);
  if (li === 1) return null; // the delimiter row paints nothing
  const spans = lineCellSpans(canon, lines[li].start, lines[li].end);
  if (!spans.length) return null;
  let col = spans.findIndex((c) => offset >= c.cellStart && offset <= c.cellEnd);
  if (col === -1) col = offset < spans[0].cellStart ? 0 : spans.length - 1;
  const cell = spans[col];
  const rawContent = canon.slice(cell.contentStart, cell.contentEnd);
  const within = Math.max(0, Math.min(offset - cell.contentStart, rawContent.length));
  return {
    loc: { row: li === 0 ? -1 : li - 2, col, contentOffset: normalizedOffset(rawContent, within) },
    cell,
  };
}

/** Where a canonical offset sits relative to the spans: outside (shifted) or inside span `i`. */
function locate(
  geoms: readonly SpanGeometry[],
  offset: number
): { kind: 'outside'; pos: number } | { kind: 'inside'; index: number } {
  let delta = 0; // editor-doc position − canonical position, so far
  for (let i = 0; i < geoms.length; i++) {
    const g = geoms[i];
    const canonTo = g.canonFrom + g.canon.length;
    if (offset < g.canonFrom) return { kind: 'outside', pos: offset + delta };
    if (offset <= canonTo) return { kind: 'inside', index: i };
    delta += g.to - g.from - g.canon.length;
  }
  return { kind: 'outside', pos: offset + delta };
}

/**
 * PRD 022 Req 12 (issue #344): one canonical offset → its editor-doc
 * position. Outside every span the texts are byte-identical modulo each
 * earlier span's length delta (identity before the first table, shifted
 * after one). Inside a span the offset resolves through its cell to the
 * display fragment showing that content character. Null when the span has
 * no trusted display or the offset is on the delimiter line.
 */
export function canonToDocOffset(geoms: readonly SpanGeometry[], offset: number): number | null {
  const at = locate(geoms, offset);
  if (at.kind === 'outside') return at.pos;
  const g = geoms[at.index];
  if (!g.display) return null;
  const hit = canonCellAt(g.canon, offset - g.canonFrom);
  if (!hit) return null;
  return g.from + displayPosOf(g.display.map, hit.loc);
}

/**
 * PRD 022 Req 12 (issue #344): a canonical range → the editor-doc range(s)
 * to paint. Outside every span, one shifted range (a range spanning a whole
 * table paints as before — both ends shift). Inside a span, both ends must
 * fall in the SAME cell: the range then maps to one piece per display
 * fragment it touches — a cell that word-wraps paints each fragment's
 * visible characters, never the joining space, the padding, the pipes or
 * the `↩` marker. Anything else (ends in two cells, one end inside and one
 * outside, a delimiter line, an untrusted display, an empty result) is null:
 * skipped, never painted at a wrong position.
 */
export function canonToDocRanges(geoms: readonly SpanGeometry[], from: number, to: number): DocRange[] | null {
  if (to <= from) return null;
  const a = locate(geoms, from);
  const b = locate(geoms, to);
  if (a.kind === 'outside' && b.kind === 'outside') return [{ from: a.pos, to: b.pos }];
  // A range ending exactly where a span begins is still an outside range.
  if (a.kind === 'outside' && b.kind === 'inside' && to === geoms[b.index].canonFrom) {
    return [{ from: a.pos, to: geoms[b.index].from }];
  }
  // A range starting exactly where a span ends is an outside range too.
  if (a.kind === 'inside' && b.kind === 'outside' && from === geoms[a.index].canonFrom + geoms[a.index].canon.length) {
    return [{ from: geoms[a.index].to, to: b.pos }];
  }
  if (a.kind !== 'inside' || b.kind !== 'inside' || a.index !== b.index) return null;
  const g = geoms[a.index];
  if (!g.display) return null;
  const ha = canonCellAt(g.canon, from - g.canonFrom);
  const hb = canonCellAt(g.canon, to - g.canonFrom);
  if (!ha || !hb || ha.loc.row !== hb.loc.row || ha.loc.col !== hb.loc.col) return null;
  const cs = ha.loc.contentOffset;
  const ce = hb.loc.contentOffset;
  if (ce <= cs) return null;
  const out: DocRange[] = [];
  const frags = g.display.map.fragments
    .filter((f) => f.row === ha.loc.row && f.col === ha.loc.col)
    .sort((x, y) => x.frag - y.frag);
  for (const f of frags) {
    const s = Math.max(cs, f.contentOffset);
    const e = Math.min(ce, f.contentOffset + f.length);
    if (e > s) out.push({ from: g.from + f.from + (s - f.contentOffset), to: g.from + f.from + (e - f.contentOffset) });
  }
  return out.length ? out : null;
}

/**
 * PRD 023 §19 (issue #344): one editor-doc offset → its canonical offset.
 * Outside every span the shift reverses; inside a span the display cell
 * (`displayCellAt`) resolves to the canonical cell's raw content through the
 * normalized-offset inverse. Null when the span has no trusted display or
 * the offset sits on a separator line — the caller falls back rather than
 * anchoring to text that is not in the file.
 */
export function docToCanonOffset(geoms: readonly SpanGeometry[], offset: number, raw: string): number | null {
  let delta = 0;
  for (const g of geoms) {
    if (offset < g.from) return offset - delta;
    if (offset <= g.to) {
      if (!g.display) return null;
      const region = { start: g.from, end: g.to };
      const loc = displayCellAt(raw, region, g.display.parsed, offset);
      if (!loc) return null;
      // A separator line names the row above with contentOffset 0 — not a
      // cell the caret can be "in".
      const lines = raw.slice(g.from, g.to).split('\n');
      let li = 0;
      let pos = g.from;
      for (; li < lines.length - 1 && offset > pos + lines[li].length; li++) pos += lines[li].length + 1;
      if (g.display.parsed.lineInfo[li]?.kind !== 'cells') return null;
      const cLines = canonLines(g.canon);
      const cli = loc.row === -1 ? 0 : loc.row + 2;
      if (cli >= cLines.length) return null;
      const cells = lineCellSpans(g.canon, cLines[cli].start, cLines[cli].end);
      const cell = cells[loc.col];
      if (!cell) return null;
      const rawContent = g.canon.slice(cell.contentStart, cell.contentEnd);
      return g.canonFrom + cell.contentStart + rawIndexForNormalized(rawContent, loc.contentOffset);
    }
    delta += g.to - g.from - g.canon.length;
  }
  return offset - delta;
}
