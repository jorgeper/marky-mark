import { describe, expect, test } from 'vitest';
import {
  closeOthersTargets,
  fileTabContextMenu,
  railArrowState,
  railRevealTarget,
  railStepTarget,
  railWheelDelta,
  railWheelTarget,
} from '../../src/lib/fileTabs';

// PRD 013 Req 7: the tab context menu's pure rules — the item model and the
// Close Others target order (the component renders, App runs the verbs).

describe('PRD 013 file tab menu', () => {
  test('U696: the menu model — exactly Close, Close Others, Close All, in that order', () => {
    expect(fileTabContextMenu()).toEqual([
      { id: 'close', label: 'Close' },
      { id: 'close-others', label: 'Close Others' },
      { id: 'close-all', label: 'Close All' },
    ]);
  });

  test('U697: Close Others targets — every other file, in the list\'s own (tree) order', () => {
    const open = ['/n/sub/deep/c.md', '/n/sub/b.md', '/n/a.md'];
    expect(closeOthersTargets(open, '/n/sub/b.md')).toEqual(['/n/sub/deep/c.md', '/n/a.md']);
    // First and last kept: order of the rest is untouched either way.
    expect(closeOthersTargets(open, '/n/sub/deep/c.md')).toEqual(['/n/sub/b.md', '/n/a.md']);
    expect(closeOthersTargets(open, '/n/a.md')).toEqual(['/n/sub/deep/c.md', '/n/sub/b.md']);
    // The input list is not mutated.
    expect(open).toHaveLength(3);
  });

  test('U698: Close Others edge cases — a single tab yields no targets; a keep not in the list drops nothing', () => {
    expect(closeOthersTargets(['/n/a.md'], '/n/a.md')).toEqual([]);
    expect(closeOthersTargets([], '/n/a.md')).toEqual([]);
    expect(closeOthersTargets(['/n/a.md', '/n/b.md'], '/n/gone.md')).toEqual(['/n/a.md', '/n/b.md']);
  });
});

// PRD 013 Req 9 (issue #147): the rail's overflow/scroll math — arrow state,
// arrow-step targets, the minimal reveal target and the wheel-axis mapping,
// all pure functions of a { scrollLeft, clientWidth, scrollWidth } reading.

describe('PRD 013 Req 9 rail overflow math', () => {
  test('U927: railArrowState — no overflow when the tabs fit (sub-pixel included); each arrow dies at its own end', () => {
    // Fits exactly, and fits with room: no overflow, both arrows dead.
    expect(railArrowState({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400 })).toEqual({
      overflow: false,
      leftEnabled: false,
      rightEnabled: false,
    });
    expect(railArrowState({ scrollLeft: 0, clientWidth: 400, scrollWidth: 250 })).toEqual({
      overflow: false,
      leftEnabled: false,
      rightEnabled: false,
    });
    // A sub-pixel excess is layout noise, not overflow.
    expect(railArrowState({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400.5 }).overflow).toBe(false);

    // Overflowing, parked at the left end: only the right arrow lives.
    expect(railArrowState({ scrollLeft: 0, clientWidth: 400, scrollWidth: 1000 })).toEqual({
      overflow: true,
      leftEnabled: false,
      rightEnabled: true,
    });
    // Mid-range: both live.
    expect(railArrowState({ scrollLeft: 300, clientWidth: 400, scrollWidth: 1000 })).toEqual({
      overflow: true,
      leftEnabled: true,
      rightEnabled: true,
    });
    // At the exact max (scrollWidth - clientWidth): only the left arrow lives.
    expect(railArrowState({ scrollLeft: 600, clientWidth: 400, scrollWidth: 1000 })).toEqual({
      overflow: true,
      leftEnabled: true,
      rightEnabled: false,
    });
    // A fully-scrolled rail lands fractionally short of the max: still "at the end".
    expect(railArrowState({ scrollLeft: 599.4, clientWidth: 400, scrollWidth: 1000 }).rightEnabled).toBe(false);
    // …but a whole step short is genuinely mid-range.
    expect(railArrowState({ scrollLeft: 597, clientWidth: 400, scrollWidth: 1000 }).rightEnabled).toBe(true);
  });

  test('U928: railStepTarget — half a viewport per step, clamped to [0, max] at either end', () => {
    const m = { scrollLeft: 300, clientWidth: 400, scrollWidth: 1000 };
    expect(railStepTarget(m, 1)).toBe(500); // +200 (clientWidth / 2)
    expect(railStepTarget(m, -1)).toBe(100);
    // Clamped: near the right end the step lands ON max (600), never past.
    expect(railStepTarget({ ...m, scrollLeft: 550 }, 1)).toBe(600);
    // Clamped at zero on the way left.
    expect(railStepTarget({ ...m, scrollLeft: 150 }, -1)).toBe(0);
    // A tiny rail still steps a usable minimum, not a 10px crawl.
    expect(railStepTarget({ scrollLeft: 0, clientWidth: 60, scrollWidth: 1000 }, 1)).toBe(48);
    // No overflow ⇒ nowhere to go.
    expect(railStepTarget({ scrollLeft: 0, clientWidth: 400, scrollWidth: 300 }, 1)).toBe(0);
  });

  test('U929: railRevealTarget — already visible moves nothing; otherwise the nearest edge, clamped', () => {
    const m = { scrollLeft: 200, clientWidth: 400, scrollWidth: 1000 };
    // Fully inside the [200, 600) window: no movement at all.
    expect(railRevealTarget(m, 250, 160)).toBe(200);
    expect(railRevealTarget(m, 200, 160)).toBe(200); // flush left edge
    expect(railRevealTarget(m, 440, 160)).toBe(200); // flush right edge
    // Sub-pixel spill past an edge still reads as visible — no jitter.
    expect(railRevealTarget(m, 199.5, 160)).toBe(200);
    // Hidden to the left: align the tab's left edge (nearest edge, not centre).
    expect(railRevealTarget(m, 40, 160)).toBe(40);
    // Hidden to the right: align the tab's right edge to the window's.
    expect(railRevealTarget(m, 700, 160)).toBe(700 + 160 - 400);
    // The last tab: the target clamps to max scroll rather than overshooting.
    expect(railRevealTarget({ ...m, scrollLeft: 0 }, 900, 160)).toBe(600);
    // First tab from far away clamps to 0.
    expect(railRevealTarget({ ...m, scrollLeft: 500 }, 0, 160)).toBe(0);
    // A tab wider than the window prefers its left edge.
    expect(railRevealTarget(m, 700, 500)).toBe(600); // 700 clamped to max 600
  });

  test('U722: railRevealTarget — a left-edge reveal backs off by the rail\'s leading padding (the first tab\'s shadow headroom), right-edge reveals unchanged', () => {
    const m = { scrollLeft: 500, clientWidth: 400, scrollWidth: 1000, paddingLeft: 8 };
    expect(railRevealTarget(m, 8, 160)).toBe(0); // first tab: padding in view
    expect(railRevealTarget(m, 208, 160)).toBe(200);
    expect(railRevealTarget({ ...m, scrollLeft: 0 }, 700, 160)).toBe(700 + 160 - 400);
    expect(railRevealTarget({ ...m, scrollLeft: 0 }, 900, 160)).toBe(600);
  });

  test('U930: railWheelDelta — the dominant axis wins, so a plain vertical wheel drives horizontal scroll', () => {
    // Pure horizontal (trackpad): passes through.
    expect(railWheelDelta(80, 0)).toBe(80);
    // Pure vertical (a mouse with no horizontal axis): mapped to horizontal.
    expect(railWheelDelta(0, 120)).toBe(120);
    expect(railWheelDelta(0, -120)).toBe(-120);
    // Mixed: the larger magnitude wins; a tie stays horizontal.
    expect(railWheelDelta(30, -90)).toBe(-90);
    expect(railWheelDelta(-90, 30)).toBe(-90);
    expect(railWheelDelta(50, 50)).toBe(50);
    expect(railWheelDelta(0, 0)).toBe(0);
  });

  test('U931: railWheelTarget — the mapped delta applied and clamped; an end of the range returns the current position unmoved', () => {
    const m = { scrollLeft: 300, clientWidth: 400, scrollWidth: 1000 };
    expect(railWheelTarget(m, 0, 120)).toBe(420); // vertical wheel drives it sideways
    expect(railWheelTarget(m, -80, 0)).toBe(220); // trackpad's horizontal delta
    // Clamped at both ends — a big delta lands ON the boundary, never past.
    expect(railWheelTarget(m, 0, 900)).toBe(600);
    expect(railWheelTarget(m, 0, -900)).toBe(0);
    // At an end, a further push returns scrollLeft unchanged: the caller
    // reads that as "nothing to consume" and lets the event fall through.
    expect(railWheelTarget({ ...m, scrollLeft: 600 }, 0, 240)).toBe(600);
    expect(railWheelTarget({ ...m, scrollLeft: 0 }, 0, -240)).toBe(0);
    // No overflow ⇒ nowhere to go at all.
    expect(railWheelTarget({ scrollLeft: 0, clientWidth: 400, scrollWidth: 300 }, 0, 240)).toBe(0);
  });
});
