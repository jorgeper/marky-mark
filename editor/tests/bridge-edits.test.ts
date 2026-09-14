// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { bridgeReplaceRange, viewportLineCount } from '../src/components/bridgeEdits';

// PRD 027 Req 12/13 (issue #366): the agent bridge's editor primitives,
// proven against a REAL CodeMirror view and history (the code-copy.test.ts
// happy-dom precedent) — the handle methods in Editor.tsx are one-line
// adapters over these.

const views: EditorView[] = [];

function mkView(doc: string, anchor = 0): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor }, extensions: [history()] }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

afterEach(() => {
  // The suite shares workers: never leave a view mounted in the document.
  for (const v of views.splice(0)) v.destroy();
});

describe('PRD 027 Req 12/13 (issue #366) bridge edit primitives', () => {
  test('U1424: replaceRange lands one transaction — a single undo restores the original text, the caret sits after the inserted text', () => {
    const view = mkView('alpha beta gamma\n', 0);
    // A user keystroke first: the bridge edit must not merge into its history group.
    view.dispatch({ changes: { from: 0, to: 0, insert: 'X' }, selection: { anchor: 1 } });
    expect(view.state.doc.toString()).toBe('Xalpha beta gamma\n');

    const landed = bridgeReplaceRange(view, 7, 11, 'BETA-AND-MORE');
    expect(landed).toEqual({ from: 7, to: 11, caret: 7 + 'BETA-AND-MORE'.length });
    expect(view.state.doc.toString()).toBe('Xalpha BETA-AND-MORE gamma\n');
    // Typing semantics: the caret is collapsed at the end of the insertion.
    expect(view.state.selection.main.empty).toBe(true);
    expect(view.state.selection.main.head).toBe(7 + 'BETA-AND-MORE'.length);

    // Exactly ONE undo reverts the whole tool call and nothing else.
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('Xalpha beta gamma\n');
    // The user's own keystroke is a separate step, still there.
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('alpha beta gamma\n');
  });

  test('U1425: offsets clamp into the document and reorder — a stale or reversed range never throws', () => {
    const view = mkView('short');
    // Past the end: clamped to the document length (an append).
    expect(bridgeReplaceRange(view, 50, 60, '!')).toEqual({ from: 5, to: 5, caret: 6 });
    expect(view.state.doc.toString()).toBe('short!');
    // Reversed ends are ordered; a negative start clamps to 0.
    expect(bridgeReplaceRange(view, 5, 0, 'long')).toEqual({ from: 0, to: 5, caret: 4 });
    expect(view.state.doc.toString()).toBe('long!');
    expect(bridgeReplaceRange(view, -3, 4, '')).toEqual({ from: 0, to: 4, caret: 0 });
    expect(view.state.doc.toString()).toBe('!');
    // An empty range is a pure insert at the (clamped) point.
    expect(bridgeReplaceRange(view, 1, 1, '?')).toEqual({ from: 1, to: 1, caret: 2 });
    expect(view.state.doc.toString()).toBe('!?');
  });

  test('U1426: replaceRange never focuses the view; viewportLines is a positive line count whatever the measurement', () => {
    const view = mkView('one\ntwo\nthree');
    expect(view.hasFocus).toBe(false);
    bridgeReplaceRange(view, 0, 3, 'uno');
    expect(view.state.doc.toString()).toBe('uno\ntwo\nthree');
    expect(view.hasFocus).toBe(false);
    expect(document.activeElement).not.toBe(view.contentDOM);

    // An unmeasured (zero-height) view still pages by at least one line.
    expect(viewportLineCount(view)).toBeGreaterThanOrEqual(1);
    // A measured viewport: whole lines that fit.
    expect(viewportLineCount({ scrollDOM: { clientHeight: 410 } as HTMLElement, defaultLineHeight: 20 })).toBe(20);
    expect(viewportLineCount({ scrollDOM: { clientHeight: 10 } as HTMLElement, defaultLineHeight: 20 })).toBe(1);
    expect(viewportLineCount({ scrollDOM: { clientHeight: 0 } as HTMLElement, defaultLineHeight: 0 })).toBe(1);
  });
});
