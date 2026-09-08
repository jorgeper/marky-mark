/**
 * PRD 023 §§7–12 + §19 (issue #286): the annotation menu's context model and
 * the editor-side selection→rendered-text mapping, as one pure module. The
 * App computes this at menu-open (and on an annotation hotkey), converts it
 * to the editor package's SmartMenuAnnotations, and resolves the invoked row
 * against the same object — one rule for what each entry does.
 *
 * Coordinate spaces: `selFrom`/`selTo`/`head` index the editor's CANONICAL
 * text (`source` — issue #344, PRD 023 §19: table grids arrive collapsed to
 * their file form with the offsets mapped, so a grid-cell selection anchors
 * to real file text; the editor resolves caret-mark hits itself and hands in
 * `idsAtCaret`); `anchor` is rendered-plain-text offsets (the space
 * `createAnchor` and the preview use).
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
  /** The editor's canonical text (table grids collapsed — issue #344). */
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
 * PRD 023 §§8–11: the hit context a candidate id set resolves to — the
 * comment Delete Comment removes, and the highlight the color rows recolor
 * and Remove Highlight deletes. ONE kind-aware rule (`pickHitRecord`) over
 * both surfaces' candidates: the editor's ids under the caret (issue #286)
 * and the preview selection button's overlapping painted ranges (issue
 * #287). Filtering to highlights first is what keeps a comment at the same
 * spot from shadowing the recolor; among several highlights `pickHitRecord`'s
 * comment-free branch takes the first candidate. Ids naming no record, or a
 * kind that cannot answer the row, resolve to null.
 */
function hitContext(
  ids: readonly string[],
  records: readonly CommentData[]
): { deleteCommentId: string | null; highlightId: string | null } {
  const commentHit = pickHitRecord(ids, records);
  const commentRec = commentHit === null ? undefined : records.find((r) => r.id === commentHit);
  const highlightIds = ids.filter((id) => {
    const r = records.find((c) => c.id === id);
    return r !== undefined && !isComment(r);
  });
  return {
    deleteCommentId: commentRec && isComment(commentRec) ? commentRec.id : null,
    highlightId: pickHitRecord(highlightIds, records),
  };
}

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
  // inside an existing comment's painted range (a highlight's never counts);
  // `highlightId` is the caret's highlight, read below with no selection.
  const { deleteCommentId, highlightId } = hitContext(idsAtCaret, records);

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

  // No selection: the caret's highlight (the `hitContext` pick above) turns
  // the color rows into a recolor of that record — same id, no second
  // record — and arms Remove Highlight; the word under the caret is the
  // insert anchor.
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

export interface PreviewAnnotationInput {
  gate: AnnotationGate;
  /** The selection as rendered-plain-text offsets (rangeToOffsets — no
   * source→rendered mapping exists to fail in this surface). */
  start: number;
  end: number;
  /** The paint effect's resolved rendered range per record id (`positions`);
   * null/absent means the record is not painted in this surface. */
  positions: Readonly<Record<string, RenderedRange | null | undefined>>;
  records: readonly CommentData[];
  /**
   * Issue #343: the record a preview click activated, for the COLLAPSED
   * case — the click that activates a mark collapses the selection, so with
   * `end <= start` this record's own context builds the menu instead of
   * closing it. Null/absent ⇒ a collapsed selection closes as before.
   */
  activeId?: string | null;
}

/**
 * PRD 023 §13 + Reqs 8–9 (issue #287): the preview selection button's
 * context — the same model shape as the editor's, resolved for a surface
 * with NO caret. The selection is the only pointing context there, so it
 * plays both roles: it is the insert anchor for Insert Comment and the
 * color rows, AND it is the hit context — a selection overlapping an
 * existing comment's painted range arms Delete Comment, one overlapping a
 * highlight turns the color rows into a recolor of that record and arms
 * Remove Highlight. This is a deliberate reading of Reqs 8–9: "a selection
 * always wins over caret context" disambiguates two competing contexts in
 * the editor, and applying it literally here would make recolor/remove
 * unreachable from the preview. The consequence is pinned: a second
 * highlight overlapping an existing one is not authorable from the preview
 * button (Req 5's overlap case — a comment over a highlight — stays
 * authorable). Records are picked by the existing kind-aware rule
 * (pickHitRecord) over the overlapping painted ranges in document order,
 * never a second divergent rule.
 */
export function previewAnnotationModel(input: PreviewAnnotationInput): AnnotationMenuModel {
  const { gate, start, end, positions, records, activeId = null } = input;
  if (!gate.commentsEnabled || gate.authoringFrozen || !gate.canWrite) return CLOSED;
  if (end <= start) {
    // Issue #343 (PRD 023 §13): no selection, but a record a preview click
    // just activated and that paints on this surface — the button grows
    // from that record's own context: Delete Comment for a comment, the
    // color rows as a recolor and Remove Highlight for a highlight. Rows
    // that need a fresh selection anchor (Insert Comment, a new highlight
    // over plain text) are disabled, never mis-anchored (§19). With no
    // such record a collapsed selection closes as before.
    if (activeId === null || positions[activeId] == null) return CLOSED;
    const { deleteCommentId, highlightId } = hitContext([activeId], records);
    if (deleteCommentId === null && highlightId === null) return CLOSED; // names no record
    return {
      show: true,
      anchor: null,
      insertCommentEnabled: false,
      deleteCommentId,
      colorsEnabled: highlightId !== null,
      recolorId: highlightId,
      removeHighlightId: highlightId,
    };
  }

  // The ids whose painted range overlaps the selection, in document order
  // (painted start) — this surface's candidates, the role the editor's caret
  // ids play there. An overlapped highlight makes the color rows a recolor of
  // that record (same id, never a second one); with none they insert over the
  // selection.
  const overlapping = records
    .map((r) => ({ id: r.id, m: positions[r.id] }))
    .filter((x): x is { id: string; m: RenderedRange } =>
      x.m != null && x.m.start < end && x.m.end > start
    )
    .sort((a, b) => a.m.start - b.m.start)
    .map((x) => x.id);
  const { deleteCommentId, highlightId } = hitContext(overlapping, records);

  return {
    show: true,
    // Straight from the rendered DOM — always a confident anchor.
    anchor: { start, end },
    insertCommentEnabled: true,
    deleteCommentId,
    colorsEnabled: true,
    recolorId: highlightId,
    removeHighlightId: highlightId,
  };
}
