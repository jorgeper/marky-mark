import { describe, expect, test } from 'vitest';
import {
  DEFAULT_FLUID_EFFECTS,
  FLUID_ACTIONS,
  FLUID_APPLICABILITY,
  FLUID_DURATIONS_MS,
  FLUID_EFFECTS,
  FLUID_LARGE_OPERATION_CHARS,
  FLUID_LARGE_OPERATION_LINES,
  fluidAttribute,
  fluidEffectsFor,
  isFluidEffect,
  isFluidEffectApplicable,
  isFluidLargeOperation,
} from '../src/lib/fluid';

describe('PRD 025 Fluid mode catalogue', () => {
  test('U1283: PRD 025 Req 7 — the applicability table and the per-action option lists', () => {
    expect([...FLUID_ACTIONS]).toEqual(['cursor', 'selection', 'deletion', 'insertion']);
    expect([...FLUID_EFFECTS]).toEqual(['fade', 'glide', 'elastic', 'pop', 'burst']);
    // The table, effect by effect, exactly as the PRD ticks it.
    expect(FLUID_APPLICABILITY.fade).toEqual(['deletion', 'insertion']);
    expect(FLUID_APPLICABILITY.glide).toEqual(['cursor', 'selection']);
    expect(FLUID_APPLICABILITY.elastic).toEqual(['cursor', 'selection']);
    expect(FLUID_APPLICABILITY.pop).toEqual(['deletion', 'insertion']);
    expect(FLUID_APPLICABILITY.burst).toEqual(['deletion']);
    // Read by column: what each picker offers after None.
    expect(fluidEffectsFor('cursor')).toEqual(['glide', 'elastic']);
    expect(fluidEffectsFor('selection')).toEqual(['glide', 'elastic']);
    expect(fluidEffectsFor('deletion')).toEqual(['fade', 'pop', 'burst']);
    expect(fluidEffectsFor('insertion')).toEqual(['fade', 'pop']);
    expect(isFluidEffectApplicable('cursor', 'glide')).toBe(true);
    expect(isFluidEffectApplicable('cursor', 'fade')).toBe(false);
    expect(isFluidEffectApplicable('insertion', 'burst')).toBe(false);
    expect(isFluidEffect('burst')).toBe(true);
    expect(isFluidEffect('sparkle')).toBe(false);
    expect(isFluidEffect(null)).toBe(false);
  });

  test('U1284: PRD 025 Req 14 — a change is large strictly above either threshold', () => {
    expect(FLUID_LARGE_OPERATION_CHARS).toBe(2000);
    expect(FLUID_LARGE_OPERATION_LINES).toBe(50);
    // Below both.
    expect(isFluidLargeOperation(0, 0)).toBe(false);
    expect(isFluidLargeOperation(1999, 49)).toBe(false);
    // Exactly at a threshold is NOT large.
    expect(isFluidLargeOperation(2000, 1)).toBe(false);
    expect(isFluidLargeOperation(1, 50)).toBe(false);
    expect(isFluidLargeOperation(2000, 50)).toBe(false);
    // One past either threshold is.
    expect(isFluidLargeOperation(2001, 1)).toBe(true);
    expect(isFluidLargeOperation(1, 51)).toBe(true);
    expect(isFluidLargeOperation(2001, 51)).toBe(true);
  });

  test('U1285: PRD 025 Reqs 3, 6, 8 — defaults, duration bands, and the root attribute encoding', () => {
    expect(DEFAULT_FLUID_EFFECTS).toEqual({ cursor: 'glide', selection: 'elastic', deletion: 'fade', insertion: 'pop' });
    // Every default is applicable to its own action.
    for (const action of FLUID_ACTIONS) {
      const effect = DEFAULT_FLUID_EFFECTS[action];
      expect(effect).not.toBe('none');
      expect(isFluidEffectApplicable(action, effect as Exclude<typeof effect, 'none'>)).toBe(true);
    }
    // Req 8: Fade, Glide and Pop in 120–250 ms; Elastic ≤ 350; Burst ≤ 400.
    for (const effect of ['fade', 'glide', 'pop'] as const) {
      expect(FLUID_DURATIONS_MS[effect]).toBeGreaterThanOrEqual(120);
      expect(FLUID_DURATIONS_MS[effect]).toBeLessThanOrEqual(250);
    }
    expect(FLUID_DURATIONS_MS.elastic).toBeLessThanOrEqual(350);
    expect(FLUID_DURATIONS_MS.burst).toBeLessThanOrEqual(400);
    // Req 3: the attribute is the four pairs in fixed action order.
    expect(fluidAttribute(DEFAULT_FLUID_EFFECTS)).toBe('cursor=glide;selection=elastic;deletion=fade;insertion=pop');
    expect(fluidAttribute({ ...DEFAULT_FLUID_EFFECTS, deletion: 'none' })).toBe(
      'cursor=glide;selection=elastic;deletion=none;insertion=pop'
    );
  });
});
