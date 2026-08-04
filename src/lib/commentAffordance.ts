/**
 * Issue #38: one pure predicate decides which surface may offer the
 * "Add comment" affordance for the current selection. Mirrors the floating
 * button's gate in App.tsx (SPEC7 §2, PRD 004 Req 15) and extends it to
 * plain edit mode, which previously offered no route to a comment at all.
 */

export interface AffordanceState {
  mode: 'preview' | 'edit';
  /** The persisted split-edit setting (SPEC25). */
  splitEdit: boolean;
  /** A non-empty selection exists on the active surface. */
  hasSelection: boolean;
  /** The session Comments toggle (Mod+Shift+C). */
  showComments: boolean;
  /** The master switch (SPEC7 §2). */
  commentsEnabled: boolean;
  /** A composer is already open for a pending anchor. */
  composerOpen: boolean;
  /** PRD 004 Req 15: an unreadable store freezes every authoring route. */
  authoringFrozen: boolean;
}

/**
 * Where the affordance may appear: on the preview surface (full preview or
 * the split-edit live preview, where anchors come straight from the rendered
 * DOM), in plain edit mode (where acting on it routes through the SPEC25
 * selection carry), or nowhere.
 */
export function commentAffordanceSurface(s: AffordanceState): 'preview' | 'edit' | null {
  if (!s.hasSelection || !s.showComments || !s.commentsEnabled || s.composerOpen || s.authoringFrozen) {
    return null;
  }
  return s.mode === 'preview' || s.splitEdit ? 'preview' : 'edit';
}
