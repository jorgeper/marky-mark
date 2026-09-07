import { describe, expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { highlightViewMousedown, type PaintedRange } from '../src/components/highlightClick';

/** A state whose syntax tree is fully parsed (the link-spans rig). */
function mkState(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state.update({}).state;
}

describe('Issue #341: editor-pane activation gesture (highlightViewMousedown)', () => {
  test('U1314: a ⌘/Ctrl click over painted ranges reports every covering id and claims the event; a plain click reports nothing and claims nothing; a link under the pointer yields', () => {
    const doc = 'alpha bravo charlie delta echo, see [site](https://example.com) now\n';
    const state = mkState(doc);
    const at = (needle: string) => doc.indexOf(needle);
    const ranges: PaintedRange[] = [
      { id: 'c-outer', from: at('bravo'), to: at('delta') + 'delta'.length },
      { id: 'h-inner', from: at('charlie'), to: at('charlie') + 'charlie'.length },
      { id: 'c-link', from: at('site'), to: at('site') + 'site'.length },
    ];
    const reported: (readonly string[])[] = [];
    let prevented = 0;
    let callback: ((ids: readonly string[]) => void) | undefined = (ids) => reported.push(ids);
    const handler = highlightViewMousedown(
      () => ranges,
      () => callback
    );
    const click = (pos: number | null, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}) =>
      handler(
        { metaKey: !!mods.metaKey, ctrlKey: !!mods.ctrlKey, clientX: 0, clientY: 0, preventDefault: () => prevented++ },
        { posAtCoords: () => pos, state }
      );

    // ⌘-click and Ctrl-click inside the nested pair: both covering ids, in
    // document order, and the event is claimed (no caret move follows).
    expect(click(at('charlie') + 2, { metaKey: true })).toBe(true);
    expect(click(at('charlie') + 2, { ctrlKey: true })).toBe(true);
    expect(reported).toEqual([
      ['c-outer', 'h-inner'],
      ['c-outer', 'h-inner'],
    ]);
    expect(prevented).toBe(2);

    // On the outer range alone: just that id. Range ends are inclusive.
    expect(click(at('delta') + 'delta'.length, { metaKey: true })).toBe(true);
    expect(reported[2]).toEqual(['c-outer']);

    // A plain click over a painted range: not claimed, nothing reported.
    expect(click(at('charlie') + 2)).toBe(false);
    // A modified click off every range, and with no position: not claimed.
    expect(click(at('alpha'), { metaKey: true })).toBe(false);
    expect(click(null, { ctrlKey: true })).toBe(false);
    // Text that is both a link and a painted range belongs to the link
    // gesture: not claimed here, nothing reported.
    expect(click(at('site') + 1, { metaKey: true })).toBe(false);
    expect(reported).toHaveLength(3);
    expect(prevented).toBe(3);

    // No owner callback ⇒ display-only painting: never claimed.
    callback = undefined;
    expect(click(at('charlie') + 2, { metaKey: true })).toBe(false);
    expect(prevented).toBe(3);
  });
});
