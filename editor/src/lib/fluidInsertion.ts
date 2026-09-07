/**
 * PRD 025 Req 13 (issue #337): Fluid mode — the insertion-effect decision as
 * a pure function. Nothing here touches a view: the editor hands it a plain
 * descriptor of the transaction it just applied (what `iterChanges` yielded,
 * measured against the new document) and gets back the spans to mask. The
 * geometry the effect draws with is the existing `fluidSelectionRects` (the
 * mask over the inserted range) and `fluidDeletionBox` (the Pop copy), so
 * only the decision is new — unit-tested with plain numbers (Req 21).
 */

import { isFluidLargeOperation } from './fluid';

/** PRD 025 Req 7: the two effects the applicability table allows on an insertion. */
export type FluidInsertionEffect = 'fade' | 'pop';

/**
 * One changed range of an applied transaction, as `ChangeSet.iterChanges`
 * yields it, seen from the insertion side: where the inserted text now sits
 * in the new document (`fromB`..`toB`), how many characters and start-document
 * lines the range removed in its place (`toA - fromA`, and
 * `lineAt(toA).number - lineAt(fromA).number + 1` on the start document), and
 * how many new-document lines the inserted range touches
 * (`lineAt(toB).number - lineAt(fromB).number + 1`).
 */
export interface FluidInsertedSpan {
  fromB: number;
  toB: number;
  removedLength: number;
  removedLines: number;
  insertedLines: number;
}

/** PRD 025 Req 13: what the decision needs to know about one applied transaction. */
export interface FluidInsertionDescriptor {
  docChanged: boolean;
  /** CodeMirror's `Transaction.userEvent` annotation, or null when absent. */
  userEvent: string | null;
  spans: FluidInsertedSpan[];
}

/** PRD 025 Req 13: the user event of an IME composition step — text still being decided, which must stay readable. */
const COMPOSE_USER_EVENT = 'input.type.compose';

/**
 * PRD 025 Reqs 13, 14: which inserted spans of one transaction get an effect.
 * Nothing when the document did not change, no span inserts text (Backspace,
 * Delete, cut, delete-line, a removal-only undo/redo), or the transaction is
 * an IME composition step. Every other inserting span is returned whether or
 * not it also removed text — typing or pasting over a selection, a
 * completion, a smart-edit or table-edit rewrite are insertions of their new
 * text — whatever the user event (`input.type`, `input.paste`, `input.drop`,
 * `undo`, `redo`, or none for a host `applyEdit` / vim `p`), unless the whole
 * change is a large operation by `isFluidLargeOperation`: the eligible spans'
 * total inserted characters or lines, OR their total removed characters or
 * lines, strictly over a threshold empties the list (select-all + type on a
 * long document draws nothing).
 */
export function fluidInsertionSpans(d: FluidInsertionDescriptor): FluidInsertedSpan[] {
  if (!d.docChanged) return [];
  if (d.userEvent === COMPOSE_USER_EVENT) return [];
  const insertions = d.spans.filter((s) => s.toB > s.fromB);
  if (insertions.length === 0) return [];
  let insertedChars = 0;
  let insertedLines = 0;
  let removedChars = 0;
  let removedLines = 0;
  for (const s of insertions) {
    insertedChars += s.toB - s.fromB;
    insertedLines += s.insertedLines;
    removedChars += s.removedLength;
    removedLines += s.removedLines;
  }
  if (isFluidLargeOperation(insertedChars, insertedLines) || isFluidLargeOperation(removedChars, removedLines)) {
    return [];
  }
  return insertions;
}
