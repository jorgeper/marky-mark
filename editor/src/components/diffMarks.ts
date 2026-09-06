/**
 * SPEC16 §2 (issue #264): which editor lines the changes-since-save overlay
 * marks, and how — the pure seam under `Editor.tsx`'s `diffDecorations`.
 *
 * The sets arrive in CANONICAL line coordinates (the app diffs
 * `canonicalOf(buffer)`), while the decorations paint RAW editor lines. A
 * gridded table is taller on screen than in the file, so every raw line below
 * one runs ahead of its canonical line and the marks used to land N rows low
 * — the same drift issue #260 hit from the other direction.
 * `canonicalLineMapper` is that conversion, sharing `canonicalLineAt`'s
 * arithmetic; a canonical table row maps to every display row its cells
 * wrapped into, so a cell edit marks its own row(s) and nothing below.
 *
 * The one construct deliberately left unmarked is a RENDERED diagram fence:
 * `diagramView` replaces the whole block with a `block: true` widget, so its
 * source lines have no row on screen to tint — there is nothing to mark, and
 * inventing a marker on the drawing would point at a line the user cannot
 * read. Putting the caret in the fence reveals its source (PRD 013 Req 5),
 * and the lines tint normally from there.
 */
import type { EditorState } from '@codemirror/state';
import type { DiffLineSets, RemovedRun } from '../lib/diffLines';
import { canonicalLineMapper } from './tableMode';

/** One raw editor line and the treatments it carries (both can apply). */
export interface DiffLineMark {
  line: number;
  changed: boolean;
  deleted: boolean;
}

/**
 * SPEC16 §2 (issue #315): one red block of removed saved text and the raw
 * line it hangs off — below that line, or ABOVE it when the run preceded
 * line 1 (the only line that can host it).
 */
export interface DiffRemovedBlock {
  line: number;
  above: boolean;
  lines: string[];
}

/**
 * The raw row a deletion anchor lands on. The marker sits on the line the
 * deletion FOLLOWS: 0 means saved lines vanished before line 1, and an
 * anchor past the end (a stale set, mid-debounce, so the mapper yields
 * nothing) belongs on the last line — both are lines the user can see. A
 * mapped anchor takes its LAST raw row, so a deletion after a grid marks the
 * grid's bottom row rather than its top.
 */
function anchorRow(state: EditorState, docLinesAt: (n: number) => number[], n: number): number {
  const raw = n < 1 ? [1] : docLinesAt(n);
  return raw.length ? raw[raw.length - 1] : state.doc.lines;
}

export function diffLineMarks(
  state: EditorState,
  diff: Pick<DiffLineSets, 'changed' | 'deletedAfter'>
): DiffLineMark[] {
  const docLinesAt = canonicalLineMapper(state);
  const changed = new Set<number>();
  const deleted = new Set<number>();
  for (const n of diff.changed) for (const raw of docLinesAt(n)) changed.add(raw);
  for (const n of diff.deletedAfter) deleted.add(anchorRow(state, docLinesAt, n));
  // Changed and deleted both landing on one line is not a conflict — the two
  // treatments are independent, so the line carries both flags and the
  // caller paints both (`Editor.tsx`'s `changedAndDeletedLine`).
  return [...new Set([...changed, ...deleted])]
    .sort((a, b) => a - b)
    .map((line) => ({ line, changed: changed.has(line), deleted: deleted.has(line) }));
}

/**
 * SPEC16 §2 (issue #315): where each removed run's red block goes, in raw
 * lines — the same anchor rules as the edge marker (`anchorRow`), so a block
 * lands after a grid's LAST display row and a stale past-the-end anchor
 * still shows on the last line. A run before line 1 is the one case placed
 * ABOVE its row: there is no line above line 1 to hang it under.
 */
export function diffRemovedBlocks(state: EditorState, runs: readonly RemovedRun[]): DiffRemovedBlock[] {
  const docLinesAt = canonicalLineMapper(state);
  return runs.map((r) => ({ line: anchorRow(state, docLinesAt, r.after), above: r.after < 1, lines: r.lines }));
}
