import {
  EditorState,
  MapMode,
  StateEffect,
  StateField,
  Transaction,
  Prec,
  RangeSetBuilder,
  type Line,
  type TransactionSpec,
} from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import {
  allTableRegions,
  cellAt,
  cellContentSpan,
  cellNavTarget,
  displayCellAt,
  displayCellBounds,
  displayPosOf,
  displayRoundTrips,
  displayWholeCellBounds,
  layoutTable,
  parseDisplay,
  parseTable,
  sanitizeCellInsert,
  serializeCompactTable,
  snapToCell,
  type ParsedDisplay,
  type Region,
  type TableModel,
  type WholeCellBounds,
} from '../lib/tableEdit';

/**
 * SPEC40: the grid is how tables LOOK in the editor — no mode. While the
 * tableGridView setting is on, EVERY valid top-level GFM table renders as
 * the SPEC38 bordered grid: transformed at mount and whenever a transaction
 * leaves a new valid table in the document, collapsed on unmount and when
 * the view flips off — all history-transparent, all invisible to the
 * canonical view (save/preview/drafts/dirty). Each tracked span remembers
 * its ORIGINAL source bytes: an untouched table collapses back to exactly
 * what the file contained, so opening and closing a document never rewrites
 * hand-formatted tables; an edited one collapses to the compact form.
 *
 * SPEC38's filter/guard/watcher and SPEC39's confinement/re-fit apply per
 * span. The round-trip guard (§SPEC38 2.4) still governs trust: a foreign
 * change that breaks one span drops THAT span to raw text (it re-grids as
 * soon as it parses again); the others live on.
 */

export interface GridSpan {
  from: number;
  to: number;
  /** The raw source bytes this grid was built from. */
  original: string;
  /** Model signature at gridify time — unchanged model ⇒ collapse to original. */
  sig: string;
}

export interface GridSet {
  /**
   * Sorted by `from` and non-overlapping. Every consumer leans on it, the
   * line-decoration builder most sharply: out-of-order spans make
   * `RangeSetBuilder.add` throw (issue #156). Producers sort; the mapping in
   * `tableModeField` below drops spans rather than break it.
   */
  spans: GridSpan[];
  width: number;
}

export const setGridSet = StateEffect.define<GridSet | null>();

const modelSig = (m: Pick<TableModel, 'header' | 'align' | 'rows'>): string =>
  JSON.stringify([m.header, m.align, m.rows]);

export const tableModeField = StateField.define<GridSet | null>({
  create: () => null,
  update(value, tr) {
    if (value && tr.docChanged) {
      // Issue #156: a span the change replaced outright — the tab-switch
      // whole-document replace in Editor.tsx — is GONE, not moved. Plain
      // mapPos collapsed each of them onto the insertion, so several grids
      // became the same {0, newLength} range and tableModeDecos re-walked
      // those lines once per span; RangeSetBuilder.add then threw on the
      // backwards `from`. TrackDel drops them instead, and the watcher
      // re-grids the new document's tables as soon as they parse.
      const spans: GridSpan[] = [];
      for (const s of value.spans) {
        const from = tr.changes.mapPos(s.from, -1, MapMode.TrackDel);
        const to = tr.changes.mapPos(s.to, 1, MapMode.TrackDel);
        if (from === null || to === null || from >= to) continue;
        // Mapping can also carry one span's end past the next span's start;
        // drop the loser so GridSet's sorted, non-overlapping invariant
        // survives the transaction.
        if (spans.length && from < spans[spans.length - 1].to) continue;
        spans.push({ ...s, from, to });
      }
      value = { spans, width: value.width };
    }
    for (const e of tr.effects) if (e.is(setGridSet)) value = e.value;
    return value;
  },
});

/** The span containing `pos`, if any. */
function spanAt(set: GridSet | null, pos: number): GridSpan | null {
  if (!set) return null;
  return set.spans.find((s) => pos >= s.from && pos <= s.to) ?? null;
}

/** SPEC39 §2.2: the one-shot pending edge-space (see the Space key below). */
const setPendingSpace = StateEffect.define<{ pos: number } | null>();
const pendingSpaceField = StateField.define<{ pos: number } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setPendingSpace)) return e.value;
    if (tr.docChanged || tr.selection) return null;
    return v;
  },
});

/** The grid wash on every line of every tracked span. */
const tableModeDecos = EditorView.decorations.compute([tableModeField, 'doc'], (state) => {
  const set = state.field(tableModeField);
  if (!set || set.spans.length === 0) return Decoration.none;
  const b = new RangeSetBuilder<Decoration>();
  for (const span of set.spans) {
    const first = state.doc.lineAt(Math.min(span.from, state.doc.length));
    const last = state.doc.lineAt(Math.min(span.to, state.doc.length));
    for (let n = first.number; n <= last.number; n++) {
      const l = state.doc.line(n);
      b.add(l.from, l.from, Decoration.line({ class: 'mm-table-mode-line' }));
    }
  }
  return b.finish();
});

/** The round-trip guard at a display's OWN width (SPEC39 — resync safety). */
function roundTripsAtOwnWidth(text: string, region: Region): boolean {
  const nl = text.indexOf('\n', region.start);
  const firstLineEnd = nl === -1 || nl > region.end ? region.end : nl;
  return displayRoundTrips(text, region, firstLineEnd - region.start);
}

/**
 * The live re-layout + confinement filter (SPEC38 §3.2, SPEC39 §2), applied
 * per span. Skips our own effect-carrying transactions, history, and IME.
 */
const alignFilter = EditorState.transactionFilter.of((tr) => {
  const set = tr.startState.field(tableModeField, false);
  if (!set || set.spans.length === 0) return tr;
  if (tr.effects.some((e) => e.is(setGridSet))) return tr;
  const ue = tr.annotation(Transaction.userEvent);
  if (ue && (ue.startsWith('undo') || ue.startsWith('redo'))) return tr;
  if (ue && ue.startsWith('input.type.compose')) return tr;

  // SPEC39 §2.1: ranged selections clamp to one cell of their pivot's span.
  if (!tr.docChanged) {
    if (!tr.selection) return tr;
    const sel = tr.newSelection.main;
    if (sel.empty) return tr;
    const text = tr.startState.doc.toString();
    const headSpan = spanAt(set, sel.head);
    const anchorSpan = spanAt(set, sel.anchor);
    const span = headSpan ?? anchorSpan;
    if (!span) return tr; // both endpoints outside every grid: allowed
    const pivot = headSpan ? sel.head : sel.anchor;
    const region: Region = { start: span.from, end: span.to };
    const parsed = parseDisplay(text, region);
    if (!parsed) return tr;
    // SPEC39 §2.1 (issue #346): the clamp target is the pivot's WHOLE cell
    // across its wrapped display lines — the per-line bounds cut a drag from
    // a cell's first line to its last down to the pivot line's fragment.
    let w = displayWholeCellBounds(text, region, parsed, pivot);
    if (w && w.kind !== 'cells' && headSpan && anchorSpan === headSpan) {
      // SPEC39 §2.1 (issue #346): a head walked onto a separator line
      // (Shift+ArrowDown/Up off the cell's last/first line) with the anchor
      // still in a cell of the same span clamps to the ANCHOR's cell rather
      // than collapsing, so the head lands at the cell's content end (down)
      // or content start (up). A separator head with no in-cell anchor
      // still collapses.
      const wa = displayWholeCellBounds(text, region, parsed, sel.anchor);
      if (wa && wa.kind === 'cells') w = wa;
    }
    if (!w || w.kind !== 'cells') {
      return [tr, { selection: { anchor: Math.max(span.from, Math.min(pivot, span.to)) } }];
    }
    // Endpoints in padding, pipes, the newline or another column's fragment
    // on an intermediate line snap onto the cell's own fragments; the range
    // stays ONE contiguous CodeMirror range across the wrapped lines.
    const a2 = snapToCell(w, sel.anchor);
    const h2 = snapToCell(w, sel.head);
    if (a2 === sel.anchor && h2 === sel.head) return tr;
    return [tr, { selection: { anchor: a2, head: h2 } }];
  }

  // Which span do the changes touch? Cross-boundary or multi-span edits pass
  // through (the watcher drops broken spans — the SPEC38 escape hatch).
  const ranges: Array<{ fromA: number; toA: number; ins: string }> = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, ins) =>
    ranges.push({ fromA, toA, ins: ins.toString() })
  );
  const touched = new Set<GridSpan>();
  let crossing = false;
  for (const r of ranges) {
    for (const s of set.spans) {
      const overlaps = r.fromA <= s.to && r.toA >= s.from;
      if (!overlaps) continue;
      touched.add(s);
      if ((r.fromA < s.from && r.toA > s.from) || (r.fromA < s.to && r.toA > s.to)) crossing = true;
    }
  }
  if (touched.size === 0) return tr;
  if (crossing || touched.size > 1) return tr;
  const span = [...touched][0];

  const preText = tr.startState.doc.toString();
  const preRegion: Region = { start: span.from, end: span.to };
  if (!roundTripsAtOwnWidth(preText, preRegion)) return tr;

  // SPEC39 §2.6: in-span changes must land inside ONE cells-line cell.
  const parsedPre = parseDisplay(preText, preRegion)!;
  for (const r of ranges) {
    if (r.toA < span.from || r.fromA > span.to) continue;
    const b1 = displayCellBounds(preText, preRegion, parsedPre, r.fromA);
    const b2 = displayCellBounds(preText, preRegion, parsedPre, r.toA);
    if (
      !b1 ||
      !b2 ||
      b1.kind !== 'cells' ||
      b1.cellStart !== b2.cellStart ||
      r.fromA < b1.cellStart ||
      r.toA > b1.cellEnd
    ) {
      // SPEC39 §2.6 (issue #346): one range covering several display lines
      // of ONE cell — a whole-cell selection typed over, deleted, cut or
      // pasted into — replaces the cell's logical content in the model and
      // re-lays the grid out, never splicing pipes, gutters or newlines.
      const whole = ranges.length === 1 ? wholeCellEdit(preText, preRegion, parsedPre, span, set.width, r) : null;
      if (whole) return whole;
      return []; // otherwise structure is read-only from inside — cancel
    }
  }

  // SPEC39 §2.5/§2.2: flatten single-range inserts; rejoin a pending space.
  if (ranges.length === 1) {
    const r = ranges[0];
    const pending = tr.startState.field(pendingSpaceField, false);
    const withPending =
      pending && r.fromA === pending.pos && r.toA === pending.pos && r.ins && !r.ins.startsWith(' ')
        ? ` ${r.ins}`
        : r.ins;
    const clean = sanitizeCellInsert(withPending);
    if (clean !== r.ins && r.toA >= span.from && r.fromA <= span.to) {
      const delta = clean.length - (r.toA - r.fromA);
      const nt = preText.slice(0, r.fromA) + clean + preText.slice(r.toA);
      const region2: Region = { start: span.from, end: span.to + delta };
      const parsed2 = parseDisplay(nt, region2);
      if (!parsed2) return [];
      const l2 = layoutTable(parsed2.model, set.width);
      const loc2 = displayCellAt(nt, region2, parsed2, r.fromA + clean.length);
      const head2 = loc2 ? span.from + displayPosOf(l2.map, loc2) : span.from;
      return [
        { changes: { from: r.fromA, to: r.toA, insert: clean } },
        {
          changes: { from: region2.start, to: region2.end, insert: l2.text },
          selection: { anchor: head2 },
          sequential: true,
        },
      ];
    }
  }

  const from = tr.changes.mapPos(span.from, -1);
  const to = tr.changes.mapPos(span.to, 1);
  const text = tr.newDoc.toString();
  const region: Region = { start: from, end: to };
  const parsed = parseDisplay(text, region);
  if (!parsed) return tr; // grammar broken — the watcher drops this span

  const l = layoutTable(parsed.model, set.width);
  if (text.slice(from, to) === l.text) return tr;
  const head = tr.newSelection.main.head;
  const loc = displayCellAt(text, region, parsed, head);
  const newHead = loc ? from + displayPosOf(l.map, loc) : Math.min(head, from + l.text.length);
  return [
    tr,
    {
      changes: { from, to, insert: l.text },
      selection: { anchor: newHead },
      sequential: true,
    },
  ];
});

/**
 * SPEC39 §2.6 (issue #346): the transaction that applies a single change
 * lying within ONE cell's whole-cell span (SPEC39 §2.1) but crossing its
 * display lines: the covered logical content is replaced by the sanitized
 * insert (§2.5) in the model, the grid re-laid out at the span's width, and
 * the caret lands after the insert — one document change, one undo step.
 * Null when the range's ends are not in the same cells-line cell or reach
 * outside its content.
 */
function wholeCellEdit(
  text: string,
  region: Region,
  parsed: ParsedDisplay,
  span: GridSpan,
  width: number,
  r: { fromA: number; toA: number; ins: string }
): TransactionSpec | null {
  const w1 = displayWholeCellBounds(text, region, parsed, r.fromA);
  const w2 = displayWholeCellBounds(text, region, parsed, r.toA);
  if (!w1 || !w2 || w1.kind !== 'cells' || w2.kind !== 'cells' || w1.row !== w2.row || w1.col !== w2.col) return null;
  if (r.fromA < w1.contentStart || r.toA > w1.contentEnd) return null;
  const from = displayCellAt(text, region, parsed, r.fromA);
  const to = displayCellAt(text, region, parsed, r.toA);
  if (!from || !to) return null;
  const m = parsed.model;
  const cell = (w1.row === -1 ? m.header : m.rows[w1.row])?.[w1.col];
  if (cell === undefined) return null;
  const clean = sanitizeCellInsert(r.ins);
  const content = cell.slice(0, from.contentOffset) + clean + cell.slice(to.contentOffset);
  const put = (cells: string[]) => cells.map((c, i) => (i === w1.col ? content : c));
  const header = w1.row === -1 ? put(m.header) : m.header;
  const rows = w1.row === -1 ? m.rows : m.rows.map((row, ri) => (ri === w1.row ? put(row) : row));
  const l = layoutTable({ header, align: m.align, rows }, width);
  const head =
    span.from + displayPosOf(l.map, { row: w1.row, col: w1.col, contentOffset: from.contentOffset + clean.length });
  return { changes: { from: span.from, to: span.to, insert: l.text }, selection: { anchor: head } };
}

/** Collapse one span to its canonical text, keeping the parse it took to get
 * there (`canonicalLineMapper` needs both). Null when unparseable. */
function collapseParsed(
  text: string,
  span: GridSpan
): { collapsed: string; parsed: ParsedDisplay } | null {
  const parsed = parseDisplay(text, { start: span.from, end: span.to });
  if (!parsed) return null;
  // The original bytes when the model is untouched, the compact form when it
  // was edited.
  const collapsed = modelSig(parsed.model) === span.sig ? span.original : serializeCompactTable(parsed.model);
  return { collapsed, parsed };
}

/** Collapse one span to its canonical text. Null when unparseable. */
function collapseSpan(text: string, span: GridSpan): string | null {
  return collapseParsed(text, span)?.collapsed ?? null;
}

const countNewlines = (s: string): number => {
  let n = 0;
  for (let i = s.indexOf('\n'); i !== -1; i = s.indexOf('\n', i + 1)) n++;
  return n;
};

/** SPEC40 §2.4: the canonical view — every tracked span collapsed. */
export function canonicalizeAll(text: string, set: GridSet): string {
  let out = text;
  for (const span of [...set.spans].sort((a, b) => b.from - a.from)) {
    const collapsed = collapseSpan(out, span);
    if (collapsed !== null) {
      out = out.slice(0, span.from) + collapsed + out.slice(span.to);
    }
  }
  return out;
}

/**
 * SPEC40 §2.4 + PRD 020 Req 18 (issue #260): the CANONICAL 1-based line a raw
 * editor line sits on.
 *
 * A gridded table occupies more lines on screen than in the file, so once a
 * document holds one every raw line below it is ahead of the canonical line
 * `canonicalText` hands the app. Anything that resolves an editor line
 * against the canonical buffer — the heading copy-link gutter's
 * `getUrl(line)` — must come through here first, or it silently misses:
 * that drift is why headings below the first table lost their copy-link
 * while the headings above kept theirs.
 *
 * Identity, and free, when no grid is tracked. Spans are sorted and
 * non-overlapping (`GridSet`), so the walk stops at the first one reaching
 * past `line`; a span that no longer parses is skipped exactly as
 * `canonicalizeAll` skips it, keeping the two arithmetics in step.
 */
export function canonicalLineAt(state: EditorState, line: Line): number {
  const set = state.field(tableModeField, false);
  if (!set || set.spans.length === 0) return line.number;
  const text = state.doc.toString();
  let canonical = line.number;
  for (const span of set.spans) {
    if (span.to > line.from) break;
    const collapsed = collapseSpan(text, span);
    if (collapsed === null) continue;
    canonical -= countNewlines(text.slice(span.from, span.to)) - countNewlines(collapsed);
  }
  return canonical;
}

/** One tracked span, prepared: where it sits in each coordinate system. */
interface MappedSpan {
  /** Its first raw editor line (1-based). */
  firstRaw: number;
  /** The canonical line that raw line is. */
  canonFirst: number;
  /** How many canonical lines it collapses to. */
  canonLines: number;
  parsed: ParsedDisplay;
}

/**
 * SPEC16 §2 (issue #264): the INVERSE of `canonicalLineAt` — given a CANONICAL
 * 1-based line, the raw editor lines it occupies. The changes-since-save sets
 * are computed by the app over the canonical buffer, but the decorations paint
 * raw editor lines, so without this every line below the first grid drifted
 * down by the grid's extra rows (the same drift issue #260 hit from the
 * other direction).
 *
 * Prepared once per state and then queried, because the overlay maps a whole
 * diff on every repaint: the walk costs a `doc.toString()` and a parse per
 * span, and that is paid here rather than per line.
 *
 * A grid is TALLER than its source, so the map is one-to-many: a canonical
 * table row is however many display rows its cells wrapped into, and the
 * canonical separator row is the grid's first separator (the one carrying
 * the alignment markers). A canonical line inside a span whose canonical text
 * is not the header/separator/rows shape every markdown table has degrades to
 * the span's first raw line rather than guessing an offset: a marker on the
 * table beats one on an unrelated line below it.
 *
 * Identity, and free, when no grid is tracked. Spans are skipped exactly as
 * `canonicalizeAll` and `canonicalLineAt` skip them, so all three
 * arithmetics stay in step. Yields [] for a canonical line past the
 * document's end (a stale set, mid-debounce).
 */
export function canonicalLineMapper(state: EditorState): (canonicalLine: number) => number[] {
  const lines = state.doc.lines;
  const inDoc = (n: number): number[] => (n >= 1 && n <= lines ? [n] : []);
  const set = state.field(tableModeField, false);
  if (!set || set.spans.length === 0) return inDoc;

  const text = state.doc.toString();
  const mapped: MappedSpan[] = [];
  let delta = 0; // raw line − canonical line, accumulated over earlier spans
  for (const span of set.spans) {
    const canon = collapseParsed(text, span);
    if (canon === null) continue; // canonicalizeAll left this one raw
    const firstRaw = state.doc.lineAt(span.from).number;
    const canonLines = countNewlines(canon.collapsed) + 1;
    mapped.push({ firstRaw, canonFirst: firstRaw - delta, canonLines, parsed: canon.parsed });
    delta += countNewlines(text.slice(span.from, span.to)) - (canonLines - 1);
  }
  const deltaBelowAll = delta;

  return (canonicalLine: number): number[] => {
    for (const span of mapped) {
      const deltaAbove = span.firstRaw - span.canonFirst; // what the earlier grids added
      if (canonicalLine < span.canonFirst) return inDoc(canonicalLine + deltaAbove);
      if (canonicalLine < span.canonFirst + span.canonLines) {
        const rows = spanDisplayRows(span, canonicalLine - span.canonFirst) ?? [0];
        return rows.map((i) => span.firstRaw + i).filter((n) => n <= lines);
      }
    }
    return inDoc(canonicalLine + deltaBelowAll);
  };
}

/**
 * SPEC16 §2 (issue #264): the display rows (0-based, within the span) a
 * canonical row of a collapsed table lives on. Canonical markdown tables are
 * always header / separator / one line per row, so the offset names the row;
 * the display repeats that row once per wrapped fragment. Null when the
 * canonical text is not that shape.
 */
function spanDisplayRows(span: MappedSpan, offset: number): number[] | null {
  const { lineInfo, model } = span.parsed;
  if (span.canonLines !== model.rows.length + 2) return null;
  // The canonical separator is the grid's FIRST one — the row carrying the
  // alignment markers; the later ones are the grid's between-row rules.
  if (offset === 1) {
    const i = lineInfo.findIndex((info) => info.kind === 'separator');
    return i === -1 ? null : [i];
  }
  const wanted = offset === 0 ? -1 : offset - 2; // 0 header (row −1), 2+k row k
  const rows = lineInfo.flatMap((info, i) => (info.kind === 'cells' && info.row === wanted ? [i] : []));
  return rows.length ? rows : null;
}

/** SPEC40 §2.2: grid every untracked valid table (history-transparent). */
export function gridifyAll(view: EditorView, canonicalHint?: string): void {
  const set = view.state.field(tableModeField, false) ?? null;
  const width = measureWidthBudget(view);
  const text = view.state.doc.toString();
  const existing = set?.spans ?? [];
  const candidates = allTableRegions(text).filter(
    (r) => !existing.some((s) => r.start <= s.to && r.end >= s.from)
  );
  // Adoption loses the original source bytes (the field is not serialized
  // across remounts) — recover them from the canonical buffer by model
  // signature, so untouched padded tables still collapse byte-identically.
  const hintRegions = canonicalHint
    ? allTableRegions(canonicalHint).map((r) => ({
        bytes: canonicalHint.slice(r.start, r.end),
        sig: modelSig(parseTable(canonicalHint, r)),
        used: false,
      }))
    : [];
  const originalFor = (sig: string, fallback: string): string => {
    const h = hintRegions.find((x) => !x.used && x.sig === sig);
    if (h) {
      h.used = true;
      return h.bytes;
    }
    return fallback;
  };
  if (candidates.length === 0) {
    if (set && set.width !== width) {
      view.dispatch({ effects: setGridSet.of({ spans: existing, width }) });
    } else if (!set) {
      view.dispatch({ effects: setGridSet.of({ spans: [], width }) });
    }
    return;
  }
  const sel = view.state.selection.main;
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  // A candidate that is ALREADY display-shaped (an undo just restored a
  // grid we dropped) is ADOPTED as tracked text, never re-parsed as a raw
  // table — parseTable would read its separators as dash-filled body rows.
  const adopted: GridSpan[] = [];
  const rawCandidates = candidates.filter((r) => {
    if (!roundTripsAtOwnWidth(text, r)) return true;
    const model = parseDisplay(text, r)!.model;
    const sig = modelSig(model);
    adopted.push({
      from: r.start,
      to: r.end,
      original: originalFor(sig, serializeCompactTable(model)),
      sig,
    });
    return false;
  });
  // Per-candidate grid text + growth, in ascending order.
  const grids = rawCandidates.map((r) => {
    const original = text.slice(r.start, r.end);
    const model = parseTable(text, r);
    const l = layoutTable(model, width);
    changes.push({ from: r.start, to: r.end, insert: l.text });
    return { r, original, model, l, grow: l.text.length - (r.end - r.start) };
  });
  const growBefore = (pos: number) =>
    grids.reduce((acc, g) => (g.r.end <= pos ? acc + g.grow : acc), 0);
  // Map a selection endpoint: inside a candidate → its logical cell in the
  // grid; outside → shifted by the growth of candidates before it.
  const mapPoint = (p: number): number => {
    for (const g of grids) {
      if (p >= g.r.start && p <= g.r.end) {
        const c = cellAt(text, g.r, p);
        const co = c ? Math.max(0, Math.min(p - c.contentStart, c.contentEnd - c.contentStart)) : 0;
        return (
          g.r.start +
          growBefore(g.r.start) +
          (c ? displayPosOf(g.l.map, { row: c.row, col: c.col, contentOffset: co }) : 0)
        );
      }
    }
    return p + growBefore(p);
  };
  const inAny = (p: number) => grids.some((g) => p >= g.r.start && p <= g.r.end);
  const newSpans: GridSpan[] = existing.map((s) => ({
    ...s,
    from: s.from + growBefore(s.from),
    to: s.to + growBefore(s.from),
  }));
  for (const a of adopted) {
    newSpans.push({ ...a, from: a.from + growBefore(a.from), to: a.to + growBefore(a.from) });
  }
  for (const g of grids) {
    const start = g.r.start + growBefore(g.r.start);
    newSpans.push({ from: start, to: start + g.l.text.length, original: g.original, sig: modelSig(g.model) });
  }
  newSpans.sort((a, b) => a.from - b.from);
  view.dispatch({
    ...(changes.length ? { changes } : {}),
    // Explicit selection only when an endpoint sits inside a transformed
    // region (CM's own mapping handles the rest).
    ...(changes.length && (inAny(sel.anchor) || inAny(sel.head))
      ? { selection: { anchor: mapPoint(sel.anchor), head: mapPoint(sel.head) } }
      : {}),
    effects: setGridSet.of({ spans: newSpans, width }),
    annotations: Transaction.addToHistory.of(false),
  });
}

/** SPEC40 §1.3: collapse every grid (history-transparent); view off/unmount. */
export function collapseAllGrids(view: EditorView): void {
  const set = view.state.field(tableModeField, false);
  if (!set || set.spans.length === 0) {
    if (set) view.dispatch({ effects: setGridSet.of(null) });
    return;
  }
  const text = view.state.doc.toString();
  const head = view.state.selection.main.head;
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  let anchor: number | null = null;
  let delta = 0; // earlier spans shrink — the final anchor shifts with them
  for (const span of [...set.spans].sort((a, b) => a.from - b.from)) {
    const collapsed = collapseSpan(text, span);
    if (collapsed === null) continue;
    changes.push({ from: span.from, to: span.to, insert: collapsed });
    if (head >= span.from && head <= span.to) {
      const region: Region = { start: span.from, end: span.to };
      const parsed = parseDisplay(text, region)!;
      const loc = displayCellAt(text, region, parsed, head);
      if (loc) {
        const cs = cellContentSpan(collapsed, { start: 0, end: collapsed.length }, loc.row, loc.col);
        if (cs) anchor = span.from + delta + Math.min(cs.start + loc.contentOffset, cs.end);
      }
    }
    delta += collapsed.length - (span.to - span.from);
  }
  view.dispatch({
    ...(changes.length ? { changes } : {}),
    ...(anchor !== null ? { selection: { anchor } } : {}),
    effects: setGridSet.of(null),
    annotations: Transaction.addToHistory.of(false),
  });
}

/**
 * Resync + detection: after any foreign doc change, drop spans that fail the
 * guard (they stay raw until they parse again) and grid any new valid table.
 * DEBOUNCED, not merely deferred: a snap landing between two keystrokes of a
 * fast burst rewrites the region under the typing caret — mapPoint sends a
 * delimiter-row caret into the header row, so the keystrokes still in flight
 * garble the header (E119b). Waiting for a pause keeps the snap out of the
 * middle of a typed delimiter; DELIM accepts partial rows like "| -", so
 * mid-row candidates are common while one is being typed.
 */
const SNAP_DEBOUNCE_MS = 250;
const tableModeWatcher = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    constructor(readonly view: EditorView) {}
    update(u: ViewUpdate) {
      if (!u.docChanged) return;
      const set = u.state.field(tableModeField);
      if (!set) return; // view off
      if (u.transactions.some((t) => t.effects.some((e) => e.is(setGridSet)))) return;
      const text = u.state.doc.toString();
      const hasBroken = set.spans.some((s) => !roundTripsAtOwnWidth(text, { start: s.from, end: s.to }));
      const hasCandidates = allTableRegions(text).some(
        (r) => !set.spans.some((s) => r.start <= s.to && r.end >= s.from)
      );
      if (!hasBroken && !hasCandidates) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const s2 = this.view.state.field(tableModeField);
        if (!s2) return;
        const t2 = this.view.state.doc.toString();
        const good = s2.spans.filter((s) => roundTripsAtOwnWidth(t2, { start: s.from, end: s.to }));
        if (good.length !== s2.spans.length) {
          this.view.dispatch({ effects: setGridSet.of({ spans: good, width: s2.width }) });
        }
        gridifyAll(this.view);
      }, SNAP_DEBOUNCE_MS);
    }
    destroy() {
      clearTimeout(this.timer);
    }
  }
);

/** The width budget in character columns (SPEC38 §3.1 measurement). */
function measureWidthBudget(view: EditorView): number {
  const el = view.contentDOM;
  const cs = window.getComputedStyle(el);
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const px = (el.clientWidth || 640) - pad;
  const cw = view.defaultCharacterWidth || 8;
  return Math.max(40, Math.floor(px / cw) - 2);
}

/** SPEC39 §1: live re-fit for EVERY grid on geometry changes (unrecorded). */
function refit(view: EditorView): void {
  const set = view.state.field(tableModeField, false);
  if (!set || set.spans.length === 0) return;
  const width = measureWidthBudget(view);
  if (width === set.width) return;
  const text = view.state.doc.toString();
  const head = view.state.selection.main.head;
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  const newSpans: GridSpan[] = [];
  let delta = 0;
  let anchor: number | null = null;
  for (const span of set.spans) {
    const region: Region = { start: span.from, end: span.to };
    const parsed = parseDisplay(text, region);
    if (!parsed) {
      newSpans.push({ ...span, from: span.from + delta, to: span.to + delta });
      continue;
    }
    const l = layoutTable(parsed.model, width);
    const old = text.slice(span.from, span.to);
    if (l.text !== old) {
      changes.push({ from: span.from, to: span.to, insert: l.text });
      if (head >= span.from && head <= span.to) {
        const loc = displayCellAt(text, region, parsed, head);
        if (loc) anchor = span.from + delta + displayPosOf(l.map, loc);
      }
    }
    newSpans.push({
      ...span,
      from: span.from + delta,
      to: span.from + delta + l.text.length,
    });
    delta += l.text.length - old.length;
  }
  view.dispatch({
    ...(changes.length ? { changes } : {}),
    ...(anchor !== null ? { selection: { anchor } } : {}),
    effects: setGridSet.of({ spans: newSpans, width }),
    annotations: Transaction.addToHistory.of(false),
  });
}

const refitPlugin = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    last = 0;
    constructor(readonly view: EditorView) {}
    update(u: ViewUpdate) {
      if (!u.geometryChanged) return;
      if (!u.state.field(tableModeField)) return;
      // Leading + trailing THROTTLE, not a debounce: a continuous divider or
      // window drag emits geometry changes non-stop, and a trailing-only
      // debounce left the grids frozen at the old width until the drag
      // paused — an ugly beat of overflow. Re-fit at once, then at most
      // every 66ms while the drag continues (refit() no-ops when the
      // measured budget is unchanged, so the churn is bounded).
      clearTimeout(this.timer);
      const since = performance.now() - this.last;
      this.timer = setTimeout(() => {
        this.last = performance.now();
        refit(this.view);
      }, since >= 66 ? 0 : 66 - since);
    }
    destroy() {
      clearTimeout(this.timer);
    }
  }
);

/** SPEC39 §2: the confinement keymap's shared context — the caret's grid. */
function caretCell(view: EditorView): {
  span: GridSpan;
  width: number;
  parsed: ParsedDisplay;
  b: NonNullable<ReturnType<typeof displayCellBounds>>;
  /** SPEC39 §2.1 (issue #346): the same cell across its wrapped lines (same kind as `b`). */
  w: WholeCellBounds;
  head: number;
} | null {
  const set = view.state.field(tableModeField, false);
  if (!set) return null;
  const head = view.state.selection.main.head;
  const span = spanAt(set, head);
  if (!span) return null;
  const text = view.state.doc.toString();
  const region: Region = { start: span.from, end: span.to };
  const parsed = parseDisplay(text, region);
  if (!parsed) return null;
  const b = displayCellBounds(text, region, parsed, head);
  const w = displayWholeCellBounds(text, region, parsed, head);
  if (!b || !w) return null;
  return { span, width: set.width, parsed, b, w, head };
}

/** §2.3: Enter/Tab navigate cells; the caret lands at the target's content end. */
function navigate(view: EditorView, dir: 'up' | 'down' | 'next' | 'prev'): boolean {
  const ctx = caretCell(view);
  if (!ctx) return false;
  const target = cellNavTarget(ctx.parsed.model, { row: ctx.b.row, col: ctx.b.col }, dir);
  if (target) {
    const l = layoutTable(ctx.parsed.model, ctx.width); // guard ⇒ same map
    const pos =
      ctx.span.from + displayPosOf(l.map, { ...target, contentOffset: Number.MAX_SAFE_INTEGER });
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  }
  return true; // consumed even at the ends — Enter/Tab never insert
}

const confineKeymap = Prec.highest(
  keymap.of([
    { key: 'Enter', run: (v) => navigate(v, 'down'), shift: (v) => navigate(v, 'up') },
    { key: 'Tab', run: (v) => navigate(v, 'next'), shift: (v) => navigate(v, 'prev') },
    {
      key: 'Mod-a',
      run: (v) => {
        const ctx = caretCell(v);
        if (!ctx) return false;
        if (ctx.w.kind !== 'cells') return true;
        // SPEC39 §2.1 (issue #346): ⌘A selects the WHOLE cell across its
        // wrapped lines; when the selection already is that cell, it is not
        // consumed — selectAll runs and the SPEC38 escape hatch (both ends
        // outside the grid) lets the document-wide selection through.
        const main = v.state.selection.main;
        if (!main.empty && main.from === ctx.w.contentStart && main.to === ctx.w.contentEnd) return false;
        v.dispatch({ selection: { anchor: ctx.w.contentStart, head: ctx.w.contentEnd } });
        return true;
      },
    },
    {
      key: 'Backspace',
      run: (v) => {
        const ctx = caretCell(v);
        if (!ctx) return false;
        if (ctx.b.kind === 'separator') return true;
        return v.state.selection.main.empty && ctx.head <= ctx.b.contentStart;
      },
    },
    {
      key: 'Delete',
      run: (v) => {
        const ctx = caretCell(v);
        if (!ctx) return false;
        if (ctx.b.kind === 'separator') return true;
        return v.state.selection.main.empty && ctx.head >= ctx.b.contentEnd;
      },
    },
    {
      key: 'Space',
      run: (v) => {
        const ctx = caretCell(v);
        if (!ctx) return false;
        if (ctx.b.kind === 'separator') return true;
        if (!v.state.selection.main.empty) return false;
        if (ctx.head < ctx.b.contentEnd) return false; // interior spaces insert
        const cap = Math.max(ctx.b.cellEnd - 1, ctx.b.contentEnd);
        const pos = Math.min(ctx.head + 1, cap);
        if (pos !== ctx.head) {
          v.dispatch({ selection: { anchor: pos } });
        } else {
          v.dispatch({ effects: setPendingSpace.of({ pos: ctx.head }) });
        }
        return true;
      },
    },
  ])
);

/**
 * SPEC40: field-free canonicalization — collapse every region that parses
 * as a genuine grid to its compact form. Used to compare "same document,
 * different dress" when no field is available (a remount restoring parked
 * grid state before the buffer catches up must NOT converge — a recorded
 * full-doc converge would poison undo history).
 */
export function canonicalizeDetected(text: string): string {
  let out = text;
  for (const r of allTableRegions(text).sort((a, b) => b.start - a.start)) {
    // Grid regions collapse via the display grammar; raw tables normalize
    // through the plain parser — BOTH dresses land on the compact form, so
    // decorative padding differences never read as real divergence.
    const model = roundTripsAtOwnWidth(out, r) ? parseDisplay(out, r)?.model : parseTable(out, r);
    if (model) {
      out = out.slice(0, r.start) + serializeCompactTable(model) + out.slice(r.end);
    }
  }
  return out;
}

/** The full grid-view bundle (register ahead of the vim layer). */
export function tableModeExtension() {
  return [
    tableModeField,
    pendingSpaceField,
    tableModeDecos,
    alignFilter,
    tableModeWatcher,
    confineKeymap,
    refitPlugin,
  ];
}
