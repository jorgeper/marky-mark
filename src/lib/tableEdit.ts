/**
 * SPEC37 §1: the table-edit pure model. No DOM imports. Cells hold their RAW
 * source markdown — verbatim, inline syntax and `\|` escapes included —
 * and every operation returns the whole new document text plus the table's
 * NEW span, so the editor can keep tracking it across edits.
 */

export type ColAlign = 'left' | 'center' | 'right' | null;

export interface TableModel {
  header: string[];
  align: ColAlign[];
  rows: string[][];
  /** 0-based offsets: first char of the table's first line … end of its last line. */
  start: number;
  end: number;
}

export interface TableEdit {
  text: string;
  start: number;
  end: number;
}

export interface Region {
  start: number;
  end: number;
}

// A GFM table delimiter row (same shape SPEC36 pinned in detectContext).
const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * The pipe-table region containing `offset`, or null. Extracted from the
 * SPEC36 detectContext scan (which now calls this) — detection semantics
 * unchanged: ≥2 consecutive `|` lines whose second is a delimiter row.
 */
export function tableRegionAt(text: string, offset: number): Region | null {
  const lines = text.split('\n');
  // Line index containing the offset.
  let target = lines.length - 1;
  let off = 0;
  for (let i = 0; i < lines.length; i++) {
    if (offset <= off + lines[i].length) {
      target = i;
      break;
    }
    off += lines[i].length + 1;
  }

  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].includes('|')) continue;
    if (!(DELIM.test(lines[i + 1]) && lines[i + 1].includes('-') && lines[i + 1].includes('|'))) continue;
    let j = i + 1;
    while (j + 1 < lines.length && lines[j + 1].includes('|')) j++;
    if (target >= i && target <= j) {
      let start = 0;
      for (let k = 0; k < i; k++) start += lines[k].length + 1;
      let end = start;
      for (let k = i; k <= j; k++) end += lines[k].length + (k < j ? 1 : 0);
      return { start, end };
    }
    i = j;
  }
  return null;
}

/** Split a table line into raw cells on UNESCAPED pipes; edge pipes stripped. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      cur += ch + line[i + 1];
      i++;
    } else if (ch === '|') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  // Edge pipes produce empty first/last segments (whitespace-only counts).
  if (cells.length && !cells[0].trim()) cells.shift();
  if (cells.length && !cells[cells.length - 1].trim()) cells.pop();
  return cells.map((c) => c.trim());
}

function parseAlign(cell: string): ColAlign {
  const c = cell.trim();
  const left = c.startsWith(':');
  const right = c.endsWith(':');
  if (left && right) return 'center';
  if (left) return 'left';
  if (right) return 'right';
  return null;
}

/** Parse the pipe table occupying `region` into the model. */
export function parseTable(text: string, region: Region): TableModel {
  const lines = text.slice(region.start, region.end).split('\n');
  const header = splitRow(lines[0]);
  const align = splitRow(lines[1]).map(parseAlign);
  while (align.length < header.length) align.push(null);
  const rows = lines.slice(2).map((line) => {
    const cells = splitRow(line);
    while (cells.length < header.length) cells.push('');
    return cells.slice(0, header.length);
  });
  return { header, align: align.slice(0, header.length), rows, start: region.start, end: region.end };
}

/** Pretty edged pipe table: one-space padding, columns padded to the widest cell. */
export function serializeTable(m: Pick<TableModel, 'header' | 'align' | 'rows'>): string {
  const cols = m.header.length;
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    let w = 3; // delimiter minimum
    for (const raw of [m.header[c] ?? '', ...m.rows.map((r) => r[c] ?? '')]) {
      w = Math.max(w, raw.length);
    }
    widths.push(w);
  }
  const line = (cells: string[]) =>
    `| ${cells.map((c, i) => (c ?? '').padEnd(widths[i])).join(' | ')} |`;
  const delim = (a: ColAlign, w: number) => {
    if (a === 'center') return `:${'-'.repeat(Math.max(1, w - 2))}:`;
    if (a === 'left') return `:${'-'.repeat(w - 1)}`;
    if (a === 'right') return `${'-'.repeat(w - 1)}:`;
    return '-'.repeat(w);
  };
  return [
    line(m.header),
    `| ${m.align.map((a, i) => delim(a, widths[i])).join(' | ')} |`,
    ...m.rows.map(line),
  ].join('\n');
}

/** Splice the re-serialized model back over its region in `text`. */
function commit(text: string, m: TableModel): TableEdit {
  const table = serializeTable(m);
  return {
    text: text.slice(0, m.start) + table + text.slice(m.end),
    start: m.start,
    end: m.start + table.length,
  };
}

/** Insert an empty body row before body index `at` (0 … rows.length). */
export function insertRow(text: string, m: TableModel, at: number): TableEdit {
  const rows = [...m.rows];
  rows.splice(Math.max(0, Math.min(at, rows.length)), 0, m.header.map(() => ''));
  return commit(text, { ...m, rows });
}

/** Delete body row `at`; the header (−1) is structural and refuses (null). */
export function deleteRow(text: string, m: TableModel, at: number): TableEdit | null {
  if (at < 0 || at >= m.rows.length) return null;
  const rows = m.rows.filter((_, i) => i !== at);
  return commit(text, { ...m, rows });
}

/** Insert an empty column before index `at` (0 … cols). */
export function insertCol(text: string, m: TableModel, at: number): TableEdit {
  const j = Math.max(0, Math.min(at, m.header.length));
  const header = [...m.header];
  header.splice(j, 0, '');
  const align: ColAlign[] = [...m.align];
  align.splice(j, 0, null);
  const rows = m.rows.map((r) => {
    const row = [...r];
    row.splice(j, 0, '');
    return row;
  });
  return commit(text, { header, align, rows, start: m.start, end: m.end });
}

/** Delete column `at`; a 1-column table refuses (Delete Table is the path). */
export function deleteCol(text: string, m: TableModel, at: number): TableEdit | null {
  if (m.header.length <= 1 || at < 0 || at >= m.header.length) return null;
  const drop = <T,>(arr: T[]) => arr.filter((_, i) => i !== at);
  return commit(text, {
    ...m,
    header: drop(m.header),
    align: drop(m.align),
    rows: m.rows.map(drop),
  });
}

/** Escape unescaped pipes; already-escaped `\|` pass through untouched. */
export function escapeCell(raw: string): string {
  return raw
    .split('\\|')
    .map((s) => s.replaceAll('|', '\\|'))
    .join('\\|');
}

/** Set a cell's raw markdown (row −1 = header). Pipes are escaped here. */
export function setCell(
  text: string,
  m: TableModel,
  row: number,
  col: number,
  raw: string
): TableEdit | null {
  if (col < 0 || col >= m.header.length) return null;
  if (row < -1 || row >= m.rows.length) return null;
  const value = escapeCell(raw.trim());
  if (row === -1) {
    const header = [...m.header];
    header[col] = value;
    return commit(text, { ...m, header });
  }
  const rows = m.rows.map((r, i) => (i === row ? r.map((c, j) => (j === col ? value : c)) : r));
  return commit(text, { ...m, rows });
}

/** The Insert Table payload: 3 columns, 2 empty body rows (SPEC38: compact). */
export function starterTable(): string {
  return serializeCompactTable({
    header: ['Column 1', 'Column 2', 'Column 3'],
    align: [null, null, null],
    rows: [
      ['', '', ''],
      ['', '', ''],
    ],
  });
}

/**
 * SPEC37 §3.2: splice the starter table at the cursor's line with
 * insertHr-style blank-line management; the selection lands on the first
 * header cell's text ("Column 1").
 */
export function insertTableAt(text: string, offset: number): { text: string; from: number; to: number } {
  let lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  if (offset === 0) lineStart = 0;
  let lineEnd = text.indexOf('\n', offset);
  if (lineEnd === -1) lineEnd = text.length;
  const curLine = text.slice(lineStart, lineEnd);
  const nextEndRaw = text.indexOf('\n', lineEnd + 1);
  const nextLine =
    lineEnd < text.length ? text.slice(lineEnd + 1, nextEndRaw === -1 ? text.length : nextEndRaw) : null;

  const parts: string[] = [];
  if (curLine.trim()) parts.push('');
  parts.push(starterTable());
  if (nextLine !== null && nextLine.trim()) parts.push('');
  const block = (curLine.length || lineEnd < text.length ? '\n' : '') + parts.join('\n');
  const t = text.slice(0, lineEnd) + block + text.slice(lineEnd);
  const tableStart = lineEnd + (block.length - parts.join('\n').length) + (curLine.trim() ? 1 : 0);
  const from = tableStart + 2; // past "| "
  return { text: t, from, to: from + 'Column 1'.length };
}

/**
 * SPEC37 §3.3: remove the table at `offset` along with one separating blank
 * line; the caret lands where the table was. Null when not in a table.
 */
export function deleteTableAt(text: string, offset: number): { text: string; from: number; to: number } | null {
  const region = tableRegionAt(text, offset);
  if (!region) return null;
  let { start, end } = region;
  // Swallow the table's line terminator, then one following blank line —
  // or, at doc end, one preceding blank line — so no double gap remains.
  if (text[end] === '\n') {
    end += 1;
    if (text[end] === '\n') end += 1;
  } else if (end >= text.length && text.slice(start - 2, start) === '\n\n') {
    start -= 1;
  }
  return { text: text.slice(0, start) + text.slice(end), from: start, to: start };
}

// ---------------------------------------------------------------------------
// SPEC37 §1.5: the aligned-mode helpers.

/** A row line's cells with absolute spans: pipe-bounded region + trimmed content. */
interface CellSpan {
  cellStart: number;
  cellEnd: number;
  contentStart: number;
  contentEnd: number;
}

function lineCellSpans(text: string, lineStart: number, lineEnd: number): CellSpan[] {
  const line = text.slice(lineStart, lineEnd);
  const pipes: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') {
      i++;
    } else if (line[i] === '|') {
      pipes.push(i);
    }
  }
  const bounds = [-1, ...pipes, line.length];
  let segs: Array<{ s: number; e: number }> = [];
  for (let b = 0; b + 1 < bounds.length; b++) segs.push({ s: bounds[b] + 1, e: bounds[b + 1] });
  // Mirror splitRow's edge handling: whitespace-only first/last segments are
  // edge padding outside the pipes, not cells.
  if (segs.length && !line.slice(segs[0].s, segs[0].e).trim()) segs = segs.slice(1);
  if (segs.length && !line.slice(segs[segs.length - 1].s, segs[segs.length - 1].e).trim())
    segs = segs.slice(0, -1);
  return segs.map(({ s, e }) => {
    let cs = s;
    let ce = e;
    while (cs < ce && /\s/.test(line[cs])) cs++;
    while (ce > cs && /\s/.test(line[ce - 1])) ce--;
    if (cs === ce) {
      // Empty cell: land one space in from the opening pipe.
      cs = ce = Math.min(s + 1, e);
    }
    return {
      cellStart: lineStart + s,
      cellEnd: lineStart + e,
      contentStart: lineStart + cs,
      contentEnd: lineStart + ce,
    };
  });
}

/** Absolute [start, end] of each line in the region (end excludes the newline). */
function regionLines(text: string, region: Region): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let pos = region.start;
  for (const line of text.slice(region.start, region.end).split('\n')) {
    out.push({ start: pos, end: pos + line.length });
    pos += line.length + 1;
  }
  return out;
}

interface CellLocation {
  lineIdx: number;
  col: number;
  contentStart: number;
  contentEnd: number;
}

/** Which cell (by table LINE index) holds `offset`; padding/pipes clamp to it. */
function locateCell(text: string, region: Region, offset: number): CellLocation | null {
  if (offset < region.start || offset > region.end) return null;
  const lines = regionLines(text, region);
  let lineIdx = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    if (offset <= lines[i].end) {
      lineIdx = i;
      break;
    }
  }
  const spans = lineCellSpans(text, lines[lineIdx].start, lines[lineIdx].end);
  if (!spans.length) return null;
  let col = spans.findIndex((c) => offset >= c.cellStart && offset <= c.cellEnd);
  if (col === -1) col = offset < spans[0].cellStart ? 0 : spans.length - 1;
  const c = spans[col];
  return { lineIdx, col, contentStart: c.contentStart, contentEnd: c.contentEnd };
}

/**
 * §1.5: which cell an offset is in — row −1 for the header (the delimiter
 * row maps to the header level), body rows from 0. Offsets in padding or on
 * pipes clamp to the nearest cell's content span.
 */
export function cellAt(
  text: string,
  region: Region,
  offset: number
): { row: number; col: number; contentStart: number; contentEnd: number } | null {
  const loc = locateCell(text, region, offset);
  if (!loc) return null;
  return {
    row: loc.lineIdx <= 1 ? -1 : loc.lineIdx - 2,
    col: loc.col,
    contentStart: loc.contentStart,
    contentEnd: loc.contentEnd,
  };
}

/** Content span of a cell by row (−1 header) and column, or null. */
export function cellContentSpan(
  text: string,
  region: Region,
  row: number,
  col: number
): { start: number; end: number } | null {
  const lines = regionLines(text, region);
  const lineIdx = row === -1 ? 0 : row + 2;
  if (lineIdx < 0 || lineIdx >= lines.length) return null;
  const spans = lineCellSpans(text, lines[lineIdx].start, lines[lineIdx].end);
  const c = spans[Math.max(0, Math.min(col, spans.length - 1))];
  return c ? { start: c.contentStart, end: c.contentEnd } : null;
}

/**
 * §1.5: the region re-serialized to the aligned form, or null when it is
 * already aligned (so live mode never churns no-op transactions).
 */
export function normalizeTable(text: string, region: Region): TableEdit | null {
  const aligned = serializeTable(parseTable(text, region));
  if (text.slice(region.start, region.end) === aligned) return null;
  return {
    text: text.slice(0, region.start) + aligned + text.slice(region.end),
    start: region.start,
    end: region.start + aligned.length,
  };
}

/**
 * §1.5: normalization plus the cursor mapped to the SAME logical place —
 * same cell (line and column), same offset into the cell's content, clamped
 * to the content edge when it sat in padding.
 */
export function normalizeWithCursor(
  text: string,
  region: Region,
  head: number
): { text: string; start: number; end: number; head: number } {
  const n = normalizeTable(text, region);
  if (!n) return { text, start: region.start, end: region.end, head };
  const loc = locateCell(text, region, head);
  let newHead = n.start;
  if (loc) {
    const rel = Math.max(0, Math.min(head - loc.contentStart, loc.contentEnd - loc.contentStart));
    const newRegion = { start: n.start, end: n.end };
    const lines = regionLines(n.text, newRegion);
    const lineIdx = Math.min(loc.lineIdx, lines.length - 1);
    const spans = lineCellSpans(n.text, lines[lineIdx].start, lines[lineIdx].end);
    const c = spans[Math.max(0, Math.min(loc.col, spans.length - 1))];
    if (c) newHead = Math.min(c.contentStart + rel, c.contentEnd);
  }
  return { text: n.text, start: n.start, end: n.end, head: newHead };
}

// ---------------------------------------------------------------------------
// SPEC38 §2: the transient wrapped-grid layer.

/** §2.1: the CANONICAL form — one line per row, single-space gutters. */
export function serializeCompactTable(m: Pick<TableModel, 'header' | 'align' | 'rows'>): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  const delim = (a: ColAlign) =>
    a === 'center' ? ':---:' : a === 'left' ? ':---' : a === 'right' ? '---:' : '---';
  return [line(m.header), line(m.align.map(delim)), ...m.rows.map(line)].join('\n');
}

/** One wrapped fragment of a cell's logical content in the display text. */
export interface DisplayFragment {
  row: number; // −1 header
  col: number;
  frag: number;
  /** Offset of this fragment into the cell's logical (joined) content. */
  contentOffset: number;
  length: number;
  /** Fragment text span, relative to the display text's start. */
  from: number;
  to: number;
}

export interface DisplayLine {
  kind: 'cells' | 'separator';
  /** For cells: the logical row (−1 header). For separators: the row above. */
  row: number;
  frag: number;
  from: number;
  to: number;
}

export interface DisplayMap {
  widths: number[];
  lines: DisplayLine[];
  fragments: DisplayFragment[];
}

/**
 * The hard-break continuation marker: a fragment ending in it (at full
 * column width) continues its word on the next line WITHOUT a joining
 * space. Display-only — the parser strips it, the collapse never sees it.
 */
export const HARD_BREAK = '↩';

/** Word-wrap `content` into fragments of at most `width` chars (≥1 each). */
function wrapContent(content: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of content.split(/\s+/).filter(Boolean)) {
    let w = word;
    if (w.length > width) {
      // Over-long word: hard-break into full-width pieces, each carrying
      // width−1 content chars plus the continuation marker.
      if (line) {
        out.push(line);
        line = '';
      }
      while (w.length > width) {
        out.push(w.slice(0, width - 1) + HARD_BREAK);
        w = w.slice(width - 1);
      }
      line = w;
      continue;
    }
    if (!line) line = w;
    else if (line.length + 1 + w.length <= width) line += ` ${w}`;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line || out.length === 0) out.push(line);
  return out;
}

/**
 * §1/§2.2: the bordered grid. Column widths natural, shrunk widest-first to
 * the width budget (floor 8; if even the floors overflow, the grid may
 * exceed the budget). Long cell content word-wraps into continuation lines;
 * separator lines sit between every pair of logical rows, the first carrying
 * the real alignment markers. Cell whitespace normalizes to single spaces.
 */
export function layoutTable(
  m: Pick<TableModel, 'header' | 'align' | 'rows'>,
  widthBudget: number
): { text: string; map: DisplayMap } {
  const cols = m.header.length;
  const normalize = (raw: string) => raw.split(/\s+/).filter(Boolean).join(' ');
  const cells: string[][] = [m.header, ...m.rows].map((r) => r.map(normalize));

  const MIN = 8;
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(3, ...cells.map((r) => (r[c] ?? '').length))
  );
  const overhead = 3 * cols + 1; // '| ' + ' | '× + ' |'
  const budget = Math.max(cols * 3, widthBudget - overhead);
  let total = widths.reduce((a, b) => a + b, 0);
  while (total > budget) {
    let widest = -1;
    for (let c = 0; c < cols; c++) {
      if (widths[c] > MIN && (widest === -1 || widths[c] > widths[widest])) widest = c;
    }
    if (widest === -1) break; // all at the floor — graceful overflow
    widths[widest]--;
    total--;
  }

  const lines: string[] = [];
  const map: DisplayMap = { widths, lines: [], fragments: [] };
  let pos = 0;
  const pushLine = (entry: Omit<DisplayLine, 'from' | 'to'>, text: string) => {
    map.lines.push({ ...entry, from: pos, to: pos + text.length });
    lines.push(text);
    pos += text.length + 1;
  };
  const delimCell = (a: ColAlign, w: number) => {
    if (a === 'center') return `:${'-'.repeat(Math.max(1, w - 2))}:`;
    if (a === 'left') return `:${'-'.repeat(w - 1)}`;
    if (a === 'right') return `${'-'.repeat(w - 1)}:`;
    return '-'.repeat(w);
  };
  const separator = (row: number, aligned: boolean) =>
    pushLine(
      { kind: 'separator', row, frag: 0 },
      `| ${widths.map((w, c) => (aligned ? delimCell(m.align[c] ?? null, w) : '-'.repeat(w))).join(' | ')} |`
    );

  const rowBlock = (row: number, raw: string[]) => {
    const frags = raw.map((cell, c) => wrapContent(cell, widths[c]));
    const height = Math.max(1, ...frags.map((f) => f.length));
    for (let k = 0; k < height; k++) {
      const lineStart = pos;
      let x = 0;
      const parts: string[] = [];
      for (let c = 0; c < cols; c++) {
        const frag = frags[c][k] ?? '';
        // '| ' prefix + prior columns (width + ' | ' gutter each).
        const fragFrom = lineStart + 2 + x;
        parts.push(frag.padEnd(widths[c]));
        if (frag) {
          // Content offset: prior fragments contribute their LOGICAL length
          // plus a joint space — except hard-break pieces, which continue the
          // word directly (their marker is display-only).
          let co = 0;
          for (let j = 0; j < k; j++) {
            const prev = frags[c][j] ?? '';
            if (!prev) continue;
            const marked = prev.endsWith(HARD_BREAK);
            co += (marked ? prev.length - 1 : prev.length) + (marked ? 0 : 1);
          }
          const isMarked = frag.endsWith(HARD_BREAK);
          map.fragments.push({
            row,
            col: c,
            frag: k,
            contentOffset: co,
            length: isMarked ? frag.length - 1 : frag.length,
            from: fragFrom,
            to: fragFrom + frag.length,
          });
        }
        x += widths[c] + 3;
      }
      pushLine({ kind: 'cells', row, frag: k }, `| ${parts.join(' | ')} |`);
    }
  };

  rowBlock(-1, cells[0]);
  separator(-1, true);
  m.rows.forEach((_, i) => {
    rowBlock(i, cells[i + 1]);
    if (i < m.rows.length - 1) separator(i, false);
  });

  return { text: lines.join('\n'), map };
}

const SEP_CELL = /^:?-+:?$/;

export interface ParsedDisplay {
  model: TableModel;
  /** Per physical line of the region, in order. */
  lineInfo: Array<{ kind: 'cells' | 'separator'; row: number; frag: number }>;
}

/**
 * §2.3: the display grammar. Blocks of pipe lines split on separator lines
 * (every cell `:?-+:?`); block 0 is the header, the FIRST separator carries
 * the alignment, later blocks are body rows whose lines are per-cell
 * fragments joined with single spaces. Null on any violation: a pipe-less
 * line, ragged column counts, adjacent separators, or a dangling separator.
 */
export function parseDisplay(text: string, region: Region): ParsedDisplay | null {
  const lines = regionLines(text, region);
  if (lines.length < 2) return null;
  const cellsPerLine: string[][] = [];
  for (const l of lines) {
    if (!text.slice(l.start, l.end).includes('|')) return null;
    cellsPerLine.push(splitRow(text.slice(l.start, l.end)));
  }
  const cols = cellsPerLine[0].length;
  if (cols === 0) return null;
  if (cellsPerLine.some((c) => c.length !== cols)) return null;

  const lineInfo: ParsedDisplay['lineInfo'] = [];
  const blocks: number[][] = [[]]; // line indices per block
  const separators: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const isSep = cellsPerLine[i].every((c) => SEP_CELL.test(c));
    if (isSep) {
      if (blocks[blocks.length - 1].length === 0) return null; // adjacent/leading separator
      separators.push(i);
      blocks.push([]);
    } else {
      blocks[blocks.length - 1].push(i);
    }
  }
  if (separators.length === 0) return null; // no alignment separator
  // A trailing empty block is legal only for a zero-row table (one separator).
  if (blocks[blocks.length - 1].length === 0) {
    if (separators.length !== 1) return null;
    blocks.pop();
  }

  const align = cellsPerLine[separators[0]].map(parseAlign);
  const joinBlock = (blockIdx: number, c: number) => {
    let out = '';
    let pendingSpace = false;
    for (const li of blocks[blockIdx]) {
      const frag = cellsPerLine[li][c];
      if (!frag) continue;
      if (out && pendingSpace) out += ' ';
      if (frag.endsWith(HARD_BREAK)) {
        out += frag.slice(0, -1);
        pendingSpace = false; // the word continues directly
      } else {
        out += frag;
        pendingSpace = true;
      }
    }
    return out;
  };
  const header = Array.from({ length: cols }, (_, c) => joinBlock(0, c));
  const rows = blocks.slice(1).map((_, r) => Array.from({ length: cols }, (_, c) => joinBlock(r + 1, c)));

  // Per-line info: block b holds row b−1 (block 0 = header = row −1);
  // a separator carries the row of the block ABOVE it.
  let blockIdx = 0;
  let fragIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (separators.includes(i)) {
      lineInfo.push({ kind: 'separator', row: blockIdx - 1, frag: 0 });
      blockIdx++;
      fragIdx = 0;
    } else {
      lineInfo.push({ kind: 'cells', row: blockIdx - 1, frag: fragIdx });
      fragIdx++;
    }
  }

  return {
    model: { header, align, rows, start: region.start, end: region.end },
    lineInfo,
  };
}

/** §2.2: which cell holds a display offset — row −1 for header AND separators. */
export function displayCellAt(
  text: string,
  region: Region,
  parsed: ParsedDisplay,
  offset: number
): { row: number; col: number; contentOffset: number } | null {
  if (offset < region.start || offset > region.end) return null;
  const lines = regionLines(text, region);
  let idx = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    if (offset <= lines[i].end) {
      idx = i;
      break;
    }
  }
  const info = parsed.lineInfo[idx];
  const spans = lineCellSpans(text, lines[idx].start, lines[idx].end);
  if (!info || !spans.length) return null;
  let col = spans.findIndex((c) => offset >= c.cellStart && offset <= c.cellEnd);
  if (col === -1) col = offset < spans[0].cellStart ? 0 : spans.length - 1;
  if (info.kind === 'separator') return { row: -1, col, contentOffset: 0 };
  // Prior non-empty fragments of this cell contribute their LOGICAL length —
  // plus a joint space, except hard-break pieces (marker is display-only).
  let base = 0;
  for (let i = 0; i < idx; i++) {
    if (parsed.lineInfo[i].kind !== 'cells' || parsed.lineInfo[i].row !== info.row) continue;
    const frag = lineCellSpans(text, lines[i].start, lines[i].end)[col];
    if (!frag) continue;
    const len = frag.contentEnd - frag.contentStart;
    if (len <= 0) continue;
    const marked = text[frag.contentEnd - 1] === HARD_BREAK;
    base += (marked ? len - 1 : len) + (marked ? 0 : 1);
  }
  const c = spans[col];
  const hereMarked = c.contentEnd > c.contentStart && text[c.contentEnd - 1] === HARD_BREAK;
  const logicalLen = c.contentEnd - c.contentStart - (hereMarked ? 1 : 0);
  const within = Math.max(0, Math.min(offset - c.contentStart, logicalLen));
  return { row: info.row, col, contentOffset: base + within };
}

/** §2.2: where a (cell, content-offset) lands in the display (relative offset). */
export function displayPosOf(
  map: DisplayMap,
  loc: { row: number; col: number; contentOffset: number }
): number {
  const frags = map.fragments
    .filter((f) => f.row === loc.row && f.col === loc.col)
    .sort((a, b) => a.frag - b.frag);
  if (frags.length === 0) {
    // Empty cell: land at its content position on the row's first line.
    const line = map.lines.find((l) => l.kind === 'cells' && l.row === loc.row && l.frag === 0);
    if (!line) return 0;
    let x = 2;
    for (let c = 0; c < loc.col; c++) x += map.widths[c] + 3;
    return line.from + x;
  }
  for (const f of frags) {
    if (loc.contentOffset <= f.contentOffset + f.length) {
      return f.from + Math.max(0, loc.contentOffset - f.contentOffset);
    }
  }
  const last = frags[frags.length - 1];
  return last.to;
}

/**
 * §2.4: the round-trip guard — display text is trusted only if parsing and
 * re-laying-out reproduces it byte-for-byte. A plain GFM table fails (its
 * body rows would merge), which is what makes resynchronization safe.
 */
export function displayRoundTrips(text: string, region: Region, width: number): boolean {
  const parsed = parseDisplay(text, region);
  if (!parsed) return false;
  return layoutTable(parsed.model, width).text === text.slice(region.start, region.end);
}

// ---------------------------------------------------------------------------
// SPEC39 §4: confinement helpers.

/**
 * §2.5: flatten an insertion so it can never damage the grid — newlines and
 * carriage returns become spaces, unescaped pipes escape (already-escaped
 * `\|` pass through untouched).
 */
export function sanitizeCellInsert(text: string): string {
  return escapeCell(text.replace(/[\r\n]+/g, ' '));
}

/**
 * §2.3: the navigation target for Enter/Tab — the (row, col) one step in
 * `dir` from `loc` (row −1 = header; separators map there too), or null at
 * the ends. next/prev walk row-major, header included.
 */
export function cellNavTarget(
  model: Pick<TableModel, 'header' | 'rows'>,
  loc: { row: number; col: number },
  dir: 'up' | 'down' | 'next' | 'prev'
): { row: number; col: number } | null {
  const cols = model.header.length;
  const rows = model.rows.length;
  const col = Math.max(0, Math.min(loc.col, cols - 1));
  const row = Math.max(-1, Math.min(loc.row, rows - 1));
  if (dir === 'down') return row + 1 < rows ? { row: row + 1, col } : null;
  if (dir === 'up') return row - 1 >= -1 ? { row: row - 1, col } : null;
  const idx = (row + 1) * cols + col + (dir === 'next' ? 1 : -1);
  const max = (rows + 1) * cols - 1;
  if (idx < 0 || idx > max) return null;
  return { row: Math.floor(idx / cols) - 1, col: idx % cols };
}

/**
 * The caret's cell on its DISPLAY line: pipe-bounded segment plus trimmed
 * content span (absolute offsets) and the line's kind. Null outside the
 * region or on a pipe-less line.
 */
export function displayCellBounds(
  text: string,
  region: Region,
  parsed: ParsedDisplay,
  offset: number
): {
  kind: 'cells' | 'separator';
  row: number;
  col: number;
  cellStart: number;
  cellEnd: number;
  contentStart: number;
  contentEnd: number;
} | null {
  if (offset < region.start || offset > region.end) return null;
  const lines = regionLines(text, region);
  let idx = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    if (offset <= lines[i].end) {
      idx = i;
      break;
    }
  }
  const info = parsed.lineInfo[idx];
  const spans = lineCellSpans(text, lines[idx].start, lines[idx].end);
  if (!info || !spans.length) return null;
  let col = spans.findIndex((c) => offset >= c.cellStart && offset <= c.cellEnd);
  if (col === -1) col = offset < spans[0].cellStart ? 0 : spans.length - 1;
  const c = spans[col];
  return {
    kind: info.kind,
    row: info.kind === 'separator' ? -1 : info.row,
    col,
    cellStart: c.cellStart,
    cellEnd: c.cellEnd,
    contentStart: c.contentStart,
    contentEnd: c.contentEnd,
  };
}
