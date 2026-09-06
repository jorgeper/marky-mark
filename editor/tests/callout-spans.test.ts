import { describe, expect, test } from 'vitest';
import { EditorState, type EditorStateConfig } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { computeCalloutViews } from '../src/lib/calloutSpans';

/** A state whose syntax tree is fully parsed (the link-spans rig). */
function mkState(doc: string, selection?: EditorStateConfig['selection']): EditorState {
  const state = EditorState.create({
    doc,
    selection,
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state.update({}).state;
}

const whole = (state: EditorState) => [{ from: 0, to: state.doc.length }];

// Issue #318: the edit-pane callout view's pure core.
describe('Issue #318: callout spans in the edit pane', () => {
  test('U1245: computeCalloutViews — the five kinds with their line ranges and marker spans; the marker line reveals on caret; non-callouts and nested quotes emit nothing', () => {
    const doc = [
      'intro',
      '',
      '> [!NOTE]',
      '> first body',
      '> second body',
      '',
      '> [!tip]',
      '',
      '> plain quote',
      '',
      '> [!HINT]',
      '> unknown kind',
      '',
      '> [!WARNING] trailing words',
      '',
      '> [!IMPORTANT]',
      '> > [!CAUTION]',
      '> > nested rides the parent',
      '',
      '>[!CAUTION]',
      '> tight marker',
      '',
      'tail',
    ].join('\n');
    const state = mkState(doc); // caret at 0 — outside every block
    const views = computeCalloutViews(state, whole(state));

    // Exactly the four callouts, in document order; the plain quote, the
    // unknown kind, the marker-with-trailing-words and the nested quote are
    // not emitted (the nested one is the parent's business).
    expect(views.map((v) => v.kind)).toEqual(['note', 'tip', 'important', 'caution']);
    expect(views.every((v) => !v.revealed)).toBe(true);

    const [note, tip, important, caution] = views;
    expect([note.firstLine, note.lastLine]).toEqual([3, 5]);
    expect(state.doc.sliceString(note.marker.from, note.marker.to)).toBe('[!NOTE]');
    // A one-line block: first and last line coincide; the lower-case marker
    // still resolves to its kind.
    expect([tip.firstLine, tip.lastLine]).toEqual([7, 7]);
    expect(state.doc.sliceString(tip.marker.from, tip.marker.to)).toBe('[!tip]');
    // The block with the nested quote spans all three of its lines.
    expect([important.firstLine, important.lastLine]).toEqual([16, 18]);
    // No blank after the quote mark is still a marker line.
    expect([caution.firstLine, caution.lastLine]).toEqual([20, 21]);
    expect(state.doc.sliceString(caution.marker.from, caution.marker.to)).toBe('[!CAUTION]');

    // Reveal: the caret on the marker line reveals THAT block's marker only;
    // on a body line of the same block it stays rendered.
    const onMarker = mkState(doc, { anchor: doc.indexOf('[!NOTE]') + 2 });
    const revealed = computeCalloutViews(onMarker, whole(onMarker));
    expect(revealed.map((v) => v.revealed)).toEqual([true, false, false, false]);
    const onBody = mkState(doc, { anchor: doc.indexOf('first body') });
    expect(computeCalloutViews(onBody, whole(onBody)).map((v) => v.revealed)).toEqual([false, false, false, false]);
    // A selection reaching into the marker line from above reveals it too.
    const spanning = mkState(doc, { anchor: 0, head: doc.indexOf('[!NOTE]') });
    expect(computeCalloutViews(spanning, whole(spanning))[0].revealed).toBe(true);

    // Excluded spans (grid regions) drop a block that overlaps them.
    const excluded = computeCalloutViews(state, whole(state), [{ from: doc.indexOf('[!tip]'), to: doc.indexOf('[!tip]') + 3 }]);
    expect(excluded.map((v) => v.kind)).toEqual(['note', 'important', 'caution']);

    // Out of the visible range ⇒ not computed.
    expect(computeCalloutViews(state, [{ from: 0, to: 5 }])).toEqual([]);
  });
});
