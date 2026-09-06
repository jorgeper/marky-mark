/**
 * SPEC16 §2 (issue #264): which editor lines the changes-since-save overlay
 * marks, and how — the pure seam under `Editor.tsx`'s `diffDecorations`.
 *
 * The sets arrive in CANONICAL line coordinates (the app diffs
 * `canonicalOf(buffer)`), while the decorations paint RAW editor lines. A
 * gridded table is taller on screen than in the file, so every raw line below
 * one runs ahead of its canonical line and the marks used to land N rows low
 * — the same drift issue #260 hit from the other direction.
 * `docLinesAtCanonical` is that conversion, sharing `canonicalLineAt`'s
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
import type { DiffLineSets } from '../lib/diffLines';
import { docLinesAtCanonical } from './tableMode';

/** One raw editor line and the treatments it carries (both can apply). */
export interface DiffLineMark {
  line: number;
  changed: boolean;
  deleted: boolean;
}

export function diffLineMarks(state: EditorState, diff: DiffLineSets): DiffLineMark[] {
  const lines = state.doc.lines;
  const changed = new Set<number>();
  const deleted = new Set<number>();
  for (const n of diff.changed) for (const raw of docLinesAtCanonical(state, n)) changed.add(raw);
  for (const n of diff.deletedAfter) {
    // The marker sits on the line the deletion FOLLOWS: 0 means saved lines
    // vanished before line 1, and an anchor past the end (a stale set,
    // mid-debounce) belongs on the last line — both are lines the user can
    // see. A mapped anchor takes its LAST raw row, so a deletion after a grid
    // marks the grid's bottom row rather than its top.
    const raw = n < 1 ? [1] : docLinesAtCanonical(state, n);
    deleted.add(raw.length ? Math.min(Math.max(raw[raw.length - 1], 1), lines) : lines);
  }
  // A deletion whose anchor line was itself edited needs BOTH treatments: the
  // one Map keyed by line this replaced let the changed tint overwrite the
  // deletion marker, losing the only sign that text vanished there.
  return [...new Set([...changed, ...deleted])]
    .sort((a, b) => a - b)
    .map((line) => ({ line, changed: changed.has(line), deleted: deleted.has(line) }));
}
