/**
 * PRD 003 Reqs 9–12: the pane open/close slide phases. Both side panes
 * (folders, split preview) unmount when hidden, so the exit slide needs a
 * lifecycle that keeps the pane in the DOM until the transition ends, and
 * the entry slide needs one painted off-screen frame before the transition
 * to the resting position can run:
 *
 *   closed → pre-open → opening → open → closing → closed
 *
 * The functions here are the pure transition table; the React wiring
 * (layout effect + rAF for the pre-open frame + settle timer) lives in
 * App.tsx. Under prefers-reduced-motion the intermediate phases are skipped
 * entirely — the pane switches instantly (Req 11).
 */

export type SlidePhase = 'closed' | 'pre-open' | 'opening' | 'open' | 'closing';

/** Duration of the slide — the app's motion language (.toolbar-shell). */
export const SLIDE_MS = 180;

/** When the settle timer fires: transition end plus a couple of frames of
 *  slack (the transition itself starts ~2 rAFs after the toggle). A late
 *  settle is invisible — the pane rests fully off-screen (close) or at its
 *  exact layout position (open). */
export const SLIDE_SETTLE_MS = SLIDE_MS + 100;

/** The pane's desired visibility flipped (or was re-asserted). */
export function slideOnToggle(phase: SlidePhase, open: boolean, reduced: boolean): SlidePhase {
  if (reduced) return open ? 'open' : 'closed';
  if (open) {
    if (phase === 'open' || phase === 'opening' || phase === 'pre-open') return phase;
    // Reopened mid-close: already mounted and positioned, animate from here.
    if (phase === 'closing') return 'opening';
    return 'pre-open';
  }
  return phase === 'closed' ? 'closed' : 'closing';
}

/** The pre-open frame has been painted; the slide to open may start. */
export function slideOnFrame(phase: SlidePhase): SlidePhase {
  return phase === 'pre-open' ? 'opening' : phase;
}

/** The settle timer fired: the transition (if any) has finished. */
export function slideOnSettle(phase: SlidePhase): SlidePhase {
  if (phase === 'pre-open' || phase === 'opening') return 'open';
  if (phase === 'closing') return 'closed';
  return phase;
}

/** Whether the pane should be in the DOM. `open` covers the render between
 *  the setting flipping on and the phase catching up in the layout effect. */
export function slideMounted(phase: SlidePhase, open: boolean): boolean {
  return open || phase !== 'closed';
}

/** CSS hooks: `sliding` arms the transitions (kept off in the steady state
 *  so pane resizing never animates), `out` is the off-screen position, and
 *  `pre` marks the painted-from-state frame. Issue #165: the editor now
 *  survives the split toggle in place, so unlike a freshly inserted pane its
 *  armed transitions WOULD run on the pre-open frame — `pre` is the hook
 *  that lands that frame's values instantly instead. */
export function slideClasses(phase: SlidePhase): { sliding: boolean; out: boolean; pre: boolean } {
  return {
    sliding: phase === 'pre-open' || phase === 'opening' || phase === 'closing',
    out: phase === 'pre-open' || phase === 'closing',
    pre: phase === 'pre-open',
  };
}

/**
 * Issue #165: how far the centred editor column sits from its pane's left
 * edge at FULL pane width — the distance the text column glides while the
 * split preview slides (PRD 003 Reqs 9–12 motion language). The centred
 * state only exists at full width (plain edit, either end of the slide), so
 * callers pass the full-width scroller geometry: the gutter+content pair is
 * centred as one flex group (SPEC6 §1), content is border-box capped at its
 * max width, and the leftover splits evenly either side.
 */
export function centeredColumnOffset(
  scrollerWidth: number,
  gutterWidth: number,
  contentMaxWidth: number
): number {
  const content = Math.min(contentMaxWidth, Math.max(scrollerWidth - gutterWidth, 0));
  return Math.max(0, (scrollerWidth - gutterWidth - content) / 2);
}
