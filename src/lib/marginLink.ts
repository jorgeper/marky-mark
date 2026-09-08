/**
 * Issue #343 (PRD 020 Reqs 14–15, PRD 022 Reqs 10–11, PRD 023 §5): which
 * record the left-margin copy-link addresses, as one pure rule both
 * surfaces share.
 *
 * The editor asks with the painted ids covering the selection head
 * (`AnnotationSelection.idsAtHead`, canonical coordinates — issue #344); the
 * preview asks with the painted ranges covering a selection's start offset.
 * Both resolve through the ONE kind-aware pick (`pickHitRecord`): a comment
 * wins over a highlight, the innermost comment among several — so the margin
 * control, the click activation and the menu context always name the same
 * record. The label names the target's kind (the issue #227 rule); the URL is
 * the caller's, read at click time like every placement.
 */
import { isComment, type CommentData } from './anchoring';
import { pickHitRecord } from './markHit';
import { COPY_LINK_COMMENT_LABEL, COPY_LINK_HIGHLIGHT_LABEL } from './shareLinks';

/** The record a margin copy-link addresses: its id and rest label. */
export interface MarginLinkPick {
  id: string;
  kind: 'comment' | 'highlight';
  label: string;
}

/** Issue #343: the rest tooltip / accessible name for a record of either kind. */
export function marginLinkLabel(rec: CommentData): string {
  return isComment(rec) ? COPY_LINK_COMMENT_LABEL : COPY_LINK_HIGHLIGHT_LABEL;
}

/**
 * Issue #343: the record the margin copy-link addresses among the painted
 * ids under the caret / selection head — null when none names a record, so
 * plain text grows no control.
 */
export function marginLinkPick(ids: readonly string[], records: readonly CommentData[]): MarginLinkPick | null {
  const id = pickHitRecord(ids, records);
  const rec = id === null ? undefined : records.find((r) => r.id === id);
  if (!rec) return null;
  return { id: rec.id, kind: isComment(rec) ? 'comment' : 'highlight', label: marginLinkLabel(rec) };
}

/**
 * Issue #343: the preview surface's candidates — the records whose painted
 * rendered-text range covers `offset` (a selection's start), in document
 * order by painted start, so `marginLinkPick` sees them the way the click
 * seam's mark chain arrives. A record painting nowhere on this surface
 * (`null`/absent position) is never a candidate.
 */
export function recordAtOffset(
  offset: number,
  positions: Readonly<Record<string, { start: number; end: number } | null | undefined>>,
  records: readonly CommentData[]
): MarginLinkPick | null {
  const covering = records
    .map((r) => ({ id: r.id, m: positions[r.id] }))
    .filter((x): x is { id: string; m: { start: number; end: number } } =>
      x.m != null && x.m.start <= offset && x.m.end > offset
    )
    .sort((a, b) => a.m.start - b.m.start)
    .map((x) => x.id);
  return marginLinkPick(covering, records);
}
