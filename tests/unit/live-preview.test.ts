import { describe, expect, test } from 'vitest';
import { EditorState, type EditorStateConfig } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import {
  computeLivePreviewDecos,
  revealedRanges,
  type LivePreviewDeco,
} from '../../src/lib/livePreview';

/** A state whose syntax tree is fully parsed (GFM base, as the tests need
 * Strikethrough nodes; the pure core only sees the tree, never the config). */
function mkState(doc: string, selection?: EditorStateConfig['selection']): EditorState {
  const state = EditorState.create({
    doc,
    selection,
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

/** Decos for the whole document as one visible range. */
function allDecos(state: EditorState): LivePreviewDeco[] {
  return computeLivePreviewDecos(state, [{ from: 0, to: state.doc.length }]);
}

/** The characters the hide decos would remove, in document order. */
function hiddenText(state: EditorState, decos: LivePreviewDeco[]): string {
  return decos
    .filter((d) => d.deco === 'hide')
    .map((d) => state.doc.sliceString(d.from, d.to))
    .join('');
}

const styleSpans = (state: EditorState, decos: LivePreviewDeco[]) =>
  decos
    .filter((d): d is Extract<LivePreviewDeco, { deco: 'style' }> => d.deco === 'style')
    .map((d) => ({ style: d.style, text: state.doc.sliceString(d.from, d.to) }));

describe('PRD 006 §3 inline formatting: markers hidden, content styled', () => {
  test('U162: bold — the ** markers hide, the whole construct styles strong', () => {
    // Cursor defaults to offset 0, whose line would reveal everything raw;
    // park it on the second line so line 1's constructs decorate.
    const state = mkState('a **bold move** z\ncursor here', { anchor: 20 });
    const decos = allDecos(state);
    expect(hiddenText(state, decos)).toBe('****');
    expect(styleSpans(state, decos)).toEqual([{ style: 'strong', text: '**bold move**' }]);
  });

  test('U163: italic — the * markers hide, the construct styles emphasis', () => {
    const state = mkState('an *em* z\ncursor here', { anchor: 12 });
    const decos = allDecos(state);
    expect(hiddenText(state, decos)).toBe('**');
    expect(styleSpans(state, decos)).toEqual([{ style: 'emphasis', text: '*em*' }]);
  });

  test('U164: strikethrough — the ~~ markers hide, the construct styles strikethrough', () => {
    const state = mkState('so ~~gone~~ z\ncursor here', { anchor: 16 });
    const decos = allDecos(state);
    expect(hiddenText(state, decos)).toBe('~~~~');
    expect(styleSpans(state, decos)).toEqual([{ style: 'strikethrough', text: '~~gone~~' }]);
  });

  test('U165: inline code — the backticks hide, the construct styles inline-code', () => {
    const state = mkState('run `npm test` z\ncursor here', { anchor: 19 });
    const decos = allDecos(state);
    expect(hiddenText(state, decos)).toBe('``');
    expect(styleSpans(state, decos)).toEqual([{ style: 'inline-code', text: '`npm test`' }]);
  });

  test('U166: nested bold+italic — both levels style, all markers hide exactly once', () => {
    const state = mkState('***both***\ncursor here', { anchor: 13 });
    const decos = allDecos(state);
    // Emphasis wraps StrongEmphasis: 1+2 opening and 2+1 closing asterisks.
    expect(hiddenText(state, decos)).toBe('***' + '***');
    const styles = styleSpans(state, decos).map((s) => s.style);
    expect(styles).toContain('emphasis');
    expect(styles).toContain('strong');
    // Hide spans never overlap (replace decorations must not).
    const hides = decos.filter((d) => d.deco === 'hide').sort((a, b) => a.from - b.from);
    for (let i = 1; i < hides.length; i++) expect(hides[i].from).toBeGreaterThanOrEqual(hides[i - 1].to);
  });

  test('U167: unclosed markers are no construct — nothing hides, nothing styles', () => {
    const state = mkState('a **dangling and `open\ncursor here', { anchor: 25 });
    expect(allDecos(state)).toEqual([]);
  });
});

describe('PRD 006 §8 reveal rule', () => {
  test('U168: the cursor line shows raw markdown; other lines stay decorated', () => {
    const doc = '**one**\n**two**\n**three**';
    // Cursor on line 2 (offset inside '**two**').
    const state = mkState(doc, { anchor: doc.indexOf('two') });
    const spans = styleSpans(state, allDecos(state));
    expect(spans).toEqual([
      { style: 'strong', text: '**one**' },
      { style: 'strong', text: '**three**' },
    ]);
    // The revealed region is exactly line 2.
    expect(revealedRanges(state)).toEqual([{ from: 8, to: 15 }]);
  });

  test('U169: a selection reveals every line it touches', () => {
    const doc = '**one**\n**two**\n**three**\n**four**';
    // Selection from inside line 1 to inside line 3.
    const state = mkState(doc, { anchor: 2, head: doc.indexOf('three') });
    const spans = styleSpans(state, allDecos(state));
    expect(spans).toEqual([{ style: 'strong', text: '**four**' }]);
    expect(revealedRanges(state)).toEqual([{ from: 0, to: 25 }]);
  });

  test('U170: cursor inside a code fence reveals the whole fence', () => {
    const doc = 'before\n```js\nconst x = 1;\nconst y = 2;\n```\nafter **bold**';
    // Cursor on a fence-interior line.
    const state = mkState(doc, { anchor: doc.indexOf('x = 1') });
    // The reveal spans the fence's full lines, not just the cursor line.
    expect(revealedRanges(state)).toEqual([
      { from: doc.indexOf('```js'), to: doc.indexOf('\nafter') },
    ]);
    // Constructs outside the fence still decorate.
    expect(styleSpans(state, allDecos(state))).toEqual([{ style: 'strong', text: '**bold**' }]);
  });

  test('U171: an inline construct crossing a line break reveals whole from either line', () => {
    const doc = 'x **multi\nline** y\n`tail`';
    for (const anchor of [0, doc.indexOf('line')]) {
      const state = mkState(doc, { anchor });
      // Cursor on either line of the construct reveals both its lines…
      expect(revealedRanges(state)).toEqual([{ from: 0, to: doc.indexOf('\n`tail`') }]);
      // …so the construct stays raw while the last line still decorates.
      expect(styleSpans(state, allDecos(state))).toEqual([{ style: 'inline-code', text: '`tail`' }]);
    }
  });
});

describe('PRD 006 §9 presentation-only', () => {
  test('U172: computing decos never touches document or selection, and hides only marker characters', () => {
    const doc = 'keep **bold** and *em* and ~~strike~~ and `code`\ncursor';
    const state = mkState(doc, { anchor: doc.length });
    const selBefore = state.selection;
    const decos = allDecos(state);
    // The document text and selection objects are untouched.
    expect(state.doc.toString()).toBe(doc);
    expect(state.selection).toBe(selBefore);
    // Every hidden character is a marker, never content.
    expect(hiddenText(state, decos).replace(/[*~`]/g, '')).toBe('');
    // Specs are plain data with valid, sorted, in-bounds ranges.
    for (const d of decos) {
      expect(d.from).toBeGreaterThanOrEqual(0);
      expect(d.to).toBeGreaterThan(d.from);
      expect(d.to).toBeLessThanOrEqual(doc.length);
    }
    for (let i = 1; i < decos.length; i++) expect(decos[i].from).toBeGreaterThanOrEqual(decos[i - 1].from);
  });
});

describe('PRD 006 §13 viewport-bounded computation', () => {
  test('U173: a large document with a small viewport decorates only the visible ranges', () => {
    // field-guide-scale: thousands of lines, every one carrying constructs.
    const line = '**bold** middle *em* and `code` tail';
    const lines = Array.from({ length: 4000 }, () => line);
    const doc = lines.join('\n');
    const state = mkState(doc + '\ncursor', { anchor: doc.length + 3 });
    // A viewport of ~10 lines somewhere in the middle.
    const lineLen = line.length + 1;
    const vp = { from: 2000 * lineLen, to: 2010 * lineLen - 1 };
    const decos = computeLivePreviewDecos(state, [vp]);
    // Work happened for exactly the visible lines: 3 styles + 6 hides each.
    expect(decos.length).toBe(10 * 9);
    for (const d of decos) {
      expect(d.to).toBeGreaterThan(vp.from);
      expect(d.from).toBeLessThan(vp.to);
    }
  });

  test('U174: disjoint visible ranges decorate each range and nothing between', () => {
    const doc = '**a**\n**b**\n**c**\n**d**\ncursor';
    const state = mkState(doc, { anchor: doc.length });
    const decos = computeLivePreviewDecos(state, [
      { from: 0, to: 5 }, // line 1
      { from: 12, to: 17 }, // line 3
    ]);
    expect(styleSpans(state, decos)).toEqual([
      { style: 'strong', text: '**a**' },
      { style: 'strong', text: '**c**' },
    ]);
  });
});
