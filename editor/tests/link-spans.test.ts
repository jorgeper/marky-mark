import { describe, expect, test } from 'vitest';
import { EditorState, type EditorStateConfig } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { computeLinkViews, linkAt, type LinkView } from '../src/lib/linkSpans';
import { linkViewMousedown } from '../src/components/linkView';

/** A state whose syntax tree is fully parsed (the code-block-spans rig). */
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

/** The text pieces a link's hide spans would remove, in document order. */
const hiddenText = (state: EditorState, link: LinkView): string[] =>
  link.hide.map((h) => state.doc.sliceString(h.from, h.to));

describe('SPEC43 §11 (issue #270): link spans and offset resolution', () => {
  test('U1156: linkAt — inside the text, inside the URL, both boundaries; null on images, reference links and plain text', () => {
    const doc = 'see [docs](https://example.com "Home") and ![alt](pic.png) and [ref][r] end\n\n[r]: https://r.example\n';
    const state = mkState(doc);
    const at = (needle: string, extra = 0) => doc.indexOf(needle) + extra;

    // Inside the link text and inside the URL both resolve the same link.
    const fromText = linkAt(state, at('docs'));
    expect(fromText?.url).toBe('https://example.com');
    expect(fromText?.from).toBe(at('[docs]'));
    expect(linkAt(state, at('example.com'))?.url).toBe('https://example.com');
    // Both node boundaries count as inside (the reveal rule's convention).
    expect(linkAt(state, at('[docs]'))?.url).toBe('https://example.com');
    expect(linkAt(state, at('"Home")') + '"Home")'.length)?.url).toBe('https://example.com');

    // An image reference is NOT a link; a reference-style link has no URL
    // child; plain text is outside any link.
    expect(linkAt(state, at('alt]'))).toBeNull();
    expect(linkAt(state, at('pic.png'))).toBeNull();
    expect(linkAt(state, at('ref]'))).toBeNull();
    expect(linkAt(state, at('see '))).toBeNull();
    expect(linkAt(state, at(' end'))).toBeNull();
  });

  test('U1157: computeLinkViews — hide spans and the text span for plain, titled, nested-emphasis and multiple links on one line', () => {
    const doc = 'a [one](https://a.example) b [two **bold**](https://b.example "T") c\nplain [ref][r] ![img](p.png)\n';
    const state = mkState(doc); // caret at 0 — outside every link
    const links = computeLinkViews(state, whole(state));

    // Exactly the two URL-carrying inline links, in document order — the
    // reference link and the image emit nothing.
    expect(links.map((l) => l.url)).toEqual(['https://a.example', 'https://b.example']);
    expect(links.every((l) => !l.revealed)).toBe(true);

    // Plain link: `[` hides, then everything from `]` to the end.
    const [one, two] = links;
    expect(hiddenText(state, one)).toEqual(['[', '](https://a.example)']);
    expect(state.doc.sliceString(one.text.from, one.text.to)).toBe('one');

    // Titled link with nested emphasis: the text span keeps the emphasis
    // markers (their own view styles them); the title hides with the tail.
    expect(hiddenText(state, two)).toEqual(['[', '](https://b.example "T")']);
    expect(state.doc.sliceString(two.text.from, two.text.to)).toBe('two **bold**');
  });

  test('U1158: computeLinkViews — caret/selection reveal (hide empties) and excluded spans drop their links', () => {
    const doc = 'x [one](https://a.example) y [two](https://b.example) z';
    const at = (needle: string) => doc.indexOf(needle);

    // Caret inside the first link reveals JUST that link.
    const caret = mkState(doc, { anchor: at('one') });
    const links = computeLinkViews(caret, whole(caret));
    expect(links.map((l) => [l.url, l.revealed])).toEqual([
      ['https://a.example', true],
      ['https://b.example', false],
    ]);
    expect(links[0].hide).toEqual([]);

    // A selection overlapping any part of a link reveals it too.
    const sel = mkState(doc, { anchor: 0, head: at('](https://a') + 1 });
    expect(computeLinkViews(sel, whole(sel))[0].revealed).toBe(true);

    // An excluded (table-grid) span drops its link entirely.
    const excluded = mkState(doc);
    const kept = computeLinkViews(excluded, whole(excluded), [{ from: 0, to: at(' y') }]);
    expect(kept.map((l) => l.url)).toEqual(['https://b.example']);
  });

  test('U1159: linkViewMousedown — modified click resolves through the offset and hands the RAW href to the seam; plain click never fires', () => {
    const doc = 'go [site](https://example.com) or [note](./other.md) now';
    const state = mkState(doc);
    const viewAt = (pos: number | null) => ({ posAtCoords: () => pos, state });
    const opened: string[] = [];
    let prevented = 0;
    const handler = linkViewMousedown((url) => opened.push(url));
    const click = (pos: number | null, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}) =>
      handler(
        { metaKey: !!mods.metaKey, ctrlKey: !!mods.ctrlKey, clientX: 0, clientY: 0, preventDefault: () => prevented++ },
        viewAt(pos)
      );

    // ⌘-click and Ctrl-click on link text: claimed, URL handed over.
    expect(click(doc.indexOf('site'), { metaKey: true })).toBe(true);
    expect(click(doc.indexOf('site'), { ctrlKey: true })).toBe(true);
    expect(opened).toEqual(['https://example.com', 'https://example.com']);
    expect(prevented).toBe(2);

    // A non-http href is handed to the host rule, never swallowed here.
    expect(click(doc.indexOf('note'), { metaKey: true })).toBe(true);
    expect(opened[2]).toBe('./other.md');

    // Plain click, modifier-click off a link, and no position: not claimed.
    expect(click(doc.indexOf('site'))).toBe(false);
    expect(click(doc.indexOf('go'), { metaKey: true })).toBe(false);
    expect(click(null, { metaKey: true })).toBe(false);
    expect(opened).toHaveLength(3);
  });
});
