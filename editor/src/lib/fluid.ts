/**
 * PRD 025: Fluid mode — the pure vocabulary of the animated-operations
 * experiment. Names, applicability, durations and the large-operation rule
 * live here as data so the app's settings layer, the editor's overlay and
 * any embedder agree on ONE catalogue (PRD 025 Req 18: the package exports
 * the mapping type, the effect and action names, the applicability table and
 * the large-operation constants; it imports nothing from a host).
 *
 * Nothing in this module runs an animation. Increment (1) of PRD 025 Req 24
 * ships every effect as a no-op; the constants below are the contract later
 * increments draw against.
 */

/** PRD 025 Req 5: the four editor actions a reader maps, in page order. */
export const FLUID_ACTIONS = ['cursor', 'selection', 'deletion', 'insertion'] as const;
export type FluidAction = (typeof FLUID_ACTIONS)[number];

/** PRD 025 Req 7: the five-effect catalogue, and no sixth. */
export const FLUID_EFFECTS = ['fade', 'glide', 'elastic', 'pop', 'burst'] as const;
export type FluidEffect = (typeof FLUID_EFFECTS)[number];

/**
 * PRD 025 Req 18: the action → effect mapping the `fluid` prop carries.
 * `'none'` is a real choice (the action stays instant); the prop being
 * `null`/absent is the mode being OFF, which is a different thing.
 */
export type FluidEffectMap = Record<FluidAction, FluidEffect | 'none'>;

/** PRD 025 Req 5: the picker labels, one per effect. */
export const FLUID_EFFECT_LABELS: Record<FluidEffect, string> = {
  fade: 'Fade',
  glide: 'Glide',
  elastic: 'Elastic',
  pop: 'Pop',
  burst: 'Burst',
};

/** PRD 025 Req 5: the row labels, one per action, in page order. */
export const FLUID_ACTION_LABELS: Record<FluidAction, string> = {
  cursor: 'Cursor movement',
  selection: 'Selection change',
  deletion: 'Deletion',
  insertion: 'Insertion',
};

/**
 * PRD 025 Req 7: the applicability table as DATA — which actions each effect
 * may be mapped to. Fade and Pop are opacity/scale effects on text, so they
 * apply to deletion and insertion; Glide and Elastic are position tweens, so
 * they apply to the cursor and the selection; Burst scatters particles from
 * a removed span, so it applies to deletion only.
 */
export const FLUID_APPLICABILITY: Record<FluidEffect, ReadonlyArray<FluidAction>> = {
  fade: ['deletion', 'insertion'],
  glide: ['cursor', 'selection'],
  elastic: ['cursor', 'selection'],
  pop: ['deletion', 'insertion'],
  burst: ['deletion'],
};

/**
 * PRD 025 Req 7: the effects a picker for `action` offers, in catalogue
 * order (the picker prepends None itself). Cursor and selection: Glide,
 * Elastic. Deletion: Fade, Pop, Burst. Insertion: Fade, Pop.
 */
export function fluidEffectsFor(action: FluidAction): FluidEffect[] {
  return FLUID_EFFECTS.filter((effect) => FLUID_APPLICABILITY[effect].includes(action));
}

/** PRD 025 Req 6: whether `effect` may be mapped to `action` at all. */
export function isFluidEffectApplicable(action: FluidAction, effect: FluidEffect): boolean {
  return FLUID_APPLICABILITY[effect].includes(action);
}

/** PRD 025 Req 7: a runtime guard for a stored/untrusted effect name. */
export function isFluidEffect(raw: unknown): raw is FluidEffect {
  return typeof raw === 'string' && (FLUID_EFFECTS as readonly string[]).includes(raw);
}

/**
 * PRD 025 Req 6: what each action does on first enable — Cursor movement →
 * Glide, Selection change → Elastic, Deletion → Fade, Insertion → Pop.
 */
export const DEFAULT_FLUID_EFFECTS: Readonly<FluidEffectMap> = Object.freeze({
  cursor: 'glide',
  selection: 'elastic',
  deletion: 'fade',
  insertion: 'pop',
});

/**
 * PRD 025 Req 8: durations are per-effect constants, not settings. Fade,
 * Glide and Pop sit in the 120–250 ms band; Elastic runs longer to settle
 * its overshoot (≤ ~350 ms); Burst particles live no longer than 400 ms.
 * Nothing reads these in increment (1).
 */
export const FLUID_DURATIONS_MS: Record<FluidEffect, number> = {
  fade: 180,
  glide: 160,
  elastic: 320,
  pop: 160,
  burst: 380,
};

/**
 * PRD 025 Req 14: a single change touching more than this many characters,
 * or more than this many lines, gets no deletion or insertion effect, and a
 * selection change spanning more than it snaps. Constants, not settings.
 */
export const FLUID_LARGE_OPERATION_CHARS = 2000;
export const FLUID_LARGE_OPERATION_LINES = 50;

/**
 * PRD 025 Req 14: the large-operation decision as a pure predicate —
 * "large" means STRICTLY more than either threshold, so a change of exactly
 * 2,000 characters or exactly 50 lines still animates.
 */
export function isFluidLargeOperation(chars: number, lines: number): boolean {
  return chars > FLUID_LARGE_OPERATION_CHARS || lines > FLUID_LARGE_OPERATION_LINES;
}

/**
 * PRD 025 Req 3 (issue #333): the configuration attribute the editor root
 * carries while the mode is on — the four pairs in fixed action order, e.g.
 * `cursor=glide;selection=elastic;deletion=fade;insertion=pop`. A test (and
 * an embedder's stylesheet) reads the whole mapping off one attribute.
 */
export function fluidAttribute(map: FluidEffectMap): string {
  return FLUID_ACTIONS.map((action) => `${action}=${map[action]}`).join(';');
}
