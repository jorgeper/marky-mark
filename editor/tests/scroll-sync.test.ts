import { describe, expect, test } from 'vitest';
import { centreAlignedOffset, lineAtOffset, offsetForLine, withinCueWindow, type SyncAnchor } from '../src/lib/scrollSync';

const anchors: SyncAnchor[] = [
  { line: 1, top: 0 },
  { line: 10, top: 300 },
  { line: 20, top: 400 }, // dense: a tall code block above compressed lines
];

describe('SPEC15 scroll-sync math', () => {
  test('U27: interpolation, clamping, proportional fallback, round-trip stability', () => {
    // Exact anchor hits.
    expect(lineAtOffset(anchors, 1000, 0)).toBe(1);
    expect(lineAtOffset(anchors, 1000, 300)).toBe(10);
    // Interpolation inside a segment: halfway 0→300 is halfway line 1→10.
    expect(lineAtOffset(anchors, 1000, 150)).toBeCloseTo(5.5, 5);
    // Tail segment: 400→1000 spans line 20→21.
    expect(lineAtOffset(anchors, 1000, 700)).toBeCloseTo(20.5, 5);
    // Clamping.
    expect(lineAtOffset(anchors, 1000, -50)).toBe(1);
    expect(lineAtOffset(anchors, 1000, 99999)).toBe(21);
    expect(offsetForLine(anchors, 1000, -5)).toBe(0);
    expect(offsetForLine(anchors, 1000, 999)).toBe(1000);
    // Inverse.
    expect(offsetForLine(anchors, 1000, 5.5)).toBeCloseTo(150, 5);
    expect(offsetForLine(anchors, 1000, 20.5)).toBeCloseTo(700, 5);
    // Round-trip stability across the range.
    for (const y of [0, 37, 150, 299, 300, 350, 400, 731, 1000]) {
      expect(offsetForLine(anchors, 1000, lineAtOffset(anchors, 1000, y))).toBeCloseTo(y, 1);
    }
    // Empty table: pure proportional between implicit head and tail.
    expect(lineAtOffset([], 500, 250)).toBeCloseTo(1.5, 5);
    expect(offsetForLine([], 500, 1.5)).toBeCloseTo(250, 5);
    // Unsorted/duplicate/non-monotonic input is repaired, not crashed on.
    const messy: SyncAnchor[] = [
      { line: 10, top: 300 },
      { line: 10, top: 310 },
      { line: 5, top: 500 }, // non-monotonic: dropped
      { line: 2, top: 100 },
    ];
    expect(lineAtOffset(messy, 1000, 100)).toBe(2);
    expect(lineAtOffset(messy, 1000, 300)).toBe(10);
  });
});

describe('Issue #310 centre-aligned cue following', () => {
  test('U1270: centreAlignedOffset levels row centres, clamps at both ends, and is a no-op when already level', () => {
    // Leader row 100..120 (centre 110) with the leader scrolled to 60 sits
    // 50 px into its viewport; a follower cue 400..440 (centre 420) must sit
    // at 50 px too → scrollTop 370.
    expect(centreAlignedOffset({ top: 100, bottom: 120 }, 60, { top: 400, bottom: 440 }, 1000)).toBe(370);
    // Centres, not tops: a taller follower cue (a heading) with the same top
    // moves the target by half the height difference.
    expect(centreAlignedOffset({ top: 100, bottom: 120 }, 60, { top: 400, bottom: 460 }, 1000)).toBe(380);
    // No-op: the follower already level returns its current scrollTop.
    expect(centreAlignedOffset({ top: 100, bottom: 120 }, 60, { top: 410, bottom: 430 }, 1000)).toBe(370);
    // Clamps: a cue near the follower's top cannot scroll negative…
    expect(centreAlignedOffset({ top: 500, bottom: 520 }, 0, { top: 10, bottom: 30 }, 1000)).toBe(0);
    // …and one near its bottom stops at the follower's max.
    expect(centreAlignedOffset({ top: 100, bottom: 120 }, 60, { top: 4000, bottom: 4020 }, 1000)).toBe(1000);
    // A follower that cannot scroll at all (max ≤ 0) always answers 0.
    expect(centreAlignedOffset({ top: 100, bottom: 120 }, 60, { top: 400, bottom: 440 }, -5)).toBe(0);
  });

  test('U1271: withinCueWindow admits one viewport above through two below, exclusive at both edges', () => {
    expect(withinCueWindow(0, 600)).toBe(true);
    expect(withinCueWindow(-599, 600)).toBe(true);
    expect(withinCueWindow(-600, 600)).toBe(false);
    expect(withinCueWindow(1199, 600)).toBe(true);
    expect(withinCueWindow(1200, 600)).toBe(false);
  });
});
