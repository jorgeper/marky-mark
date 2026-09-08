/**
 * SPEC40 §2 (issue #357) — the ONE canonical ↔ display translation seam.
 *
 * The app speaks CANONICAL coordinates (the file's text: SPEC6 offsets,
 * `data-mm-line` lines), the editor shows every table as SPEC40's padded,
 * wrapped grid. Every canonical offset or 1-based line entering the editor
 * (a mirrored preview selection, a preview-click caret, a carried
 * selection, a scroll or heading target) and every editor offset or line
 * leaving it (the `EditStateReport`, `topLine`) crosses here — never by a
 * caller's own delta arithmetic.
 *
 * These are TOTAL functions: a number, never null. Outside every span they
 * are the shift `canonToDocOffset` / `docToCanonOffset` (gridOffsets.ts)
 * compute; inside a span they resolve through the cell, wrapped fragments
 * included. An offset with no honest cell home snaps rather than failing:
 * the canonical delimiter line lands on the grid's alignment separator, a
 * grid separator lands on the delimiter line (the alignment one) or the
 * next row's first content (a between-row rule), padding and pipes land on
 * the nearest content of their row, a span whose display is not trusted
 * maps line-and-column. The span edges map to each other. The nullable
 * painting API and its PRD 022 Req 12 skip rule are untouched: the seam is
 * layered on the same geometry, not a rewrite.
 *
 * Lines (fractional allowed) agree with `canonicalLineAt` /
 * `canonicalLineMapper` (tableMode.ts): a canonical row of a wrapped grid
 * row maps to that row's FIRST display line, every display line of the row
 * maps back to the one canonical row, and the fractional part rides along.
 *
 * With no span tracked the seam is `IDENTITY_SEAM` — one frozen object,
 * no allocation, so grid view off is byte-identical to before (Req 7).
 */

import { displayCellAt, displayPosOf, lineCellSpans, type ParsedDisplay } from './tableEdit';
import {
  canonCellAt,
  canonLineIndexAt,
  canonLines,
  locate,
  rawIndexForNormalized,
  type SpanGeometry,
} from './gridOffsets';

export interface GridSeam {
  /** A canonical text offset → the editor-document offset showing it. */
  canonicalToDisplay(offset: number): number;
  /** An editor-document offset → the canonical text offset it stands for. */
  displayToCanonical(offset: number): number;
  /** A canonical 1-based (fractional) line → the editor line it starts on. */
  canonicalLineToDisplay(line: number): number;
  /** An editor 1-based (fractional) line → its canonical line. */
  displayLineToCanonical(line: number): number;
}

const same = (n: number): number => n;

/** The seam with no grid tracked: identity in every direction, allocation-free. */
export const IDENTITY_SEAM: GridSeam = Object.freeze({
  canonicalToDisplay: same,
  displayToCanonical: same,
  canonicalLineToDisplay: same,
  displayLineToCanonical: same,
});

/** One span's line bookkeeping, both coordinate systems. */
interface SpanLines {
  /** Its first editor line (1-based). */
  firstRaw: number;
  /** The canonical line that first line is. */
  canonFirst: number;
  /** How many editor lines it shows as. */
  rawLines: number;
  /** How many canonical lines it collapses to. */
  canonLines: number;
  /** Per display line: kind and row, as parsed; null when the span does not parse. */
  lineInfo: ParsedDisplay['lineInfo'] | null;
  /** Whether the canonical text is header / delimiter / one line per row. */
  shaped: boolean;
}

function countNewlines(s: string, from = 0, to = s.length): number {
  let n = 0;
  for (let i = s.indexOf('\n', from); i !== -1 && i < to; i = s.indexOf('\n', i + 1)) n++;
  return n;
}

/**
 * The line-and-column fallback between two texts of the same span (an
 * untrusted display, or a span that never parsed and is its own canonical
 * text): same line index, column clamped to that line. Identity when the
 * texts are equal.
 */
function shiftByLine(from: string, to: string, rel: number): number {
  const at = Math.max(0, Math.min(rel, from.length));
  const fl = from.split('\n');
  const tl = to.split('\n');
  let li = 0;
  let start = 0;
  while (li < fl.length - 1 && at > start + fl[li].length) {
    start += fl[li].length + 1;
    li++;
  }
  const col = at - start;
  const ti = Math.min(li, tl.length - 1);
  let tStart = 0;
  for (let i = 0; i < ti; i++) tStart += tl[i].length + 1;
  return tStart + Math.min(col, tl[ti].length);
}

/**
 * Build the seam over one document: `raw` is the whole editor text, `geoms`
 * the tracked spans' geometry in document order (what `gridGeometry`
 * builds). Empty geometry ⇒ `IDENTITY_SEAM`.
 */
export function gridSeam(raw: string, geoms: readonly SpanGeometry[]): GridSeam {
  if (geoms.length === 0) return IDENTITY_SEAM;

  // --- lines ----------------------------------------------------------------
  const spans: SpanLines[] = [];
  let lineDelta = 0; // editor line − canonical line, accumulated over earlier spans
  for (const g of geoms) {
    const firstRaw = countNewlines(raw, 0, g.from) + 1;
    const rawLines = countNewlines(raw, g.from, g.to) + 1;
    const cl = countNewlines(g.canon) + 1;
    const info = g.parsed?.lineInfo ?? null;
    let rows = 0;
    if (info) for (const l of info) if (l.kind === 'cells' && l.row + 1 > rows) rows = l.row + 1;
    spans.push({
      firstRaw,
      canonFirst: firstRaw - lineDelta,
      rawLines,
      canonLines: cl,
      lineInfo: info,
      shaped: info !== null && cl === rows + 2,
    });
    lineDelta += rawLines - cl;
  }

  /** The first display row (0-based within the span) of a canonical row offset — `spanDisplayRows`' first pick. */
  const firstDisplayRow = (s: SpanLines, offset: number): number => {
    if (!s.lineInfo || !s.shaped) return Math.min(offset, s.rawLines - 1);
    const info = s.lineInfo;
    if (offset === 1) {
      const i = info.findIndex((l) => l.kind === 'separator');
      return i === -1 ? 0 : i;
    }
    const wanted = offset === 0 ? -1 : offset - 2;
    const i = info.findIndex((l) => l.kind === 'cells' && l.row === wanted);
    return i === -1 ? 0 : i;
  };

  /** The canonical row offset a display row (0-based within the span) stands for. */
  const canonRowOf = (s: SpanLines, idx: number): number => {
    const last = s.canonLines - 1;
    if (!s.lineInfo || !s.shaped) return Math.min(idx, last);
    const info = s.lineInfo[idx];
    if (!info) return last;
    if (info.kind === 'separator') return info.row === -1 ? 1 : Math.min(info.row + 3, last);
    return Math.min(info.row === -1 ? 0 : info.row + 2, last);
  };

  const canonicalLineToDisplay = (line: number): number => {
    const n = Math.floor(line);
    const frac = line - n;
    for (const s of spans) {
      const above = s.firstRaw - s.canonFirst;
      if (n < s.canonFirst) return n + above + frac;
      if (n < s.canonFirst + s.canonLines) return s.firstRaw + firstDisplayRow(s, n - s.canonFirst) + frac;
    }
    return n + lineDelta + frac;
  };

  const displayLineToCanonical = (line: number): number => {
    const n = Math.floor(line);
    const frac = line - n;
    for (const s of spans) {
      const above = s.firstRaw - s.canonFirst;
      if (n < s.firstRaw) return n - above + frac;
      if (n < s.firstRaw + s.rawLines) return s.canonFirst + canonRowOf(s, n - s.firstRaw) + frac;
    }
    return n - lineDelta + frac;
  };

  // --- offsets --------------------------------------------------------------
  const canonicalToDisplay = (offset: number): number => {
    const at = locate(geoms, offset);
    if (at.kind === 'outside') return at.pos;
    const g = geoms[at.index];
    const rel = offset - g.canonFrom;
    // The span's edges are the same place in both texts.
    if (rel <= 0) return g.from;
    if (rel >= g.canon.length) return g.to;
    if (g.display) {
      const lines = canonLines(g.canon);
      if (canonLineIndexAt(lines, rel) === 1) {
        // The delimiter line: the grid's alignment separator (its start).
        const sep = g.display.map.lines.find((l) => l.kind === 'separator');
        return g.from + (sep ? sep.from : 0);
      }
      const loc = canonCellAt(g.canon, rel);
      if (loc) return g.from + displayPosOf(g.display.map, loc);
    }
    return g.from + shiftByLine(g.canon, raw.slice(g.from, g.to), rel);
  };

  const displayToCanonical = (offset: number): number => {
    let delta = 0; // editor-doc position − canonical position, so far
    for (const g of geoms) {
      if (offset < g.from) return offset - delta;
      if (offset <= g.to) {
        const rel = offset - g.from;
        if (rel <= 0) return g.canonFrom;
        if (rel >= g.to - g.from) return g.canonFrom + g.canon.length;
        if (g.display) {
          const cLines = canonLines(g.canon);
          const info = g.display.parsed.lineInfo[countNewlines(raw, g.from, offset)];
          if (info?.kind === 'separator') {
            // The alignment separator is the canonical delimiter line; a
            // between-row rule has no canonical line — the next row's first
            // content (the last row's end when there is no next row).
            const li = info.row === -1 ? 1 : info.row + 3;
            if (li === 1) return g.canonFrom + cLines[Math.min(1, cLines.length - 1)].start;
            if (li < cLines.length) {
              const cells = lineCellSpans(g.canon, cLines[li].start, cLines[li].end);
              return g.canonFrom + (cells[0]?.contentStart ?? cLines[li].start);
            }
            const lastLine = cLines[cLines.length - 1];
            const cells = lineCellSpans(g.canon, lastLine.start, lastLine.end);
            return g.canonFrom + (cells.length ? cells[cells.length - 1].contentEnd : lastLine.end);
          }
          const loc = displayCellAt(raw, { start: g.from, end: g.to }, g.display.parsed, offset);
          if (loc) {
            const cli = loc.row === -1 ? 0 : loc.row + 2;
            const cell = cli < cLines.length ? lineCellSpans(g.canon, cLines[cli].start, cLines[cli].end)[loc.col] : undefined;
            if (cell) {
              const rawContent = g.canon.slice(cell.contentStart, cell.contentEnd);
              return g.canonFrom + cell.contentStart + rawIndexForNormalized(rawContent, loc.contentOffset);
            }
          }
        }
        return g.canonFrom + shiftByLine(raw.slice(g.from, g.to), g.canon, rel);
      }
      delta += g.to - g.from - g.canon.length;
    }
    return offset - delta;
  };

  return { canonicalToDisplay, displayToCanonical, canonicalLineToDisplay, displayLineToCanonical };
}
