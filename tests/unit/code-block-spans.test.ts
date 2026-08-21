import { describe, expect, test } from 'vitest';
import { EditorState, type EditorStateConfig } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { computeCodeCards, type CodeCard } from '../../src/lib/codeBlockSpans';
import { codeBlockText } from '../../src/lib/codeCopy';

/** A state whose syntax tree is fully parsed (the live-preview tests' rig). */
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

/** The text pieces a card's hide spans would remove, in document order. */
const hiddenText = (state: EditorState, card: CodeCard): string[] =>
  card.hide.map((h) => state.doc.sliceString(h.from, h.to));

describe('Issue #157: fenced-code card spans', () => {
  test('U737: a fence with an info string hides both marks and the info; the card covers every block line', () => {
    const doc = 'intro\n\n```js\nconst a = 1;\n```\n\ntail\n';
    const state = mkState(doc); // caret at 0 — outside the block
    const cards = computeCodeCards(state, true);
    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card.revealed).toBe(false);
    expect(hiddenText(state, card)).toEqual(['```', 'js', '```']);
    // The delimiter lines stay (as blank card-padding rows) — the chrome
    // spans the opening fence, the body and the closing fence lines.
    expect(card.lines).toEqual([doc.indexOf('```js'), doc.indexOf('const'), doc.lastIndexOf('```')]);
    expect(card.from).toBe(doc.indexOf('```js'));
    expect(card.to).toBe(doc.lastIndexOf('```') + 3);
  });

  test('U738: a plain fence (no info string) hides exactly the two delimiter marks', () => {
    const doc = '```\ncode line\n```\n\ncursor parks here';
    const state = mkState(doc, { anchor: doc.length });
    const cards = computeCodeCards(state, true);
    expect(cards).toHaveLength(1);
    expect(hiddenText(state, cards[0])).toEqual(['```', '```']);
    expect(cards[0].lines).toHaveLength(3);
  });

  test('U739: a nested fence hides only the outer delimiters; an unterminated fence renders like the preview does', () => {
    const doc = '````\n```js\ninner\n```\n````\n\npark\n\n```\nstill open\n';
    const state = mkState(doc, { anchor: doc.indexOf('park') });
    const cards = computeCodeCards(state, true);
    expect(cards).toHaveLength(2);
    // Outer 4-backtick fence: the inner ``` lines are body text — no spans
    // touch them, only the outer marks hide.
    expect(hiddenText(state, cards[0])).toEqual(['````', '````']);
    expect(cards[0].lines).toHaveLength(5);
    // Unterminated fence: the preview shows one open-ended code block, so the
    // card does too — the opening mark hides, the chrome runs to the end.
    expect(hiddenText(state, cards[1])).toEqual(['```']);
    // The parser runs the open block through the trailing newline, so the
    // chrome covers the (empty) last line too — the open-ended card look.
    expect(cards[1].to).toBe(state.doc.length);
    expect(cards[1].lines).toHaveLength(3);
  });

  test('U740: caret inside a block reveals THAT block raw; the other stays rendered', () => {
    const doc = '```js\nfirst\n```\n\nmid\n\n```py\nsecond\n```\n';
    const inFirst = mkState(doc, { anchor: doc.indexOf('first') + 2 });
    const cards = computeCodeCards(inFirst, true);
    expect(cards).toHaveLength(2);
    expect(cards[0].revealed).toBe(true);
    expect(cards[0].hide).toEqual([]); // raw delimiters while editing inside
    expect(cards[1].revealed).toBe(false);
    expect(hiddenText(inFirst, cards[1])).toEqual(['```', 'py', '```']);
    // Moving the caret out re-renders: same doc, caret on the prose line.
    const outside = mkState(doc, { anchor: doc.indexOf('mid') });
    expect(computeCodeCards(outside, true).map((c) => c.revealed)).toEqual([false, false]);
  });

  test('U783: issue #163 — the body span is the interior lines, delimiters and info string excluded; codeBlockText mirrors the preview clipboard', () => {
    const doc = 'intro\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\ntail\n';
    const state = mkState(doc);
    const [card] = computeCodeCards(state, true);
    // The span runs from the line after the opening fence to the start of the
    // closing-fence line — so it carries the newline the closing delimiter
    // implies, exactly like the preview's <code> textContent…
    expect(state.doc.sliceString(card.body.from, card.body.to)).toBe('const a = 1;\nconst b = 2;\n');
    // …which is what lets codeBlockText be the ONLY trailing-newline rule.
    expect(codeBlockText(state.doc.sliceString(card.body.from, card.body.to))).toBe(
      'const a = 1;\nconst b = 2;'
    );
  });

  test('U784: issue #163 — a trailing blank body line is the block\'s own and survives the copy text', () => {
    const doc = '```\nkeep\n\n```\n';
    const state = mkState(doc);
    const [card] = computeCodeCards(state, true);
    expect(state.doc.sliceString(card.body.from, card.body.to)).toBe('keep\n\n');
    expect(codeBlockText(state.doc.sliceString(card.body.from, card.body.to))).toBe('keep\n');
  });

  test('U785: issue #163 — an empty block and a bare unclosed fence both carry an empty body', () => {
    const empty = mkState('```js\n```\n');
    expect(computeCodeCards(empty, true)[0].body).toMatchObject({ from: 6, to: 6 });
    const bare = mkState('```');
    const [card] = computeCodeCards(bare, true);
    expect(card.body.from).toBe(card.body.to);
  });

  test('U786: issue #163 — an unclosed fence\'s body runs from the line after the opener to the block end', () => {
    const doc = 'park\n\n```\nstill open\n';
    const state = mkState(doc);
    const [card] = computeCodeCards(state, true);
    // The parser runs the open block through the trailing newline (U739), so
    // the raw span ends with it — and codeBlockText takes exactly one off.
    expect(codeBlockText(state.doc.sliceString(card.body.from, card.body.to))).toBe('still open');
  });

  test('U741: disabled ⇒ no spans; a grid-overlapped block is excluded like SPEC41 §2.4', () => {
    const doc = 'a\n\n```\nx\n```\n';
    const state = mkState(doc);
    expect(computeCodeCards(state, false)).toEqual([]);
    // An excluded (table-grid) span overlapping the block drops its card.
    const from = doc.indexOf('```');
    expect(computeCodeCards(state, true, [{ from, to: from + 1 }])).toEqual([]);
    // A span elsewhere leaves it carded.
    expect(computeCodeCards(state, true, [{ from: 0, to: 1 }])).toHaveLength(1);
  });
});
