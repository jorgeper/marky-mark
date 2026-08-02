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
 *  so pane resizing never animates), `out` is the off-screen position. */
export function slideClasses(phase: SlidePhase): { sliding: boolean; out: boolean } {
  return {
    sliding: phase === 'pre-open' || phase === 'opening' || phase === 'closing',
    out: phase === 'pre-open' || phase === 'closing',
  };
}
