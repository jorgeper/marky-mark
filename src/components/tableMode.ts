import { EditorState, StateEffect, StateField, Transaction, Prec, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import {
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
} from '../lib/tableEdit';

/**
 * SPEC38 §3: the transient wrapped-grid mode — pure CodeMirror. The buffer
 * holds the bordered display grid ONLY while the mode is active; every
 * deliberate exit collapses it back to the compact canonical table, and the
 * canonical view (canonicalizeDisplay) keeps the grid out of every artifact
 * that leaves the editor. The StateField tracks {span, width}; the
 * transactionFilter folds re-layout into user edits; the round-trip guard
 * (§2.4) is what makes resynchronization after undo/redo/foreign changes
 * safe — a state that isn't a byte-exact layout output exits the mode.
 */

export interface TableModeSpan {
  from: number;
  to: number;
  width: number;
}

export const setTableMode = StateEffect.define<TableModeSpan | null>();

/**
 * SPEC39 §2.2, the full-cell case: when the caret sits at a cell's inner
 * edge with no padding to advance into (the column's widest cell always
 * fills it exactly), a typed space is recorded here and the NEXT insertion
 * at that spot prepends it — so "hello world" survives even at the edge.
 * Any other activity clears it.
 */
const setPendingSpace = StateEffect.define<{ pos: number } | null>();
const pendingSpaceField = StateField.define<{ pos: number } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setPendingSpace)) return e.value;
    if (tr.docChanged || tr.selection) return null;
    return v;
  },
});

export const tableModeField = StateField.define<TableModeSpan | null>({
  create: () => null,
  update(value, tr) {
    if (value && tr.docChanged) {
      const from = tr.changes.mapPos(value.from, -1);
      const to = tr.changes.mapPos(value.to, 1);
      value = from < to ? { from, to, width: value.width } : null;
    }
    // Explicit effects win over mapping (they carry final coordinates).
    for (const e of tr.effects) if (e.is(setTableMode)) value = e.value;
    return value;
  },
});

/** §3: the grid wash on every display line while the mode is on. */
const tableModeDecos = EditorView.decorations.compute([tableModeField, 'doc'], (state) => {
  const span = state.field(tableModeField);
  if (!span) return Decoration.none;
  const b = new RangeSetBuilder<Decoration>();
  const first = state.doc.lineAt(Math.min(span.from, state.doc.length));
  const last = state.doc.lineAt(Math.min(span.to, state.doc.length));
  for (let n = first.number; n <= last.number; n++) {
    const l = state.doc.line(n);
    b.add(l.from, l.from, Decoration.line({ class: 'mm-table-mode-line' }));
  }
  return b.finish();
});

/**
 * §3.2 + SPEC39 §2: the live re-layout filter, now also the confinement
 * layer. Skips our own effect-carrying transactions, history transactions,
 * and IME composition. Ranged selections clamp to a single cell (SPEC39
 * §2.1); user doc changes inside the span must land in one cells-line cell
 * (else they are CANCELLED) and their inserted text is flattened (§2.5);
 * changes crossing the span boundary keep SPEC38's break-exit escape hatch.
 */
const alignFilter = EditorState.transactionFilter.of((tr) => {
  const span = tr.startState.field(tableModeField, false);
  if (!span) return tr;
  if (tr.effects.some((e) => e.is(setTableMode))) return tr;
  const ue = tr.annotation(Transaction.userEvent);
  if (ue && (ue.startsWith('undo') || ue.startsWith('redo'))) return tr;
  if (ue && ue.startsWith('input.type.compose')) return tr;

  // §2.1: selection-only transactions — clamp ranged selections to one cell.
  if (!tr.docChanged) {
    if (!tr.selection) return tr;
    const sel = tr.newSelection.main;
    if (sel.empty) return tr; // caret motion is free (arrows cross cells)
    const text = tr.startState.doc.toString();
    const region: Region = { start: span.from, end: span.to };
    const headIn = sel.head >= span.from && sel.head <= span.to;
    const anchorIn = sel.anchor >= span.from && sel.anchor <= span.to;
    const pivot = headIn ? sel.head : anchorIn ? sel.anchor : null;
    if (pivot === null) return tr; // both endpoints outside: allowed
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

  let touches = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (fromA <= span.to && toA >= span.from) touches = true;
  });
  if (!touches) return tr;

  const preText = tr.startState.doc.toString();
  const preRegion: Region = { start: span.from, end: span.to };
  if (!roundTripsAtOwnWidth(preText, preRegion)) return tr;

  // §2.5/§2.6: confinement of the changed ranges themselves.
  const ranges: Array<{ fromA: number; toA: number; ins: string }> = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, ins) =>
    ranges.push({ fromA, toA, ins: ins.toString() })
  );
  const crossesBoundary = ranges.some(
    (r) =>
      (r.fromA < span.from && r.toA > span.from) || (r.fromA < span.to && r.toA > span.to)
  );
  if (!crossesBoundary) {
    const parsedPre = parseDisplay(preText, preRegion)!;
    for (const r of ranges) {
      if (r.toA < span.from || r.fromA > span.to) continue; // outside: fine
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
        return []; // §2.6: structure is read-only from inside — cancel
      }
    }
    // §2.5: flatten the inserted text (single-range edits — the usual case);
    // §2.2: a pending edge-space rejoins the stream here.
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
        const l2 = layoutTable(parsed2.model, span.width);
        const loc2 = displayCellAt(nt, region2, parsed2, r.fromA + clean.length);
        const head2 = loc2 ? span.from + displayPosOf(l2.map, loc2) : span.from;
        return [
          { changes: { from: r.fromA, to: r.toA, insert: clean } },
          {
            changes: { from: region2.start, to: region2.end, insert: l2.text },
            selection: { anchor: head2 },
            effects: setTableMode.of({ from: span.from, to: span.from + l2.text.length, width: span.width }),
            sequential: true,
          },
        ];
      }
    }
  }

  const from = tr.changes.mapPos(span.from, -1);
  const to = tr.changes.mapPos(span.to, 1);
  const text = tr.newDoc.toString();
  const region: Region = { start: from, end: to };
  const parsed = parseDisplay(text, region);
  if (!parsed) return tr; // grammar broken — the watcher exits

  const l = layoutTable(parsed.model, span.width);
  if (text.slice(from, to) === l.text) {
    return [tr, { effects: setTableMode.of({ from, to, width: span.width }) }];
  }
  const head = tr.newSelection.main.head;
  const loc = displayCellAt(text, region, parsed, head);
  const newHead = loc
    ? from + displayPosOf(l.map, loc)
    : Math.min(head, from + l.text.length);
  return [
    tr,
    {
      changes: { from, to, insert: l.text },
      selection: { anchor: newHead },
      effects: setTableMode.of({ from, to: from + l.text.length, width: span.width }),
      sequential: true,
    },
  ];
});

/**
 * The round-trip guard at the display's OWN width (its first line's length —
 * the shrink pass is deterministic for a given target total, so a genuine
 * layout reproduces itself at that budget). This keeps undo across re-fits
 * inside the mode: an older-width grid still passes; the next edit re-lays
 * it out at the field's current budget.
 */
function roundTripsAtOwnWidth(text: string, region: Region): boolean {
  const nl = text.indexOf('\n', region.start);
  const firstLineEnd = nl === -1 || nl > region.end ? region.end : nl;
  return displayRoundTrips(text, region, firstLineEnd - region.start);
}

/** §3.3: resync — any foreign state that fails the guard exits the mode. */
const tableModeWatcher = EditorView.updateListener.of((u) => {
  if (!u.docChanged) return;
  const span = u.state.field(tableModeField);
  if (!span) return;
  if (u.transactions.some((t) => t.effects.some((e) => e.is(setTableMode)))) return;
  if (roundTripsAtOwnWidth(u.state.doc.toString(), { start: span.from, end: span.to })) return;
  // Dispatching from a listener needs its own tick; re-check state then.
  setTimeout(() => {
    const s2 = u.view.state.field(tableModeField);
    if (!s2) return;
    if (!roundTripsAtOwnWidth(u.view.state.doc.toString(), { start: s2.from, end: s2.to })) {
      u.view.dispatch({ effects: setTableMode.of(null) });
    }
  }, 0);
});

/** §3.1: the width budget in character columns, measured at entry.
 * clientWidth includes the content element's side paddings (SPEC6 geometry)
 * — subtract them, or near-budget lines soft-wrap and shred the grid. */
function measureWidthBudget(view: EditorView): number {
  const el = view.contentDOM;
  const cs = window.getComputedStyle(el);
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const px = (el.clientWidth || 640) - pad;
  const cw = view.defaultCharacterWidth || 8;
  return Math.max(40, Math.floor(px / cw) - 2);
}

/** §3.1: enter the mode on a GFM table region — one history event. */
export function enterTableMode(view: EditorView, region: Region): void {
  const text = view.state.doc.toString();
  const model = parseTable(text, region);
  const width = measureWidthBudget(view);
  const l = layoutTable(model, width);
  const head = view.state.selection.main.head;
  const c = cellAt(text, region, head);
  let anchor = region.start;
  if (c) {
    const co = Math.max(0, Math.min(head - c.contentStart, c.contentEnd - c.contentStart));
    anchor = region.start + displayPosOf(l.map, { row: c.row, col: c.col, contentOffset: co });
  }
  view.dispatch({
    changes: { from: region.start, to: region.end, insert: l.text },
    selection: { anchor },
    effects: setTableMode.of({ from: region.start, to: region.start + l.text.length, width }),
    annotations: isolateHistory.of('full'),
    scrollIntoView: true,
  });
}

/**
 * §3.4: a deliberate exit — collapse the display to the compact canonical
 * table (one history event, cursor kept at its logical cell) and clear the
 * field. An unparseable display just clears the field (the §3.3 fail path
 * already left honest text).
 */
export function exitTableMode(view: EditorView): void {
  const span = view.state.field(tableModeField, false);
  if (!span) return;
  const text = view.state.doc.toString();
  const region: Region = { start: span.from, end: span.to };
  const parsed = parseDisplay(text, region);
  if (!parsed) {
    view.dispatch({ effects: setTableMode.of(null) });
    return;
  }
  const compact = serializeCompactTable(parsed.model);
  const head = view.state.selection.main.head;
  const loc = displayCellAt(text, region, parsed, head);
  let anchor = Math.min(head, span.from + compact.length);
  if (loc) {
    const full = text.slice(0, span.from) + compact + text.slice(span.to);
    const cs = cellContentSpan(full, { start: span.from, end: span.from + compact.length }, loc.row, loc.col);
    if (cs) anchor = Math.min(cs.start + loc.contentOffset, cs.end);
  }
  view.dispatch({
    changes: { from: span.from, to: span.to, insert: compact },
    selection: { anchor },
    effects: setTableMode.of(null),
    annotations: isolateHistory.of('full'),
  });
}

/** §3.5: the canonical view — the display region collapsed, or `text` as-is. */
export function canonicalizeDisplay(text: string, span: TableModeSpan): string {
  const region: Region = { start: span.from, end: span.to };
  if (span.to > text.length) return text;
  const parsed = parseDisplay(text, region);
  if (!parsed) return text;
  return text.slice(0, span.from) + serializeCompactTable(parsed.model) + text.slice(span.to);
}

/** §3.4: Esc exits (registered AHEAD of the vim layer — first Esc leaves
 * table mode, the next one enters nav). */
const tableModeEsc = Prec.highest(
  EditorView.domEventHandlers({
    keydown: (e, view) => {
      if (e.key !== 'Escape' || e.isComposing) return false;
      if (!view.state.field(tableModeField)) return false;
      e.preventDefault();
      exitTableMode(view);
      return true;
    },
  })
);

/**
 * SPEC39 §1: live re-fit — geometry changes re-measure the budget on a
 * debounce and re-lay-out in place. UNRECORDED (a re-fit is not an edit).
 */
function refit(view: EditorView): void {
  const span = view.state.field(tableModeField, false);
  if (!span) return;
  const width = measureWidthBudget(view);
  if (width === span.width) return;
  const text = view.state.doc.toString();
  const region: Region = { start: span.from, end: span.to };
  const parsed = parseDisplay(text, region);
  if (!parsed) return;
  const l = layoutTable(parsed.model, width);
  if (l.text === text.slice(span.from, span.to)) {
    view.dispatch({ effects: setTableMode.of({ from: span.from, to: span.to, width }) });
    return;
  }
  const head = view.state.selection.main.head;
  const loc = displayCellAt(text, region, parsed, head);
  const anchor = loc ? span.from + displayPosOf(l.map, loc) : span.from;
  // Minimal changes: when the line count is unchanged (padding-only re-fit),
  // splice per line so history inverses rebase cleanly through the re-fit;
  // a re-wrap (line count changed) falls back to one region splice.
  const oldSlice = text.slice(span.from, span.to);
  const oldLines = oldSlice.split('\n');
  const newLines = l.text.split('\n');
  let changes: Array<{ from: number; to: number; insert: string }>;
  if (oldLines.length === newLines.length) {
    changes = [];
    let pos = span.from;
    for (let i = 0; i < oldLines.length; i++) {
      const a = oldLines[i];
      const b = newLines[i];
      if (a !== b) {
        let p = 0;
        const min = Math.min(a.length, b.length);
        while (p < min && a[p] === b[p]) p++;
        let s = 0;
        while (s < min - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
        changes.push({ from: pos + p, to: pos + a.length - s, insert: b.slice(p, b.length - s) });
      }
      pos += a.length + 1;
    }
  } else {
    changes = [{ from: span.from, to: span.to, insert: l.text }];
  }
  view.dispatch({
    changes,
    selection: { anchor },
    effects: setTableMode.of({ from: span.from, to: span.from + l.text.length, width }),
    annotations: Transaction.addToHistory.of(false),
  });
}

const refitPlugin = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    constructor(readonly view: EditorView) {}
    update(u: ViewUpdate) {
      if (!u.geometryChanged) return;
      if (!u.state.field(tableModeField)) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => refit(this.view), 150);
    }
    destroy() {
      clearTimeout(this.timer);
    }
  }
);

/** SPEC39 §2: the confinement keymap's shared context. */
function caretCell(view: EditorView): {
  span: TableModeSpan;
  parsed: ParsedDisplay;
  b: NonNullable<ReturnType<typeof displayCellBounds>>;
  head: number;
} | null {
  const span = view.state.field(tableModeField, false);
  if (!span) return null;
  const head = view.state.selection.main.head;
  if (head < span.from || head > span.to) return null;
  const text = view.state.doc.toString();
  const region: Region = { start: span.from, end: span.to };
  const parsed = parseDisplay(text, region);
  if (!parsed) return null;
  const b = displayCellBounds(text, region, parsed, head);
  return b ? { span, parsed, b, head } : null;
}

/** §2.3: Enter/Tab navigate cells; the caret lands at the target's content end. */
function navigate(view: EditorView, dir: 'up' | 'down' | 'next' | 'prev'): boolean {
  const ctx = caretCell(view);
  if (!ctx) return false;
  const target = cellNavTarget(ctx.parsed.model, { row: ctx.b.row, col: ctx.b.col }, dir);
  if (target) {
    const l = layoutTable(ctx.parsed.model, ctx.span.width); // guard ⇒ same map
    const pos =
      ctx.span.from + displayPosOf(l.map, { ...target, contentOffset: Number.MAX_SAFE_INTEGER });
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  }
  return true; // consumed even at the ends — Enter/Tab never insert (§2.3)
}

const confineKeymap = Prec.highest(
  keymap.of([
    { key: 'Enter', run: (v) => navigate(v, 'down'), shift: (v) => navigate(v, 'up') },
    { key: 'Tab', run: (v) => navigate(v, 'next'), shift: (v) => navigate(v, 'prev') },
    {
      // §2.1: ⌘A selects the current cell's content, not the document.
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
      // §2.4: Backspace at the cell content's start is inert.
      key: 'Backspace',
      run: (v) => {
        const ctx = caretCell(v);
        if (!ctx) return false;
        if (ctx.b.kind === 'separator') return true;
        return v.state.selection.main.empty && ctx.head <= ctx.b.contentStart;
      },
    },
    {
      // §2.4: Delete at the cell content's end is inert.
      key: 'Delete',
      run: (v) => {
        const ctx = caretCell(v);
        if (!ctx) return false;
        if (ctx.b.kind === 'separator') return true;
        return v.state.selection.main.empty && ctx.head >= ctx.b.contentEnd;
      },
    },
    {
      // §2.2: a space that trimming would delete advances the caret instead.
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
          // Full cell — no padding to park in: remember the space instead.
          v.dispatch({ effects: setPendingSpace.of({ pos: ctx.head }) });
        }
        return true;
      },
    },
  ])
);

/** The full mode bundle (register ahead of the vim layer). */
export function tableModeExtension() {
  return [
    tableModeField,
    pendingSpaceField,
    tableModeDecos,
    alignFilter,
    tableModeWatcher,
    tableModeEsc,
    confineKeymap,
    refitPlugin,
  ];
}
