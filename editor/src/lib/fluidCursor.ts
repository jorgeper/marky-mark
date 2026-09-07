/**
 * PRD 025 Req 10 (issue #334): Fluid mode — the cursor-movement decision and
 * the two position curves, as pure functions. Nothing here touches a view:
 * the editor hands the navigation decision a plain descriptor of the
 * transaction it just applied, and the animation samples the curves with
 * plain numbers. Both are unit-tested without a DOM (Req 21).
 */

import { FLUID_DURATIONS_MS } from './fluid';

/** PRD 025 Req 7: the two effects the applicability table allows on the cursor. */
export type FluidCursorEffect = 'glide' | 'elastic';

/**
 * PRD 025 Req 10: what the decision needs to know about one applied
 * transaction — the update's flags, its (first) user-event annotation, the
 * main head before and after (the old head already mapped through the
 * transaction's changes, so undo/redo compare like-for-like) and whether the
 * resulting main selection is a caret.
 */
export interface FluidMoveDescriptor {
  docChanged: boolean;
  selectionSet: boolean;
  /** CodeMirror's `Transaction.userEvent` annotation, or null when absent. */
  userEvent: string | null;
  fromHead: number;
  toHead: number;
  toEmpty: boolean;
}

/**
 * PRD 025 Req 10: is this transaction a cursor NAVIGATION move — one the
 * Cursor movement effect animates? Yes for a selection-only transaction
 * whatever its user event (`select` for the arrow/Home/End keymap,
 * `select.pointer` for a click, none at all for a host `selectRange`, vim
 * nav, a find-hit or heading-palette jump) and for a document change that is
 * an undo or a redo landing the caret. No for every other document change —
 * typing, paste, deletes, completions, smart-edit and table rewrites: the
 * caret keeps pace with typing — and for a transaction that set no
 * selection, left the head where it was, or produced a range (Req 11's
 * territory, not this effect's).
 */
export function isFluidNavigationMove(d: FluidMoveDescriptor): boolean {
  if (!d.selectionSet) return false;
  if (d.fromHead === d.toHead) return false;
  if (!d.toEmpty) return false;
  if (!d.docChanged) return true;
  return d.userEvent === 'undo' || d.userEvent === 'redo';
}

const clamp01 = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t);

/**
 * PRD 025 Req 7: Glide — the fraction of the distance covered at normalized
 * time `t ∈ [0, 1]`. An ease-out cubic: fast off the mark, settling gently,
 * monotone, never past 1 (no overshoot).
 */
export function glideAt(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

const ELASTIC_DAMPING = 0.62;
const ELASTIC_OMEGA = 9.5;

/**
 * PRD 025 Req 7: Elastic — an under-damped spring's unit-step response,
 * closed-form so no per-frame integration is needed. The damping ratio sets
 * the single overshoot (~8% past the target); the frequency puts that peak
 * around t ≈ 0.42 so the spring has settled to within 1% by t = 1, which is
 * why `FLUID_DURATIONS_MS.elastic` runs longer than Glide (Req 8).
 */
export function elasticAt(t: number): number {
  const x = clamp01(t);
  if (x === 0) return 0;
  const zeta = ELASTIC_DAMPING;
  const root = Math.sqrt(1 - zeta * zeta);
  const omegaD = ELASTIC_OMEGA * root;
  const envelope = Math.exp(-zeta * ELASTIC_OMEGA * x);
  return 1 - envelope * (Math.cos(omegaD * x) + (zeta / root) * Math.sin(omegaD * x));
}

/** PRD 025 Req 7: the curve and duration behind each cursor effect. */
export function fluidCursorCurve(effect: FluidCursorEffect): { at: (t: number) => number; durationMs: number } {
  return effect === 'elastic'
    ? { at: elasticAt, durationMs: FLUID_DURATIONS_MS.elastic }
    : { at: glideAt, durationMs: FLUID_DURATIONS_MS.glide };
}

/**
 * PRD 025 Req 20: sample a curve into `steps + 1` evenly spaced fractions
 * for a Web Animations keyframe list (the browser interpolates linearly
 * between them, so ~8 ms apart is smooth). The last sample is forced to
 * exactly 1 so a ghost always ends ON the caret, whatever the curve's
 * rounding at t = 1.
 */
export function fluidCurveSamples(at: (t: number) => number, steps: number): number[] {
  const n = Math.max(1, Math.floor(steps));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(i === n ? 1 : at(i / n));
  return out;
}
