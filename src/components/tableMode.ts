import { EditorState, StateEffect, StateField, Transaction, Prec, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import {
  cellAt,
  cellContentSpan,
  displayCellAt,
  displayPosOf,
  displayRoundTrips,
  layoutTable,
  parseDisplay,
  parseTable,
  serializeCompactTable,
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
 * §3.2: the live re-layout filter. Skips our own entry/exit/op transactions
 * (they carry the mode effect), history transactions, and IME composition.
 * The pre-edit region must pass the round-trip guard — otherwise the change
 * passes untouched and the watcher exits the mode.
 */
const alignFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  const span = tr.startState.field(tableModeField, false);
  if (!span) return tr;
  if (tr.effects.some((e) => e.is(setTableMode))) return tr;
  const ue = tr.annotation(Transaction.userEvent);
  if (ue && (ue.startsWith('undo') || ue.startsWith('redo'))) return tr;
  if (ue && ue.startsWith('input.type.compose')) return tr;
  let touches = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (fromA <= span.to && toA >= span.from) touches = true;
  });
  if (!touches) return tr;

  const preText = tr.startState.doc.toString();
  if (!displayRoundTrips(preText, { start: span.from, end: span.to }, span.width)) return tr;

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

/** §3.3: resync — any foreign state that fails the guard exits the mode. */
const tableModeWatcher = EditorView.updateListener.of((u) => {
  if (!u.docChanged) return;
  const span = u.state.field(tableModeField);
  if (!span) return;
  if (u.transactions.some((t) => t.effects.some((e) => e.is(setTableMode)))) return;
  if (displayRoundTrips(u.state.doc.toString(), { start: span.from, end: span.to }, span.width)) return;
  // Dispatching from a listener needs its own tick; re-check state then.
  setTimeout(() => {
    const s2 = u.view.state.field(tableModeField);
    if (!s2) return;
    if (!displayRoundTrips(u.view.state.doc.toString(), { start: s2.from, end: s2.to }, s2.width)) {
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

/** The full mode bundle (register ahead of the vim layer). */
export function tableModeExtension() {
  return [tableModeField, tableModeDecos, alignFilter, tableModeWatcher, tableModeEsc];
}
