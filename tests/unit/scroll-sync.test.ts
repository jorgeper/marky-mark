import { describe, expect, test } from 'vitest';
import { lineAtOffset, offsetForLine, type SyncAnchor } from '../../src/lib/scrollSync';

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
