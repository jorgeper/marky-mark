/**
 * PRD 023 §14/§15/§17 (issue #284): one pure predicate pair decides where the
 * comments pane and its edge chevron exist. The pane is a third workspace
 * pane in EVERY document mode (plain edit, full preview, split), so unlike
 * the retired in-preview aside its gate never reads the view mode — only the
 * master switch, an open document, and (for the pane itself) the persisted
 * open/closed setting.
 */

export interface CommentsPaneState {
  /** The `commentsEnabled` master switch (SPEC7 §2): off ⇒ no pane, no chevron. */
  commentsEnabled: boolean;
  /** The persisted pane setting (PRD 023 §15) — `settings.showComments`. */
  showComments: boolean;
  /** A document is open (a file or the untitled buffer) — comments belong to one. */
  docOpen: boolean;
  /** PRD 011 Req 17: semantic zoom replaces the document view outright. */
  zoomed: boolean;
}

/**
 * PRD 023 §14: the second chevron (and the seam it toggles) exists wherever a
 * document could host comments — independent of whether the pane is open, so
 * the closed pane can always be reopened from the same spot.
 */
export function commentsSeamUp(s: CommentsPaneState): boolean {
  return s.commentsEnabled && s.docOpen && !s.zoomed;
}

/** PRD 023 §15: the pane is on screen — the seam exists and the setting says open. */
export function commentsPaneOpen(s: CommentsPaneState): boolean {
  return commentsSeamUp(s) && s.showComments;
}
