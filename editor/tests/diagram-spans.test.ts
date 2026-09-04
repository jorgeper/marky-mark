import { describe, expect, test } from 'vitest';
import { EditorState, type EditorStateConfig } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { computeDiagramSpans, sameDiagramDrawing } from '../src/lib/diagramSpans';

/** A state whose syntax tree is fully parsed (the code-block-spans rig). */
function mkState(doc: string, selection?: EditorStateConfig['selection']): EditorState {
  const state = EditorState.create({
    doc,
    selection,
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  // ensureSyntaxTree advances the shared parse context, but syntaxTree()
  // reads the state field's snapshot — a no-op update refreshes it.
  return state.update({}).state;
}

// Registration is what qualifies a fence — the tests inject a predicate, so
// no concrete language (and no registry mutation to restore) appears here.
const registered = (tag: string) => tag === 'x-diag' || tag === 'y-diag';

describe('PRD 013 Req 5: edit-pane diagram spans', () => {
  test('U754: a registered-language fence qualifies with full-line bounds and its body as source; unregistered fences are not returned at all', () => {
    const doc = 'intro\n\n```x-diag\nA --> B\n```\n\n```js\nconst a = 1;\n```\n\n```\nno info\n```\n';
    const spans = computeDiagramSpans(mkState(doc), true, registered);
    expect(spans).toHaveLength(1);
    const [s] = spans;
    expect(s.tag).toBe('x-diag');
    expect(s.source).toBe('A --> B');
    // The block widget replaces whole lines: opening fence through closing fence.
    expect(s.from).toBe(doc.indexOf('```x-diag'));
    expect(s.to).toBe(doc.indexOf('A --> B\n```') + 'A --> B\n```'.length);
    expect(s.revealed).toBe(false);
  });

  test('U755: the tag is read the seam’s way — case-folded, first word of the info string — so a second registered language qualifies with no code change', () => {
    const doc = '```X-Diag meta words\nbody\n```\n\n```y-diag\nother\n```\n';
    const spans = computeDiagramSpans(mkState(doc), true, registered);
    expect(spans.map((s) => s.tag)).toEqual(['x-diag', 'y-diag']);
    expect(spans.map((s) => s.source)).toEqual(['body', 'other']);
  });

  test('U756: caret inside reveals THAT block only, and both boundaries count as inside — a caret on a delimiter line reveals the block it opens', () => {
    const doc = '```x-diag\nfirst\n```\n\nmid\n\n```x-diag\nsecond\n```\n';
    const inFirst = computeDiagramSpans(mkState(doc, { anchor: doc.indexOf('first') }), true, registered);
    expect(inFirst.map((s) => s.revealed)).toEqual([true, false]);
    // Start boundary: caret at the very start of the opening fence line.
    const atOpen = computeDiagramSpans(mkState(doc, { anchor: 0 }), true, registered);
    expect(atOpen[0].revealed).toBe(true);
    // End boundary: caret at the end of the closing fence line.
    const closeEnd = doc.indexOf('first\n```') + 'first\n```'.length;
    const atClose = computeDiagramSpans(mkState(doc, { anchor: closeEnd }), true, registered);
    expect(atClose[0].revealed).toBe(true);
    // Moving the caret out re-renders: same doc, caret on the prose line.
    const outside = computeDiagramSpans(mkState(doc, { anchor: doc.indexOf('mid') }), true, registered);
    expect(outside.map((s) => s.revealed)).toEqual([false, false]);
  });

  test('U757: a fence overlapping an excluded (table-grid) span drops out entirely — the grid’s geometry owns those lines', () => {
    const doc = '```x-diag\nA --> B\n```\n\n```x-diag\nC --> D\n```\n';
    const second = doc.indexOf('```x-diag', 1);
    const spans = computeDiagramSpans(mkState(doc), true, registered, [
      { from: second, to: second + 5 },
    ]);
    expect(spans).toHaveLength(1);
    expect(spans[0].from).toBe(0);
  });

  test('U758: disabled ⇒ no spans, whatever the document holds', () => {
    const doc = '```x-diag\nA --> B\n```\n';
    expect(computeDiagramSpans(mkState(doc), false, registered)).toEqual([]);
  });
});

describe('PRD 015 Req 4: the span exposes the persisted width for the widget to draw', () => {
  test('U781: width comes from the full info string, tolerantly — a well-formed token reads, an absent or intolerable one is null (PRD 015 Req 3), and the document is never touched', () => {
    const doc =
      '```x-diag width=320\nA --> B\n```\n\n```x-diag\nC --> D\n```\n\n```x-diag width=12.5\nE --> F\n```\n';
    const state = mkState(doc);
    const spans = computeDiagramSpans(state, true, registered);
    expect(spans.map((s) => s.width)).toEqual([320, null, null]);
    // Reading mutated nothing: same state, same document text.
    expect(state.doc.toString()).toBe(doc);
  });

  test('U782: the drawing identity distinguishes two widths of the same source — and ignores position and reveal state', () => {
    const doc = '```x-diag width=320\nA --> B\n```\n';
    const [sized] = computeDiagramSpans(mkState(doc), true, registered);
    const resized = computeDiagramSpans(mkState(doc.replace('width=320', 'width=480')), true, registered)[0];
    const bare = computeDiagramSpans(mkState('```x-diag\nA --> B\n```\n'), true, registered)[0];
    expect(sameDiagramDrawing(sized, resized)).toBe(false); // width change ⇒ redraw
    expect(sameDiagramDrawing(sized, bare)).toBe(false); // width removed ⇒ redraw
    expect(sameDiagramDrawing(bare, { ...bare, from: 10, to: 40, revealed: true })).toBe(true);
    expect(sameDiagramDrawing(sized, { ...sized })).toBe(true);
  });
});
