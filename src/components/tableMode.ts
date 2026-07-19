import { EditorState, StateEffect, StateField, Transaction, Prec, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { normalizeWithCursor, tableRegionAt } from '../lib/tableEdit';

/**
 * SPEC37 §3: aligned table mode — pure CodeMirror. The mode is a StateField
 * holding the table's span (tracked precisely through every transaction via
 * changeset position mapping), a transactionFilter that FOLDS re-alignment
 * into any user transaction touching the span (one undo step for the edit
 * and its re-pad together), line decorations for the grid wash, and an Esc
 * handler that must be registered AHEAD of the vim layer.
 */

export const setTableMode = StateEffect.define<{ from: number; to: number } | null>();

export const tableModeField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(value, tr) {
    if (value && tr.docChanged) {
      const from = tr.changes.mapPos(value.from, -1);
      const to = tr.changes.mapPos(value.to, 1);
      value = from < to ? { from, to } : null;
    }
    // Explicit effects win over mapping (they carry final coordinates).
    for (const e of tr.effects) if (e.is(setTableMode)) value = e.value;
    return value;
  },
});

/** §3.4: every table line carries the grid wash while the mode is on. */
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
 * §3.3: the live-alignment filter. Skips history transactions (undo must
 * revert, never be re-fought) and IME composition (catches up on the first
 * post-composition transaction). When the table broke, the change passes
 * untouched and the watcher below exits the mode.
 */
const alignFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  const span = tr.startState.field(tableModeField, false);
  if (!span) return tr;
  const ue = tr.annotation(Transaction.userEvent);
  if (ue && (ue.startsWith('undo') || ue.startsWith('redo'))) return tr;
  if (ue && ue.startsWith('input.type.compose')) return tr;
  let touches = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (fromA <= span.to && toA >= span.from) touches = true;
  });
  if (!touches) return tr;

  const from = tr.changes.mapPos(span.from, -1);
  const to = tr.changes.mapPos(span.to, 1);
  const text = tr.newDoc.toString();
  const region = tableRegionAt(text, Math.min(from, text.length));
  if (!region || region.start > to || region.end < from) return tr; // broke — watcher exits

  const n = normalizeWithCursor(text, region, tr.newSelection.main.head);
  if (n.text === text) {
    // Already aligned; just snap the span to the region exactly.
    return [tr, { effects: setTableMode.of({ from: region.start, to: region.end }) }];
  }
  return [
    tr,
    {
      changes: { from: region.start, to: region.end, insert: n.text.slice(n.start, n.end) },
      selection: { anchor: n.head },
      effects: setTableMode.of({ from: n.start, to: n.end }),
      sequential: true,
    },
  ];
});

/** §3.5: the region ceasing to parse as a table exits the mode. */
const tableModeWatcher = EditorView.updateListener.of((u) => {
  if (!u.docChanged) return;
  const span = u.state.field(tableModeField);
  if (!span) return;
  const text = u.state.doc.toString();
  const region = tableRegionAt(text, Math.min(span.from, text.length));
  if (region && region.start <= span.to && region.end >= span.from) return;
  // Dispatching from a listener needs its own tick; re-check state then.
  setTimeout(() => {
    const s2 = u.view.state.field(tableModeField);
    if (!s2) return;
    const t2 = u.view.state.doc.toString();
    const r2 = tableRegionAt(t2, Math.min(s2.from, t2.length));
    if (!r2 || r2.start > s2.to || r2.end < s2.from) {
      u.view.dispatch({ effects: setTableMode.of(null) });
    }
  }, 0);
});

/**
 * §3.5: Esc exits the mode. A Prec.highest DOM handler — the Editor
 * registers this BEFORE the vim layer's own Prec.highest handler, so with
 * vimNav on the FIRST Esc leaves table mode and the next one enters nav.
 */
const tableModeEsc = Prec.highest(
  EditorView.domEventHandlers({
    keydown: (e, view) => {
      if (e.key !== 'Escape' || e.isComposing) return false;
      if (!view.state.field(tableModeField)) return false;
      e.preventDefault();
      view.dispatch({ effects: setTableMode.of(null) });
      return true;
    },
  })
);

/** The full aligned-table-mode bundle (register ahead of the vim layer). */
export function tableModeExtension() {
  return [tableModeField, tableModeDecos, alignFilter, tableModeWatcher, tableModeEsc];
}
