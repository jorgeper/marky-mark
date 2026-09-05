/**
 * PRD 023 §5 (issue #285): the kind-aware rule that picks ONE record from the
 * annotation marks stacked under a click. Both surfaces feed it their
 * candidates — the preview walks the clicked mark's `mark.hl` ancestor chain,
 * the editor reports every painted range covering the click position — and
 * both resolve through this one pure rule, never by DOM depth or array order.
 */

import { isComment, type CommentData } from './anchoring';

/**
 * PRD 023 §5 (issue #285): pick the record the pane can host. A comment wins
 * over a highlight (the comment has a card, a thread, a lifecycle — the
 * highlight's whole surface is its paint); among several overlapping
 * comments the INNERMOST wins, pinned as the greatest `anchor.start` (the
 * latest-starting range is the most specific one under the pointer), with
 * candidate order breaking a start tie. Ids naming no record are ignored;
 * an id set with nothing hostable resolves to null (the click falls through
 * to ordinary text behaviour).
 */
export function pickHitRecord(ids: readonly string[], records: readonly CommentData[]): string | null {
  const hit = ids
    .map((id) => records.find((r) => r.id === id))
    .filter((r): r is CommentData => r !== undefined);
  if (hit.length === 0) return null;
  const comments = hit.filter(isComment);
  if (comments.length === 0) return hit[0].id;
  let best = comments[0];
  for (const c of comments) if (c.anchor.start > best.anchor.start) best = c;
  return best.id;
}
