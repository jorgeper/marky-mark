import { EditorState, StateEffect, StateField, Transaction, Prec, RangeSetBuilder } from '@codemirror/state';
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
  layoutTable,
  parseDisplay,
  parseTable,
  sanitizeCellInsert,
  serializeCompactTable,
  type ParsedDisplay,
  type Region,
  type TableModel,
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
      const spans = value.spans
        .map((s) => {
          const from = tr.changes.mapPos(s.from, -1);
          const to = tr.changes.mapPos(s.to, 1);
          return from < to ? { ...s, from, to } : null;
        })
        .filter((s): s is GridSpan => s !== null);
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
    const b = displayCellBounds(text, region, parsed, pivot);
    if (!b || b.kind !== 'cells') {
      return [tr, { selection: { anchor: Math.max(span.from, Math.min(pivot, span.to)) } }];
    }
    const clamp = (p: number) => Math.max(b.contentStart, Math.min(p, b.contentEnd));
    const a2 = clamp(sel.anchor);
    const h2 = clamp(sel.head);
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
      return []; // structure is read-only from inside — cancel
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

/** Collapse one span to its canonical text: original bytes when the model is
 * untouched, the compact form when it was edited. Null when unparseable. */
function collapseSpan(text: string, span: GridSpan): string | null {
  const parsed = parseDisplay(text, { start: span.from, end: span.to });
  if (!parsed) return null;
  return modelSig(parsed.model) === span.sig ? span.original : serializeCompactTable(parsed.model);
}

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
 */
const tableModeWatcher = EditorView.updateListener.of((u) => {
  if (!u.docChanged) return;
  const set = u.state.field(tableModeField);
  if (!set) return; // view off
  if (u.transactions.some((t) => t.effects.some((e) => e.is(setGridSet)))) return;
  const text = u.state.doc.toString();
  const bad = set.spans.filter((s) => !roundTripsAtOwnWidth(text, { start: s.from, end: s.to }));
  const hasCandidates = allTableRegions(text).some(
    (r) => !set.spans.some((s) => r.start <= s.to && r.end >= s.from)
  );
  if (bad.length === 0 && !hasCandidates) return;
  setTimeout(() => {
    const s2 = u.view.state.field(tableModeField);
    if (!s2) return;
    const t2 = u.view.state.doc.toString();
    const good = s2.spans.filter((s) => roundTripsAtOwnWidth(t2, { start: s.from, end: s.to }));
    if (good.length !== s2.spans.length) {
      u.view.dispatch({ effects: setGridSet.of({ spans: good, width: s2.width }) });
    }
    gridifyAll(u.view);
  }, 0);
});

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
  return b ? { span, width: set.width, parsed, b, head } : null;
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
        if (ctx.b.kind !== 'cells') return true;
        v.dispatch({ selection: { anchor: ctx.b.contentStart, head: ctx.b.contentEnd } });
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
