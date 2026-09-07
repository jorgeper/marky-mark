import { describe, expect, test } from 'vitest';
import { FLUID_DURATIONS_MS, FLUID_LARGE_OPERATION_CHARS, FLUID_LARGE_OPERATION_LINES } from '../src/lib/fluid';
import {
  FLUID_BURST_DISTANCE_PX,
  FLUID_BURST_PARTICLES,
  fluidBurstParticles,
  fluidDeletionBox,
  fluidDeletionSpans,
  type FluidChangedSpan,
  type FluidDeletionDescriptor,
} from '../src/lib/fluidDeletion';
import type { FluidRect } from '../src/lib/fluidSelection';

/** A pure removal of `toA - fromA` characters at `fromA`, touching `lines` lines. */
const removal = (fromA: number, toA: number, over: Partial<FluidChangedSpan> = {}): FluidChangedSpan => ({
  fromA,
  toA,
  fromB: fromA,
  insertedLength: 0,
  lines: 1,
  ...over,
});

const change = (over: Partial<FluidDeletionDescriptor> = {}): FluidDeletionDescriptor => ({
  docChanged: true,
  userEvent: 'delete.backward',
  spans: [removal(4, 5)],
  ...over,
});

describe('PRD 025 Fluid mode — deletion (issue #336)', () => {
  test('U1296: PRD 025 Req 12 — every pure-removal span is ghosted whatever its user event, multi-line or not, and two spans are both returned', () => {
    for (const userEvent of [
      'delete.backward',
      'delete.forward',
      'delete.selection',
      'delete.cut',
      'delete.line',
      'undo',
      'redo',
      'move.drop',
      null,
    ]) {
      expect(fluidDeletionSpans(change({ userEvent }))).toEqual([removal(4, 5)]);
    }
    // A multi-line removal (a deleted selection across three lines).
    const multi = removal(10, 60, { lines: 3 });
    expect(fluidDeletionSpans(change({ userEvent: 'delete.selection', spans: [multi] }))).toEqual([multi]);
    // A multi-cursor Backspace: one span per cursor, both returned in order.
    const a = removal(4, 5);
    const b = removal(20, 21, { fromB: 19 });
    expect(fluidDeletionSpans(change({ spans: [a, b] }))).toEqual([a, b]);
  });

  test('U1297: PRD 025 Req 12 — no document change, insertion-only spans and replacements draw nothing; a mixed transaction ghosts only the pure removal', () => {
    expect(fluidDeletionSpans(change({ docChanged: false }))).toEqual([]);
    // Typing, paste, Enter, an insertion-only undo/redo: nothing removed.
    const insertion: FluidChangedSpan = { fromA: 4, toA: 4, fromB: 4, insertedLength: 1, lines: 1 };
    for (const userEvent of ['input.type', 'input.paste', 'undo', 'redo', null]) {
      expect(fluidDeletionSpans(change({ userEvent, spans: [insertion] }))).toEqual([]);
    }
    expect(fluidDeletionSpans(change({ spans: [] }))).toEqual([]);
    // A replacement — typing or pasting over a selection, a completion, an
    // IME composition, a smart-edit rewrite — removes and inserts: never ghosted.
    const replacement: FluidChangedSpan = { fromA: 0, toA: 12, fromB: 0, insertedLength: 1, lines: 1 };
    for (const userEvent of ['input.type', 'input.paste', 'input.complete', 'input.type.compose', null]) {
      expect(fluidDeletionSpans(change({ userEvent, spans: [replacement] }))).toEqual([]);
    }
    // Mixed: the pure removal alone.
    const pure = removal(30, 33, { fromB: 19 });
    expect(fluidDeletionSpans(change({ spans: [replacement, pure] }))).toEqual([pure]);
  });

  test('U1298: PRD 025 Req 14 — removing more than 2,000 characters or more than 50 lines draws nothing, two spans count together, and exactly at a threshold still animates', () => {
    const overChars = removal(0, FLUID_LARGE_OPERATION_CHARS + 1);
    expect(fluidDeletionSpans(change({ userEvent: 'delete.selection', spans: [overChars] }))).toEqual([]);
    const overLines = removal(0, 100, { lines: FLUID_LARGE_OPERATION_LINES + 1 });
    expect(fluidDeletionSpans(change({ spans: [overLines] }))).toEqual([]);
    // Two spans that only together exceed a threshold: the whole change is large.
    const halfChars = removal(0, FLUID_LARGE_OPERATION_CHARS / 2 + 1);
    const otherHalf = removal(3000, 3000 + FLUID_LARGE_OPERATION_CHARS / 2, { fromB: 1999 });
    expect(fluidDeletionSpans(change({ spans: [halfChars, otherHalf] }))).toEqual([]);
    const someLines = removal(0, 10, { lines: 30 });
    const moreLines = removal(500, 510, { fromB: 490, lines: 21 });
    expect(fluidDeletionSpans(change({ spans: [someLines, moreLines] }))).toEqual([]);
    // A replacement span's size never counts toward the total.
    const bigReplacement: FluidChangedSpan = { fromA: 0, toA: 5000, fromB: 0, insertedLength: 1, lines: 200 };
    const small = removal(6000, 6001, { fromB: 1001 });
    expect(fluidDeletionSpans(change({ spans: [bigReplacement, small] }))).toEqual([small]);
    // Exactly at either threshold still animates (strictly greater).
    const exactChars = removal(0, FLUID_LARGE_OPERATION_CHARS);
    expect(fluidDeletionSpans(change({ spans: [exactChars] }))).toEqual([exactChars]);
    const exactLines = removal(0, 100, { lines: FLUID_LARGE_OPERATION_LINES });
    expect(fluidDeletionSpans(change({ spans: [exactLines] }))).toEqual([exactLines]);
  });

  test('U1299: PRD 025 Req 12 — the ghost box spans the content width at the removal line, indented to where the text started', () => {
    const box = fluidDeletionBox({ start: { left: 140, top: 200, bottom: 224 }, contentLeft: 32, contentRight: 700 });
    expect(box).toEqual({ left: 32, top: 200, width: 668, indent: 108, lineHeight: 24 });
    // A removal starting at the content's left edge has no indent.
    expect(fluidDeletionBox({ start: { left: 32, top: 48, bottom: 70 }, contentLeft: 32, contentRight: 500 })).toEqual({
      left: 32,
      top: 48,
      width: 468,
      indent: 0,
      lineHeight: 22,
    });
  });

  test('U1300: PRD 025 Reqs 7, 8 — burst particles: exact count, origins within the box, vectors non-zero, bounded, not all parallel, and deterministic', () => {
    const box: FluidRect = { left: 100, top: 40, width: 60, height: 20 };
    const particles = fluidBurstParticles(box, FLUID_BURST_PARTICLES);
    expect(particles).toHaveLength(FLUID_BURST_PARTICLES);
    for (const p of particles) {
      expect(p.x).toBeGreaterThanOrEqual(box.left);
      expect(p.x).toBeLessThanOrEqual(box.left + box.width);
      expect(p.y).toBeGreaterThanOrEqual(box.top);
      expect(p.y).toBeLessThanOrEqual(box.top + box.height);
      const length = Math.hypot(p.dx, p.dy);
      expect(length).toBeGreaterThan(0);
      expect(length).toBeLessThanOrEqual(FLUID_BURST_DISTANCE_PX);
    }
    // Not all parallel: at least one pair's cross product is non-zero.
    const [first] = particles;
    expect(particles.some((p) => Math.abs(first.dx * p.dy - first.dy * p.dx) > 1e-6)).toBe(true);
    // Deterministic: the same box scatters identically.
    expect(fluidBurstParticles(box, FLUID_BURST_PARTICLES)).toEqual(particles);
    // A zero-width box puts every origin at that point.
    const point = fluidBurstParticles({ left: 250, top: 90, width: 0, height: 0 }, 6);
    expect(point).toHaveLength(6);
    for (const p of point) {
      expect(p.x).toBe(250);
      expect(p.y).toBe(90);
      expect(Math.hypot(p.dx, p.dy)).toBeGreaterThan(0);
    }
  });

  test('U1301: PRD 025 Req 8 — Burst lives no longer than 400 ms and scatters a handful of particles', () => {
    expect(FLUID_DURATIONS_MS.burst).toBeLessThanOrEqual(400);
    expect(FLUID_DURATIONS_MS.fade).toBeLessThanOrEqual(FLUID_DURATIONS_MS.burst);
    expect(FLUID_BURST_PARTICLES).toBeGreaterThanOrEqual(6);
    expect(FLUID_BURST_PARTICLES).toBeLessThanOrEqual(12);
    expect(FLUID_BURST_DISTANCE_PX).toBeGreaterThanOrEqual(12);
    expect(FLUID_BURST_DISTANCE_PX).toBeLessThanOrEqual(32);
  });
});
