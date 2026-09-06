import { describe, expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  canonicalLineAt,
  canonicalizeAll,
  setGridSet,
  tableModeField,
  tableModeExtension,
} from '../src/components/tableMode';
import { layoutTable, parseTable } from '../src/lib/tableEdit';

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

/** Assemble every decoration set the state computes — where the crash was.
 * Reading the facet runs each provider; the view-function providers a
 * mounted editor would add contribute nothing to a headless state. */
function computeDecos(state: EditorState): void {
  state.facet(EditorView.decorations);
}

describe('Issue #156: grid spans across a whole-document replace', () => {
  test('U719: a tab-switch full-doc replace drops every stale span — the decorations still assemble', () => {
    const state = gridded();
    const NEXT = `other doc\n\n${T1}\n\nwith\nmore\nlines`;
    const after = state.update({ changes: { from: 0, to: state.doc.length, insert: NEXT } }).state;
    expect(() => computeDecos(after)).not.toThrow();
    // The old document's spans are gone (the watcher re-grids the new one);
    // nothing coincides on {0, newLength}.
    expect(after.field(tableModeField)!.spans).toEqual([]);
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

// PRD 020 Req 18 (issue #260): a grid is TALLER on screen than the source it
// came from, so every raw editor line below one runs ahead of the canonical
// line the host addresses (the copy-link seam's `getUrl`). canonicalLineAt is
// that conversion, and it must land on the same line canonicalizeAll — the
// arithmetic every other canonical-text path uses — puts the text on.

const SRC = '| Metric | Value |\n| --- | --- |\n| one | 1 |\n| two | 2 |';
const GRID = layoutTable(parseTable(SRC, { start: 0, end: SRC.length }), 80).text;
const GRIDDED = `# Top\n\nintro\n\n${GRID}\n\n## Tail\n\nbottom`;

/** The 1-based line whose whole text is `needle`. */
function lineOf(text: string, needle: string): number {
  const i = text.split('\n').indexOf(needle);
  expect(i).toBeGreaterThanOrEqual(0);
  return i + 1;
}

/** GRIDDED with one tracked span over `region`, as the live editor tracks it. */
function tracking(region: string): EditorState {
  const from = GRIDDED.indexOf(region);
  const state = EditorState.create({ doc: GRIDDED, extensions: tableModeExtension() });
  // A signature the model no longer matches, so the span collapses to the
  // compact form — byte-identical to SRC here, so either branch of
  // collapseSpan yields the same canonical line count.
  const spans = [{ from, to: from + region.length, original: SRC, sig: 'stale' }];
  return state.update({ effects: setGridSet.of({ spans, width: 80 }) }).state;
}

describe('PRD 020 Req 18 (issue #260): raw editor line → canonical line', () => {
  test('U1189: a line below a grid names the canonical buffer’s line, one above it is unmoved', () => {
    const state = tracking(GRID);
    const canonical = canonicalizeAll(GRIDDED, state.field(tableModeField)!);
    const rawTail = lineOf(GRIDDED, '## Tail');
    const canonTail = lineOf(canonical, '## Tail');
    expect(canonTail).toBeLessThan(rawTail); // the grid really is the taller one
    expect(canonicalLineAt(state, state.doc.line(rawTail))).toBe(canonTail);
    // Above the grid nothing has drifted yet, in either text.
    const rawTop = lineOf(GRIDDED, '# Top');
    expect(lineOf(canonical, '# Top')).toBe(rawTop);
    expect(canonicalLineAt(state, state.doc.line(rawTop))).toBe(rawTop);
  });

  test('U1190: with no grid tracked, or a span that no longer parses, it is the identity canonicalizeAll also leaves', () => {
    const rawTail = lineOf(GRIDDED, '## Tail');
    const plain = EditorState.create({ doc: GRIDDED, extensions: tableModeExtension() });
    expect(canonicalLineAt(plain, plain.doc.line(rawTail))).toBe(rawTail);
    // A span over prose parses as no table: canonicalizeAll skips it, and so
    // does the line walk — the two stay in step rather than drifting apart.
    const broken = tracking('intro');
    expect(canonicalizeAll(GRIDDED, broken.field(tableModeField)!)).toBe(GRIDDED);
    expect(canonicalLineAt(broken, broken.doc.line(rawTail))).toBe(rawTail);
  });
});
