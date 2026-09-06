/**
 * PRD 023 §§7–12 + §19 (issue #286): the annotation menu's context model and
 * the editor-side selection→rendered-text mapping, as one pure module. The
 * App computes this at menu-open (and on an annotation hotkey), converts it
 * to the editor package's SmartMenuAnnotations, and resolves the invoked row
 * against the same object — one rule for what each entry does.
 *
 * Coordinate spaces: `selFrom`/`selTo`/`head` index the editor DOCUMENT text
 * (`source`, table-grid form included — the editor resolves caret-mark hits
 * itself and hands in `idsAtCaret`); `anchor` is rendered-plain-text offsets
 * (the space `createAnchor` and the preview use).
 */

import {
  countNormalized,
  findNormalized,
  findNormalizedNth,
  visibleTextForRange,
  wordAt,
} from '@marky-mark/editor';
import { isComment, type CommentData } from './anchoring';
import { pickHitRecord } from './markHit';

/** A confidently-located rendered-text range (createAnchor's arguments). */
export interface RenderedRange {
  start: number;
  end: number;
}

/**
 * PRD 023 §19 (issue #286): map a canonical-source range onto the rendered
 * plain text, or null when the mapping is not confident — the PRD 022 Req 12
 * skip rule extended to authoring: no entry ever writes a guessed anchor.
 * Confident means: the range's visible text is non-empty, occurs in the
 * rendered text, and either occurs exactly once or the source-side occurrence
 * count agrees with the rendered-side count (both counted by the SPEC44 §3.1
 * normalized rule), so the source-side index picks the one rendered match.
 */
export function mapSourceRangeToRendered(
  source: string,
  rendered: string,
  from: number,
  to: number
): RenderedRange | null {
  if (to <= from || !rendered) return null;
  const needle = visibleTextForRange(source, from, to);
  if (!needle.replace(/\s+/g, ' ').trim()) return null; // renders away (syntax, fences)
  const total = countNormalized(rendered, needle);
  if (total === 0) return null;
  if (total === 1) {
    const hit = findNormalized(rendered, needle);
    return hit ? { start: hit.start, end: hit.end } : null;
  }
  // Several rendered occurrences: only the matching source-side count makes
  // the source-computed index trustworthy; a disagreement means the two
  // spaces diverged and no occurrence is a confident winner.
  const sourceVisible = visibleTextForRange(source, 0, source.length);
  if (countNormalized(sourceVisible, needle) !== total) return null;
  const nth = countNormalized(visibleTextForRange(source, 0, from), needle);
  const hit = findNormalizedNth(rendered, needle, nth);
  return hit ? { start: hit.start, end: hit.end } : null;
}

/** PRD 023 §7 (issue #286): the authoring gate — the popup's, unchanged. */
export interface AnnotationGate {
  commentsEnabled: boolean;
  /** PRD 004 Req 15: an unreadable store freezes every authoring route. */
  authoringFrozen: boolean;
  /** PRD 007 Req 17: `comment.write` for the open document. */
  canWrite: boolean;
}

export interface AnnotationMenuInput {
  gate: AnnotationGate;
  /** The editor document text (table-grid form included). */
  source: string;
  /** The rendered plain text (cached for edit mode; the preview's docText). */
  rendered: string;
  /** Selection and caret as offsets into `source`. */
  selFrom: number;
  selTo: number;
  head: number;
  /**
   * Painted annotation ids covering the caret, document order — resolved by
   * the editor package's own canonical→doc mapping (the click seam's), so
   * caret context agrees with what is visibly painted, grids included.
   */
  idsAtCaret: readonly string[];
  records: readonly CommentData[];
}

export interface AnnotationMenuModel {
  /** False ⇒ the gate is closed and neither entry appears at all. */
  show: boolean;
  /** Insert Comment / color-row insert target, rendered offsets, or null. */
  anchor: RenderedRange | null;
  insertCommentEnabled: boolean;
  /** The comment record the caret sits in (kind-aware pick), or null. */
  deleteCommentId: string | null;
  colorsEnabled: boolean;
  /** No selection + caret on a highlight ⇒ the color rows recolor this id. */
  recolorId: string | null;
  /** Same context as recolor: the highlight Remove Highlight deletes. */
  removeHighlightId: string | null;
}

const CLOSED: AnnotationMenuModel = {
  show: false,
  anchor: null,
  insertCommentEnabled: false,
  deleteCommentId: null,
  colorsEnabled: false,
  recolorId: null,
  removeHighlightId: null,
};

/**
 * PRD 023 §§8–11 (issue #286): the one context rule for the Comment and
 * Highlight entries. A selection always wins over caret context: it is the
 * insert target for Insert Comment and every color row (even overlapping an
 * existing record), and it disables recolor/Remove Highlight. With no
 * selection, the caret's word is the insert anchor (SPEC44 §1 `wordAt`, left
 * affinity), a caret on a highlight turns the color rows into recolor and
 * arms Remove Highlight, and a caret in an existing comment's painted range
 * enables Delete Comment (kind-aware pick, `pickHitRecord`). Rows whose
 * mapping is ambiguous are disabled, never mis-anchored (§19).
 */
export function annotationMenuModel(input: AnnotationMenuInput): AnnotationMenuModel {
  const { gate, source, rendered, selFrom, selTo, head, idsAtCaret, records } = input;
  if (!gate.commentsEnabled || gate.authoringFrozen || !gate.canWrite) return CLOSED;

  const hasSelection = selFrom < selTo;

  // Delete Comment is caret context by its own condition — the caret sits
  // inside an existing comment's painted range (a highlight's never counts).
  const commentHit = pickHitRecord(idsAtCaret, records);
  const commentRec = commentHit === null ? undefined : records.find((r) => r.id === commentHit);
  const deleteCommentId = commentRec && isComment(commentRec) ? commentRec.id : null;

  if (hasSelection) {
    const anchor = mapSourceRangeToRendered(source, rendered, selFrom, selTo);
    return {
      show: true,
      anchor,
      insertCommentEnabled: anchor !== null,
      deleteCommentId,
      colorsEnabled: anchor !== null,
      recolorId: null,
      removeHighlightId: null,
    };
  }

  // No selection: a caret on an existing highlight makes the color rows a
  // recolor of that record (same id, no second record) and arms Remove
  // Highlight; among several overlapping highlights the kind-aware pick over
  // the highlight candidates chooses (comments never shadow a recolor).
  const highlightIds = idsAtCaret.filter((id) => {
    const r = records.find((c) => c.id === id);
    return r !== undefined && !isComment(r);
  });
  const highlightId = pickHitRecord(highlightIds, records);

  // The word under the caret is the no-selection insert anchor.
  const w = wordAt(source, head);
  const wordAnchor = w ? mapSourceRangeToRendered(source, rendered, w.start, w.end) : null;

  return {
    show: true,
    anchor: wordAnchor,
    insertCommentEnabled: wordAnchor !== null,
    deleteCommentId,
    colorsEnabled: highlightId !== null || wordAnchor !== null,
    recolorId: highlightId,
    removeHighlightId: highlightId,
  };
}
