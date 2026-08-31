import { describe, expect, test } from 'vitest';
import {
  createScrollbarFade,
  inScrollbarGutter,
  SCROLLBAR_FADE_SELECTOR,
  SCROLLBAR_IDLE_MS,
  type GutterMetrics,
  type ScrollbarFadeState,
} from '../../src/lib/autoHideScrollbars';

/**
 * A hand-cranked timer world: `fire()` runs the one pending timeout, so the
 * tests drive the machine without fake-timer globals (the suite shares
 * worker contexts — no global state is touched).
 */
const world = () => {
  const states: ScrollbarFadeState[] = [];
  let pending: (() => void) | null = null;
  const delays: number[] = [];
  const machine = createScrollbarFade({
    set: (s) => states.push(s),
    setTimer: (fn, ms) => {
      pending = fn;
      delays.push(ms);
      return fn;
    },
    clearTimer: (t) => {
      if (pending === t) pending = null;
    },
  });
  return {
    machine,
    states,
    delays,
    hasTimer: () => pending !== null,
    fire: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
  };
};

describe('issue #167 scrollbar idle/active machine', () => {
  test('U943: scroll shows the bar, one named delay hides it, and a new scroll restarts the countdown', () => {
    const w = world();
    w.machine.scrolled();
    expect(w.states).toEqual(['active']);
    // Every countdown is the ONE named constant — never a per-surface copy.
    expect(w.delays).toEqual([SCROLLBAR_IDLE_MS]);
    // A second scroll before the deadline replaces the countdown; only the
    // last one may fire.
    w.machine.scrolled();
    expect(w.delays).toEqual([SCROLLBAR_IDLE_MS, SCROLLBAR_IDLE_MS]);
    w.fire();
    expect(w.states).toEqual(['active', 'active', 'idle']);
    expect(w.hasTimer()).toBe(false);
  });

  test('U944: a hold (pointer on the bar, thumb drag) pins the bar shown; release restarts the countdown', () => {
    const w = world();
    w.machine.scrolled();
    w.machine.hold();
    // The hold cancelled the countdown — the bar cannot idle mid-interaction.
    expect(w.hasTimer()).toBe(false);
    expect(w.states[w.states.length - 1]).toBe('active');
    // Scrolling while held (a thumb drag) arms nothing either.
    w.machine.scrolled();
    expect(w.hasTimer()).toBe(false);
    // Nested holds (hover + drag) both have to end before the countdown re-arms.
    w.machine.hold();
    w.machine.release();
    expect(w.hasTimer()).toBe(false);
    w.machine.release();
    expect(w.hasTimer()).toBe(true);
    w.fire();
    expect(w.states[w.states.length - 1]).toBe('idle');
    // A surplus release never underflows into a permanently-armed state.
    w.machine.release();
    w.machine.hold();
    expect(w.hasTimer()).toBe(false);
  });

  test('U945: the gutter test flags only points past the content box, and the barless rail is not a fading surface', () => {
    // 200×100 content box at (10, 20) with 1px borders and an 11px gutter
    // on each axis.
    const m: GutterMetrics = { left: 10, top: 20, clientLeft: 1, clientTop: 1, clientWidth: 200, clientHeight: 100 };
    expect(inScrollbarGutter(m, 100, 50)).toBe(false); // over the content
    expect(inScrollbarGutter(m, 215, 50)).toBe(true); // right gutter (vertical bar)
    expect(inScrollbarGutter(m, 100, 125)).toBe(true); // bottom gutter (horizontal bar)
    expect(inScrollbarGutter(m, 210, 120)).toBe(false); // last content pixel corner
    // PRD 013 Req 9: the tab rail stays barless — the shared selector must
    // never grow to cover it.
    expect(SCROLLBAR_FADE_SELECTOR).not.toContain('file-tab-rail');
    for (const surface of ['.workspace', '.split-preview', '.cm-scroller', '.folder-list']) {
      expect(SCROLLBAR_FADE_SELECTOR).toContain(surface);
    }
  });
});
