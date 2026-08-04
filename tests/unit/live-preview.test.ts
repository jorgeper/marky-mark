import { describe, expect, test } from 'vitest';
import { EditorState, type EditorStateConfig, type Transaction } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { history, undo } from '@codemirror/commands';
import {
  computeLivePreviewDecos,
  revealedRanges,
  taskToggleChange,
  type LivePreviewDeco,
} from '../../src/lib/livePreview';
import { livePreviewMousedown } from '../../src/components/livePreview';

/** A state whose syntax tree is fully parsed (GFM base, as the tests need
 * Strikethrough nodes; the pure core only sees the tree, never the config). */
function mkState(doc: string, selection?: EditorStateConfig['selection']): EditorState {
  const state = EditorState.create({
    doc,
    selection,
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  // ensureSyntaxTree advances the shared parse context, but syntaxTree()
  // reads the state field's snapshot, which init only fills for the first
  // ~3000 chars — a no-op update refreshes it to the fully parsed tree.
  return state.update({}).state;
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

describe('PRD 006 §4 headings: heading size/weight, # markers hidden', () => {
  test('U175: each ATX level gets its per-level line style and hides its markers plus the space', () => {
    const doc = '# h1\n## h2\n### h3\n#### h4\n##### h5\n###### h6\ncursor';
    const state = mkState(doc, { anchor: doc.length });
    const decos = allDecos(state);
    const lines = decos.filter((d): d is Extract<LivePreviewDeco, { deco: 'line' }> => d.deco === 'line');
    expect(lines.map((d) => d.style)).toEqual([
      'heading-1',
      'heading-2',
      'heading-3',
      'heading-4',
      'heading-5',
      'heading-6',
    ]);
    // Every line deco anchors at its line start and spans the line.
    for (const d of lines) {
      const line = state.doc.lineAt(d.from);
      expect(d.from).toBe(line.from);
      expect(d.to).toBe(line.to);
    }
    // The leading markers hide together with the space after them.
    expect(hiddenText(state, decos)).toBe('# ## ### #### ##### ###### ');
  });
});

describe('PRD 006 §5 links: text styled, syntax hidden, cmd/ctrl-click hand-off', () => {
  test('U176: the [text](url) syntax hides and the link text carries the URL', () => {
    const doc = 'see [docs](https://ex.com) end\ncursor';
    const state = mkState(doc, { anchor: doc.length });
    const decos = allDecos(state);
    const links = decos.filter((d) => d.deco === 'link');
    expect(links).toEqual([{ from: 5, to: 9, deco: 'link', url: 'https://ex.com' }]);
    expect(state.doc.sliceString(links[0].from, links[0].to)).toBe('docs');
    expect(hiddenText(state, decos)).toBe('[](https://ex.com)');
  });

  test('U177: cmd/ctrl-click hands the URL to the openExternal callback; plain click does not', () => {
    const opened: string[] = [];
    const handler = livePreviewMousedown((url) => opened.push(url));
    let prevented = 0;
    const linkTarget = (url: string) =>
      ({
        closest: (sel: string) =>
          sel === '.mm-lp-link'
            ? { getAttribute: (name: string) => (name === 'data-mm-lp-url' ? url : null) }
            : null,
      }) as unknown as EventTarget;
    const ev = (mods: { metaKey: boolean; ctrlKey: boolean }, url = 'https://ex.com') => ({
      ...mods,
      target: linkTarget(url),
      preventDefault: () => prevented++,
    });
    // cmd (mac) and ctrl (win/linux) both open, consuming the event.
    expect(handler(ev({ metaKey: true, ctrlKey: false }))).toBe(true);
    expect(handler(ev({ metaKey: false, ctrlKey: true }))).toBe(true);
    expect(opened).toEqual(['https://ex.com', 'https://ex.com']);
    expect(prevented).toBe(2);
    // Plain click is not consumed — CodeMirror just places the cursor.
    expect(handler(ev({ metaKey: false, ctrlKey: false }))).toBe(false);
    // Non-http(s) URLs are inert, mirroring the preview pane's managed links.
    expect(handler(ev({ metaKey: true, ctrlKey: false }, 'javascript:alert(1)'))).toBe(false);
    // A cmd-click away from any link is not consumed either.
    expect(
      handler({
        metaKey: true,
        ctrlKey: false,
        target: { closest: () => null } as unknown as EventTarget,
        preventDefault: () => prevented++,
      })
    ).toBe(false);
    expect(opened.length).toBe(2);
    expect(prevented).toBe(2);
  });
});

describe('PRD 006 §6 block elements: quotes, lists, rules, fences', () => {
  test('U178: blockquote lines get the quote-bar line style with > markers hidden, revealing line-by-line', () => {
    // The blank line matters: a bare 'cursor' line would lazily continue
    // the blockquote per CommonMark and correctly pick up quote styling.
    const doc = '> one **b**\n> two\n\ncursor';
    // Cursor on the second quote line: line 1 stays decorated, line 2 raw.
    const state = mkState(doc, { anchor: doc.indexOf('two') });
    const decos = allDecos(state);
    const lines = decos.filter((d) => d.deco === 'line');
    expect(lines).toEqual([{ from: 0, to: 11, deco: 'line', style: 'blockquote' }]);
    // Only line 1's marker (and its space) hides; **b** still decorates.
    expect(hiddenText(state, decos)).toBe('> ****');
    expect(styleSpans(state, decos)).toEqual([{ style: 'strong', text: '**b**' }]);
  });

  test('U179: bullet markers render as bullets and ordered markers as numbers — nothing hides', () => {
    const doc = '- apple\n- pear\n\n1. one\n2. two\n\ncursor';
    const state = mkState(doc, { anchor: doc.length });
    const decos = allDecos(state);
    const bullets = decos
      .filter((d) => d.deco === 'bullet')
      .map((d) => state.doc.sliceString(d.from, d.to));
    expect(bullets).toEqual(['-', '-']);
    expect(styleSpans(state, decos)).toEqual([
      { style: 'list-number', text: '1.' },
      { style: 'list-number', text: '2.' },
    ]);
    expect(hiddenText(state, decos)).toBe('');
  });

  test('U180: horizontal rules draw as rules over the raw --- / *** text', () => {
    const doc = 'a\n\n---\n\n***\n\ncursor';
    const state = mkState(doc, { anchor: doc.length });
    const decos = allDecos(state);
    const rules = decos
      .filter((d) => d.deco === 'rule')
      .map((d) => state.doc.sliceString(d.from, d.to));
    expect(rules).toEqual(['---', '***']);
    expect(hiddenText(state, decos)).toBe('');
  });

  test('U181: fence lines (backticks and info string) hide; the code body carries no hide span', () => {
    const doc = '```js\nconst x = 1;\n```\ncursor';
    const state = mkState(doc, { anchor: doc.length });
    const decos = allDecos(state);
    expect(hiddenText(state, decos)).toBe('```js```');
    // The code body keeps its own highlighting: no deco of any kind overlaps it.
    const body = { from: doc.indexOf('const'), to: doc.indexOf(';') + 1 };
    for (const d of decos) {
      expect(d.from >= body.to || d.to <= body.from).toBe(true);
    }
  });
});

describe('PRD 006 §7 task-list checkboxes: render mirrors the source, a plain click toggles it', () => {
  /** A fake EditorView: posAtDOM answers `pos`, dispatch applies the spec. */
  const mkView = (initial: EditorState, pos: number) => {
    let state = initial;
    const dispatched: unknown[] = [];
    return {
      dispatched,
      get doc() {
        return state.doc.toString();
      },
      undo() {
        undo({
          state,
          dispatch: (tr: Transaction) => {
            state = tr.state;
          },
        });
      },
      posAtDOM: () => pos,
      get state() {
        return state;
      },
      dispatch(spec: { changes: { from: number; to: number; insert: string }; userEvent: string }) {
        dispatched.push(spec);
        state = state.update(spec).state;
      },
    };
  };
  /** A click target whose closest() matches exactly `matches`. */
  const clickTarget = (matches: string) =>
    ({
      closest: (sel: string) => (sel === matches ? { getAttribute: () => null } : null),
    }) as unknown as EventTarget;

  test('U185: task markers emit checkbox decos mirroring [ ]/[x]/[X]; task bullets hide, plain bullets stay', () => {
    const doc = '- [ ] open\n- [x] done\n- [X] DONE\n- plain\n\ncursor';
    const state = mkState(doc, { anchor: doc.length });
    const decos = allDecos(state);
    const boxes = decos
      .filter((d): d is Extract<LivePreviewDeco, { deco: 'checkbox' }> => d.deco === 'checkbox')
      .map((d) => ({ text: state.doc.sliceString(d.from, d.to), checked: d.checked }));
    expect(boxes).toEqual([
      { text: '[ ]', checked: false },
      { text: '[x]', checked: true },
      { text: '[X]', checked: true },
    ]);
    // The task items' list marks hide (the preview pane shows task lists as
    // checkboxes without bullets); only the plain item draws a bullet.
    const bullets = decos.filter((d) => d.deco === 'bullet');
    expect(bullets).toEqual([{ from: doc.indexOf('- plain'), to: doc.indexOf('- plain') + 1, deco: 'bullet' }]);
    expect(hiddenText(state, decos)).toBe('---');
  });

  test('U186: the toggle change spec replaces exactly the 3 marker chars in both directions', () => {
    const doc = '- [ ] a\n- [x] b\n- [X] c';
    const state = mkState(doc);
    expect(taskToggleChange(state.doc, 2)).toEqual({ from: 2, to: 5, insert: '[x]' });
    expect(taskToggleChange(state.doc, 10)).toEqual({ from: 10, to: 13, insert: '[ ]' });
    // Uppercase [X] unchecks too.
    expect(taskToggleChange(state.doc, 18)).toEqual({ from: 18, to: 21, insert: '[ ]' });
    // A position that is not a task marker toggles nothing.
    expect(taskToggleChange(state.doc, 0)).toBeNull();
  });

  test('U187: a plain checkbox click dispatches one toggle transaction; a single undo restores the text', () => {
    const doc = '- [ ] task\ncursor';
    const view = mkView(
      EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [markdown({ base: markdownLanguage }), history()],
      }),
      doc.indexOf('[ ]')
    );
    const handler = livePreviewMousedown(undefined);
    let prevented = 0;
    const click = () =>
      handler(
        { metaKey: false, ctrlKey: false, target: clickTarget('.mm-lp-task'), preventDefault: () => prevented++ },
        view
      );
    expect(click()).toBe(true);
    expect(prevented).toBe(1);
    // One transaction, and nothing but the marker changed.
    expect(view.dispatched.length).toBe(1);
    expect(view.doc).toBe('- [x] task\ncursor');
    // A single undo restores the pre-click text exactly.
    view.undo();
    expect(view.doc).toBe(doc);
  });

  test('U188: the cursor on a task line reveals it raw while another task line stays a checkbox', () => {
    const doc = '- [ ] one\n- [x] two\n\ncursor';
    const state = mkState(doc, { anchor: 3 });
    const decos = allDecos(state);
    // The cursor's task line carries no decos at all: raw mark, raw marker.
    for (const d of decos) expect(d.from).toBeGreaterThan(doc.indexOf('\n'));
    // The other task line still renders its checkbox.
    const boxes = decos.filter((d) => d.deco === 'checkbox');
    expect(boxes).toEqual([
      { from: doc.indexOf('[x]'), to: doc.indexOf('[x]') + 3, deco: 'checkbox', checked: true },
    ]);
  });

  test('U189: a plain click on any non-checkbox construct dispatches nothing — the cursor just moves', () => {
    const doc = '- [ ] task\nsee [docs](https://ex.com)';
    const opened: string[] = [];
    const view = mkView(mkState(doc, { anchor: 0 }), doc.indexOf('[ ]'));
    const handler = livePreviewMousedown((url) => opened.push(url));
    let prevented = 0;
    const plain = (target: EventTarget) =>
      handler({ metaKey: false, ctrlKey: false, target, preventDefault: () => prevented++ }, view);
    // A rendered link, plain-clicked: no open, no change, not consumed.
    expect(plain(clickTarget('.mm-lp-link'))).toBe(false);
    // Any other rendered construct (nothing interactive under the click).
    expect(plain({ closest: () => null } as unknown as EventTarget)).toBe(false);
    expect(view.dispatched).toEqual([]);
    expect(view.doc).toBe(doc);
    expect(opened).toEqual([]);
    expect(prevented).toBe(0);
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

  test('U182: the cursor on a heading line shows it raw; other lines stay decorated', () => {
    const doc = '# head\n**b**\ncursor';
    const state = mkState(doc, { anchor: 2 });
    const decos = allDecos(state);
    // No heading line style, no marker hide on the cursor line.
    expect(decos.filter((d) => d.deco === 'line')).toEqual([]);
    for (const d of decos) expect(d.from).toBeGreaterThan(doc.indexOf('\n'));
    // Line 2's construct still decorates.
    expect(styleSpans(state, decos)).toEqual([{ style: 'strong', text: '**b**' }]);
  });

  test('U183: the cursor inside a fence reveals the whole fence raw — no fence-line hides', () => {
    const doc = 'before\n```js\nconst x = 1;\n```\nafter **bold**';
    const state = mkState(doc, { anchor: doc.indexOf('x = 1') });
    const decos = allDecos(state);
    const fence = { from: doc.indexOf('```js'), to: doc.indexOf('\nafter') };
    expect(
      decos.filter((d) => d.deco === 'hide' && d.from < fence.to && d.to > fence.from)
    ).toEqual([]);
    expect(styleSpans(state, decos)).toEqual([{ style: 'strong', text: '**bold**' }]);
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

describe('PRD 006 §11 (#55) excluded regions: table-grid spans show raw markdown', () => {
  // A grid-shaped table (SPEC40 pads columns by raw character count): if any
  // deco changed a grid line's visible character count, its pipes would drift.
  const GRID =
    '| Term     | Meaning        |\n' +
    '| -------- | -------------- |\n' +
    '| **Host** | Your machine   |\n' +
    '| `code`   | [a](https://x) |';
  const DOC = `before **bold** here\n${GRID}\nafter **tail** \`c\`\ncursor`;
  const span = { from: DOC.indexOf('| Term'), to: DOC.indexOf('\nafter') };

  test('U192: decos are suppressed inside an excluded span and still produced outside it', () => {
    const state = mkState(DOC, { anchor: DOC.length });
    // Without the exclusion the bug is live: hides land inside the table.
    const unexcluded = allDecos(state);
    expect(
      unexcluded.filter((d) => d.deco === 'hide' && d.from < span.to && d.to > span.from).length
    ).toBeGreaterThan(0);
    // With the span excluded, no deco of any kind lands inside it…
    const decos = computeLivePreviewDecos(state, [{ from: 0, to: state.doc.length }], [span]);
    for (const d of decos) expect(d.from >= span.to || d.to <= span.from).toBe(true);
    // …while identical constructs outside it still decorate.
    expect(styleSpans(state, decos)).toEqual([
      { style: 'strong', text: '**bold**' },
      { style: 'strong', text: '**tail**' },
      { style: 'inline-code', text: '`c`' },
    ]);
    expect(hiddenText(state, decos)).toBe('****' + '****' + '``');
  });

  test('U193: the exclusion is selection-independent — it holds wherever the caret sits', () => {
    // Caret before, inside, and after the span: the span never decorates.
    for (const anchor of [0, DOC.indexOf('**Host**'), DOC.length]) {
      const state = mkState(DOC, { anchor });
      const decos = computeLivePreviewDecos(state, [{ from: 0, to: state.doc.length }], [span]);
      for (const d of decos) expect(d.from >= span.to || d.to <= span.from).toBe(true);
    }
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

  test('U184: block constructs also decorate only the visible ranges of a large document', () => {
    const line = '## head';
    const lines = Array.from({ length: 4000 }, () => line);
    const doc = lines.join('\n');
    const state = mkState(doc + '\ncursor', { anchor: doc.length + 3 });
    const lineLen = line.length + 1;
    const vp = { from: 2000 * lineLen, to: 2010 * lineLen - 1 };
    const decos = computeLivePreviewDecos(state, [vp]);
    // Exactly the 10 visible headings: one line style + one marker hide each.
    expect(decos.filter((d) => d.deco === 'line').length).toBe(10);
    expect(decos.filter((d) => d.deco === 'hide').length).toBe(10);
    expect(decos.length).toBe(20);
    for (const d of decos) {
      expect(d.to).toBeGreaterThan(vp.from);
      expect(d.from).toBeLessThan(vp.to);
    }
  });

  test('U190: task items also decorate only the visible ranges of a large document', () => {
    const line = '- [ ] item';
    const lines = Array.from({ length: 4000 }, () => line);
    const doc = lines.join('\n');
    const state = mkState(doc + '\ncursor', { anchor: doc.length + 3 });
    const lineLen = line.length + 1;
    const vp = { from: 2000 * lineLen, to: 2010 * lineLen - 1 };
    const decos = computeLivePreviewDecos(state, [vp]);
    // Exactly the 10 visible task items: one checkbox + one list-mark hide each.
    expect(decos.filter((d) => d.deco === 'checkbox').length).toBe(10);
    expect(decos.filter((d) => d.deco === 'hide').length).toBe(10);
    expect(decos.length).toBe(20);
    for (const d of decos) {
      expect(d.to).toBeGreaterThan(vp.from);
      expect(d.from).toBeLessThan(vp.to);
    }
  });
});
