/**
 * PRD 016 Req 9: what a merged save does to the document — as a pure
 * function, in the spirit of `planSaveConflict` in lib/saveConflict.ts. No
 * DOM, no platform import: App dispatches this rather than re-deciding
 * inline, so the rules below are unit-testable and stated exactly once.
 *
 * The rules, and why each one:
 *  - the buffer becomes what a FRESH OPEN of the merged file would show, so
 *    the editor is never left displaying text the server no longer holds;
 *  - it is SAVED at that text, because the merged bytes are what landed —
 *    leaving it dirty would invite a second save that clobbers the merge;
 *  - the caret is clamped, never reset, because a merge that touched lines
 *    the user is nowhere near must not throw them back to line 1;
 *  - the user is TOLD, through a non-blocking notice — their save succeeded,
 *    so there is nothing to answer and no dialog to show.
 */

import type { CommentData } from './anchoring';
import { normalizeEol } from './dirty';
import { mergeComments, splitEmbedded } from './embedded';

export interface MergedSaveInput {
  /** The file text the server stored — trailer and all, if it has one. */
  mergedText: string;
  /** Comments already loaded from the sidecar store, if that mode is active. */
  sidecarComments: CommentData[];
  /** PRD 007 Req 17: false when this session may not read comments at all. */
  mayReadComments: boolean;
  /** The editor selection before the save, as offsets into the old buffer. */
  selection: { from: number; to: number };
}

export interface MergedSavePlan {
  /** The merged document body — what the editor shows. */
  buffer: string;
  /** What the buffer counts as saved at. Equal to `buffer`: clean. */
  savedText: string;
  comments: CommentData[];
  /** An unreadable trailer in the merged text, handled as `openDoc` does. */
  stores: { trailer: { declaredVersion: unknown } | null; trailerBytes: string | null };
  /** The selection, clamped into the merged buffer. Never reset to 0. */
  selection: { from: number; to: number };
  /** The transient notice to show. Non-blocking, self-dismissing. */
  notice: string;
  /** Spelled out so it can never drift: a merged save shows NO dialog. */
  dialog: false;
}

/** PRD 016 Req 9: the notice — one wording, so tests and UI cannot disagree. */
export const MERGED_SAVE_NOTICE = 'Saved — changes from someone else were merged in';

export function planMergedSave(input: MergedSaveInput): MergedSavePlan {
  // Exactly the split `loadDocParts` performs on a fresh read, including the
  // load-time EOL normalization — so a merged save and a reopen of the same
  // bytes leave the document in the same state, dirty flag included.
  const split = splitEmbedded(input.mergedText);
  const buffer = normalizeEol(split.content);
  const clamp = (offset: number): number => Math.min(Math.max(offset, 0), buffer.length);
  return {
    buffer,
    savedText: buffer,
    comments: input.mayReadComments ? mergeComments(split.comments, input.sidecarComments) : [],
    stores: {
      trailer: split.readable ? null : { declaredVersion: split.declaredVersion },
      trailerBytes: split.readable ? null : split.trailerBytes ?? null,
    },
    // Best effort by contract: a merged text shorter than the buffer clamps
    // rather than throwing, and exactness is explicitly not required.
    selection: { from: clamp(input.selection.from), to: clamp(input.selection.to) },
    notice: MERGED_SAVE_NOTICE,
    dialog: false,
  };
}
