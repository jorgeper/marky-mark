import { describe, expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { setGridSet, tableModeField, tableModeExtension } from '../../src/components/tableMode';

// Issue #156: switching file tabs swaps documents with one whole-document
// replace (Editor.tsx's [value] effect). tableModeField used to map every
// stale grid span through that change with plain mapPos, collapsing them ALL
// onto {0, newLength} — tableModeDecos then walked the same lines once per
// span and RangeSetBuilder.add threw "Ranges must be added sorted by `from`
// position and `startSide`". A span whose text was deleted outright must
// drop, not collapse onto the insertion.

const T1 = '| a | b |\n| --- | --- |\n| 1 | 2 |';
const T2 = '| x | y |\n| --- | --- |\n| 3 | 4 |';
const DOC = `intro\n\n${T1}\n\nmiddle\n\n${T2}\n\noutro`;

/** A state tracking both tables as grid spans, like the live editor does. */
function gridded(): EditorState {
  const state = EditorState.create({ doc: DOC, extensions: tableModeExtension() });
  const spans = [
    { from: DOC.indexOf(T1), to: DOC.indexOf(T1) + T1.length, original: T1, sig: 's1' },
    { from: DOC.indexOf(T2), to: DOC.indexOf(T2) + T2.length, original: T2, sig: 's2' },
  ];
  return state.update({ effects: setGridSet.of({ spans, width: 80 }) }).state;
}

/** Realize every decoration set the state provides, as a mounted view would. */
function computeDecos(state: EditorState): void {
  for (const d of state.facet(EditorView.decorations)) {
    if (typeof d !== 'function') void d.size;
  }
}

describe('Issue #156: grid spans across a whole-document replace', () => {
  test('U719: a tab-switch full-doc replace drops every stale span — the decorations still assemble', () => {
    const state = gridded();
    const NEXT = `other doc\n\n${T1}\n\nwith\nmore\nlines`;
    let after: EditorState | null = null;
    expect(() => {
      after = state.update({
        changes: { from: 0, to: state.doc.length, insert: NEXT },
      }).state;
      computeDecos(after);
    }).not.toThrow();
    // The old document's spans are gone (the watcher re-grids the new one);
    // nothing coincides on {0, newLength}.
    expect(after!.field(tableModeField)!.spans).toEqual([]);
  });

  test('U720: an in-span edit still maps the spans instead of dropping them', () => {
    const state = gridded();
    const at = DOC.indexOf('| 1') + 2; // inside T1's body row
    const after = state.update({ changes: { from: at, insert: 'x' } }).state;
    const spans = after.field(tableModeField)!.spans.map((s) => ({ from: s.from, to: s.to }));
    expect(spans).toEqual([
      { from: DOC.indexOf(T1), to: DOC.indexOf(T1) + T1.length + 1 },
      { from: DOC.indexOf(T2) + 1, to: DOC.indexOf(T2) + T2.length + 1 },
    ]);
    computeDecos(after); // still in order
  });

  test('U721: a deletion swallowing one span boundary drops that span alone', () => {
    const state = gridded();
    const t1 = DOC.indexOf(T1);
    // Eat across T1's start: its boundary text is destroyed, T2 is untouched.
    const after = state.update({ changes: { from: t1 - 1, to: t1 + 5, insert: '' } }).state;
    const spans = after.field(tableModeField)!.spans;
    expect(spans).toHaveLength(1);
    expect(spans[0].original).toBe(T2);
    computeDecos(after);
  });
});
