import { describe, expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { diffLineMarks, diffRemovedBlocks } from '../src/components/diffMarks';
import { canonicalizeAll, setGridSet, tableModeExtension, tableModeField } from '../src/components/tableMode';
import { diffLineSets } from '../src/lib/diffLines';
import { layoutTable, parseTable } from '../src/lib/tableEdit';

// SPEC16 §2 (issue #264): the changes-since-save sets are computed by the app
// over the CANONICAL buffer (tables collapsed) and painted on RAW editor lines
// (tables gridded). A grid is taller than its source, so without a conversion
// every mark below the first table lands rows too low — the drift this seam
// exists to remove.

const SRC = '| Metric | Value |\n| --- | --- |\n| one | 1 |\n| two | 2 |';
const GRID = layoutTable(parseTable(SRC, { start: 0, end: SRC.length }), 80).text;
const DOC = `---\ntitle: t\n---\n\nintro\n\n${GRID}\n\n![pic](a.png)\n\n\`\`\`js\ncode()\n\`\`\`\n\ntail`;

/** The 1-based line whose whole text is `needle`. */
function lineOf(text: string, needle: string): number {
  const i = text.split('\n').indexOf(needle);
  expect(i).toBeGreaterThanOrEqual(0);
  return i + 1;
}

/** DOC with the grid tracked as one span, exactly as the live editor tracks it. */
function gridded(): EditorState {
  const from = DOC.indexOf(GRID);
  const state = EditorState.create({ doc: DOC, extensions: tableModeExtension() });
  // A signature the model no longer matches, so the span collapses to the
  // compact form — byte-identical to SRC here, so either branch of the
  // collapse yields the same canonical line count.
  const spans = [{ from, to: from + GRID.length, original: SRC, sig: 'stale' }];
  return state.update({ effects: setGridSet.of({ spans, width: 80 }) }).state;
}

const canonicalOf = (state: EditorState) => canonicalizeAll(state.doc.toString(), state.field(tableModeField)!);
const changedLines = (marks: ReturnType<typeof diffLineMarks>) =>
  marks.filter((m) => m.changed).map((m) => m.line);
const deletedLines = (marks: ReturnType<typeof diffLineMarks>) =>
  marks.filter((m) => m.deleted).map((m) => m.line);

describe('SPEC16 §2 (issue #264): changes-since-save marks in raw editor lines', () => {
  test('U1191: an edit below a gridded table tints exactly its own raw line', () => {
    const state = gridded();
    const canonical = canonicalOf(state);
    const rawTail = lineOf(DOC, 'tail');
    const canonTail = lineOf(canonical, 'tail');
    expect(canonTail).toBeLessThan(rawTail); // the grid really is the taller one
    const diff = diffLineSets(canonical, canonical.replace('tail', 'TAIL'));
    expect(diff.changed).toEqual([canonTail]); // the app's canonical coordinate
    expect(changedLines(diffLineMarks(state, diff))).toEqual([rawTail]);
    // Above the grid nothing drifted, in either text.
    const rawIntro = lineOf(DOC, 'intro');
    expect(changedLines(diffLineMarks(state, { changed: [rawIntro], deletedAfter: [] }))).toEqual([
      rawIntro,
    ]);
  });

  test('U1192: a canonical table row maps to its own display rows — header, separator, body', () => {
    const state = gridded();
    const canonical = canonicalOf(state);
    const canonHeader = lineOf(canonical, '| Metric | Value |');
    const display = GRID.split('\n');
    const rawGridFirst = DOC.split('\n').indexOf(display[0]) + 1;
    const rowLine = (needle: string) => rawGridFirst + display.findIndex((l) => l.includes(needle));
    // Header row → the display's header cells row; separator → the grid's
    // alignment separator; body row `two` → the display row carrying it.
    expect(changedLines(diffLineMarks(state, { changed: [canonHeader], deletedAfter: [] }))).toEqual([
      rowLine('Metric'),
    ]);
    const sepMarks = changedLines(diffLineMarks(state, { changed: [canonHeader + 1], deletedAfter: [] }));
    expect(sepMarks).toHaveLength(1);
    expect(display[sepMarks[0] - rawGridFirst]).toMatch(/^[|+ :-]+$/);
    expect(changedLines(diffLineMarks(state, { changed: [canonHeader + 3], deletedAfter: [] }))).toEqual([
      rowLine('two'),
    ]);
  });

  test('U1193: a changed line that is also a deletion anchor keeps both treatments', () => {
    const state = gridded();
    const marks = diffLineMarks(state, { changed: [5], deletedAfter: [5] });
    expect(marks).toEqual([{ line: 5, changed: true, deleted: true }]);
  });

  test('U1194: deletion markers at both document edges land on a visible line', () => {
    const state = gridded();
    const lines = state.doc.lines;
    // 0 = saved text lost lines before line 1 → the marker rides line 1.
    expect(deletedLines(diffLineMarks(state, { changed: [], deletedAfter: [0] }))).toEqual([1]);
    // An anchor past the canonical end (a stale set, mid-debounce) rides the
    // last line rather than vanishing.
    expect(deletedLines(diffLineMarks(state, { changed: [], deletedAfter: [lines + 50] }))).toEqual([
      lines,
    ]);
    // An anchor ON the grid marks the grid's BOTTOM display row: the deletion
    // followed the whole table, not its first row.
    const canonHeader = lineOf(canonicalOf(state), '| Metric | Value |');
    const display = GRID.split('\n');
    const rawGridFirst = DOC.split('\n').indexOf(display[0]) + 1;
    expect(deletedLines(diffLineMarks(state, { changed: [], deletedAfter: [canonHeader + 3] }))).toEqual([
      rawGridFirst + display.length - 1,
    ]);
  });

  test('U1195: with no grid tracked the marks are the identity, and an unedited buffer marks nothing', () => {
    const plain = EditorState.create({ doc: DOC, extensions: tableModeExtension() });
    const rawTail = lineOf(DOC, 'tail');
    expect(changedLines(diffLineMarks(plain, { changed: [rawTail], deletedAfter: [] }))).toEqual([rawTail]);
    // An identical buffer produces empty sets, and empty sets produce no marks.
    expect(diffLineSets(DOC, DOC)).toEqual({ changed: [], deletedAfter: [], removed: [] });
    expect(diffLineMarks(plain, { changed: [], deletedAfter: [] })).toEqual([]);
    // A canonical line past the document's end is dropped, never clamped onto
    // an unrelated construct.
    expect(diffLineMarks(plain, { changed: [plain.doc.lines + 20], deletedAfter: [] })).toEqual([]);
    // A tracked span that no longer parses as a display table is skipped
    // exactly as canonicalizeAll skips it — the walk stays in step.
    const broken = plain.update({
      effects: setGridSet.of({
        spans: [{ from: DOC.indexOf('intro'), to: DOC.indexOf('intro') + 5, original: 'intro', sig: 'x' }],
        width: 80,
      }),
    }).state;
    expect(canonicalizeAll(DOC, broken.field(tableModeField)!)).toBe(DOC);
    expect(changedLines(diffLineMarks(broken, { changed: [rawTail], deletedAfter: [] }))).toEqual([rawTail]);
  });
});

// SPEC16 §2 (issue #315): the removed runs' red blocks follow the same
// anchor rules as the edge marker, in raw editor lines.
describe('SPEC16 §2 (issue #315): removed-run blocks in raw editor lines', () => {
  test('U1256: a run after a gridded row hangs under the grid’s LAST display row; the identity holds without a grid', () => {
    const state = gridded();
    const canonHeader = lineOf(canonicalOf(state), '| Metric | Value |');
    const display = GRID.split('\n');
    const rawGridFirst = DOC.split('\n').indexOf(display[0]) + 1;
    expect(diffRemovedBlocks(state, [{ after: canonHeader + 3, lines: ['gone'] }])).toEqual([
      { line: rawGridFirst + display.length - 1, above: false, lines: ['gone'] },
    ]);
    // Below the grid the anchor drifts by the grid's extra rows, like the marks.
    const rawTail = lineOf(DOC, 'tail');
    const canonTail = lineOf(canonicalOf(state), 'tail');
    expect(diffRemovedBlocks(state, [{ after: canonTail, lines: ['a', 'b'] }])).toEqual([
      { line: rawTail, above: false, lines: ['a', 'b'] },
    ]);
    const plain = EditorState.create({ doc: DOC, extensions: tableModeExtension() });
    expect(diffRemovedBlocks(plain, [{ after: 5, lines: ['x'] }])).toEqual([{ line: 5, above: false, lines: ['x'] }]);
    expect(diffRemovedBlocks(plain, [])).toEqual([]);
  });

  test('U1257: a run before line 1 sits ABOVE line 1, and a stale past-the-end anchor rides the last line', () => {
    const state = gridded();
    expect(diffRemovedBlocks(state, [{ after: 0, lines: ['first'] }])).toEqual([
      { line: 1, above: true, lines: ['first'] },
    ]);
    expect(diffRemovedBlocks(state, [{ after: state.doc.lines + 50, lines: ['late'] }])).toEqual([
      { line: state.doc.lines, above: false, lines: ['late'] },
    ]);
    // Real sets flow through end to end: deleting `intro` from the canonical
    // text carries its text and lands under the raw line above it.
    const canonical = canonicalOf(state);
    const diff = diffLineSets(canonical, canonical.replace('intro\n', ''));
    expect(diff.removed).toEqual([{ after: lineOf(DOC, 'intro') - 1, lines: ['intro'] }]);
    expect(diffRemovedBlocks(state, diff.removed)).toEqual([
      { line: lineOf(DOC, 'intro') - 1, above: false, lines: ['intro'] },
    ]);
  });
});
