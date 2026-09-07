import { describe, expect, test } from 'vitest';
import { FLUID_DURATIONS_MS } from '../src/lib/fluid';
import {
  elasticAt,
  fluidCurveSamples,
  fluidCursorCurve,
  glideAt,
  isFluidNavigationMove,
  type FluidMoveDescriptor,
} from '../src/lib/fluidCursor';

const move = (over: Partial<FluidMoveDescriptor> = {}): FluidMoveDescriptor => ({
  docChanged: false,
  selectionSet: true,
  userEvent: null,
  fromHead: 4,
  toHead: 9,
  toEmpty: true,
  ...over,
});

describe('PRD 025 Fluid mode — cursor movement (issue #334)', () => {
  test('U1289: PRD 025 Req 10 — navigation moves animate; typing, deleting, unchanged heads and ranges never do', () => {
    // Selection-only transactions, whatever the user event.
    expect(isFluidNavigationMove(move({ userEvent: 'select' }))).toBe(true); // arrow / Home / End keymap
    expect(isFluidNavigationMove(move({ userEvent: 'select.pointer' }))).toBe(true); // mouse click
    expect(isFluidNavigationMove(move({ userEvent: null }))).toBe(true); // host selectRange, vim nav, find/heading jump
    // History landing the caret is a document change that still counts.
    expect(isFluidNavigationMove(move({ docChanged: true, userEvent: 'undo' }))).toBe(true);
    expect(isFluidNavigationMove(move({ docChanged: true, userEvent: 'redo' }))).toBe(true);
    // Every other document change: the caret keeps pace with typing.
    for (const userEvent of [
      'input.type',
      'input.paste',
      'delete.backward',
      'delete.forward',
      'delete.selection',
      'input.complete',
      null,
    ]) {
      expect(isFluidNavigationMove(move({ docChanged: true, userEvent }))).toBe(false);
    }
    // No selection set, head unchanged, or a range result.
    expect(isFluidNavigationMove(move({ selectionSet: false }))).toBe(false);
    expect(isFluidNavigationMove(move({ fromHead: 9, toHead: 9, userEvent: 'select' }))).toBe(false);
    expect(isFluidNavigationMove(move({ toEmpty: false, userEvent: 'select' }))).toBe(false);
    expect(isFluidNavigationMove(move({ docChanged: true, userEvent: 'undo', fromHead: 9, toHead: 9 }))).toBe(false);
  });

  test('U1290: PRD 025 Reqs 7, 8 — Glide starts at 0, ends at 1, never decreases and never overshoots', () => {
    expect(glideAt(0)).toBe(0);
    expect(glideAt(1)).toBe(1);
    // Out-of-range time clamps rather than extrapolating.
    expect(glideAt(-0.5)).toBe(0);
    expect(glideAt(1.5)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 200; i++) {
      const v = glideAt(i / 200);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    // Ease-out: more than half the distance is covered by the halfway mark.
    expect(glideAt(0.5)).toBeGreaterThan(0.5);
    expect(fluidCursorCurve('glide')).toEqual({ at: glideAt, durationMs: FLUID_DURATIONS_MS.glide });
    expect(fluidCursorCurve('glide').durationMs).toBe(160);
  });

  test('U1291: PRD 025 Reqs 7, 8 — Elastic overshoots once by a small margin, reaches the target early and has settled by the end', () => {
    expect(elasticAt(0)).toBe(0);
    expect(elasticAt(-1)).toBe(0);
    let peak = 0;
    let firstArrival: number | null = null;
    for (let i = 0; i <= 400; i++) {
      const t = i / 400;
      const v = elasticAt(t);
      if (v > peak) peak = v;
      if (firstArrival === null && v >= 1) firstArrival = t;
    }
    // The overshoot band: past the target, but not by much.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.15);
    // It reaches the target well before the end, then settles.
    expect(firstArrival).not.toBeNull();
    expect(firstArrival as number).toBeLessThan(1);
    expect(Math.abs(elasticAt(1) - 1)).toBeLessThan(0.01);
    expect(Math.abs(elasticAt(2) - 1)).toBeLessThan(0.01); // clamped, not extrapolated
    expect(fluidCursorCurve('elastic')).toEqual({ at: elasticAt, durationMs: FLUID_DURATIONS_MS.elastic });
    expect(fluidCursorCurve('elastic').durationMs).toBe(320);
    // Keyframe sampling: evenly spaced, endpoints pinned to 0 and exactly 1.
    const samples = fluidCurveSamples(elasticAt, 40);
    expect(samples).toHaveLength(41);
    expect(samples[0]).toBe(0);
    expect(samples[40]).toBe(1);
    expect(Math.max(...samples)).toBeGreaterThan(1);
    expect(fluidCurveSamples(glideAt, 0)).toEqual([0, 1]);
  });
});
