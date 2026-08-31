import { describe, expect, test } from 'vitest';
import {
  centeredColumnOffset,
  SLIDE_MS,
  SLIDE_SETTLE_MS,
  slideClasses,
  slideMounted,
  slideOnFrame,
  slideOnSettle,
  slideOnToggle,
  type SlidePhase,
} from '../../src/lib/paneSlide';

describe('PRD 003 Reqs 9-12 pane slide phases', () => {
  test('U123: phase machine — open/close walks, reduced-motion skips, interrupts, mount and class hooks', () => {
    // The full open walk: closed → pre-open → (painted frame) → opening →
    // (settle) → open.
    expect(slideOnToggle('closed', true, false)).toBe('pre-open');
    expect(slideOnFrame('pre-open')).toBe('opening');
    expect(slideOnSettle('opening')).toBe('open');
    // And the close walk: open → closing → (settle) → closed.
    expect(slideOnToggle('open', false, false)).toBe('closing');
    expect(slideOnSettle('closing')).toBe('closed');

    // A settle that fires before the paint frame still lands open — never
    // stuck in pre-open.
    expect(slideOnSettle('pre-open')).toBe('open');
    // The frame callback is inert outside pre-open.
    for (const p of ['closed', 'opening', 'open', 'closing'] as SlidePhase[]) {
      expect(slideOnFrame(p)).toBe(p);
    }
    // Settle is inert at rest.
    expect(slideOnSettle('open')).toBe('open');
    expect(slideOnSettle('closed')).toBe('closed');

    // Re-asserting the current direction changes nothing.
    expect(slideOnToggle('open', true, false)).toBe('open');
    expect(slideOnToggle('opening', true, false)).toBe('opening');
    expect(slideOnToggle('pre-open', true, false)).toBe('pre-open');
    expect(slideOnToggle('closed', false, false)).toBe('closed');
    expect(slideOnToggle('closing', false, false)).toBe('closing');

    // Interrupts reverse from the current position: a reopen mid-close is
    // already mounted, so it animates (no off-screen pre-open reset); a
    // close mid-open just turns around.
    expect(slideOnToggle('closing', true, false)).toBe('opening');
    expect(slideOnToggle('opening', false, false)).toBe('closing');
    expect(slideOnToggle('pre-open', false, false)).toBe('closing');

    // Req 11: reduced motion collapses every phase to the end state.
    for (const p of ['closed', 'pre-open', 'opening', 'open', 'closing'] as SlidePhase[]) {
      expect(slideOnToggle(p, true, true)).toBe('open');
      expect(slideOnToggle(p, false, true)).toBe('closed');
    }

    // Req 9: the pane stays in the DOM through the exit slide, and mounts
    // for the render where the setting has flipped but the phase hasn't.
    expect(slideMounted('closing', false)).toBe(true);
    expect(slideMounted('closed', false)).toBe(false);
    expect(slideMounted('closed', true)).toBe(true);

    // CSS hooks: transitions armed only while sliding; `out` marks the
    // off-screen position (the pre-open frame and the whole close); `pre`
    // marks ONLY the pre-open frame (issue #165: the persistent editor's
    // from-state must land without a transition — a fresh pane's insertion
    // suppresses transitions for free, a surviving subtree's does not).
    expect(slideClasses('open')).toEqual({ sliding: false, out: false, pre: false });
    expect(slideClasses('closed')).toEqual({ sliding: false, out: false, pre: false });
    expect(slideClasses('pre-open')).toEqual({ sliding: true, out: true, pre: true });
    expect(slideClasses('opening')).toEqual({ sliding: true, out: false, pre: false });
    expect(slideClasses('closing')).toEqual({ sliding: true, out: true, pre: false });

    // The settle timer must outlive the transition it waits for.
    expect(SLIDE_MS).toBe(180);
    expect(SLIDE_SETTLE_MS).toBeGreaterThan(SLIDE_MS);
  });

  test('U946: centeredColumnOffset — the glide distance of the split slide\'s text column (#165)', () => {
    // The plain-edit geometry: a 46rem (736px) column centred in a wide
    // scroller — the leftover splits evenly either side of the pair.
    expect(centeredColumnOffset(2000, 0, 736)).toBe((2000 - 736) / 2);
    // With line numbers the gutter+content PAIR is centred as one group.
    expect(centeredColumnOffset(2000, 50, 736)).toBe((2000 - 50 - 736) / 2);
    // A scroller narrower than the column has no slack: the column fills it
    // and the offset is zero — the slide has nothing to glide.
    expect(centeredColumnOffset(700, 0, 736)).toBe(0);
    expect(centeredColumnOffset(700, 50, 736)).toBe(0);
    // Exact fit: flush is centred, offset zero.
    expect(centeredColumnOffset(786, 50, 736)).toBe(0);
    // Degenerate widths never go negative.
    expect(centeredColumnOffset(0, 50, 736)).toBe(0);
  });
});
