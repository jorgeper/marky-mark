/**
 * PRD 025 Req 11 (issue #335): Fluid mode — the selection-change decision
 * and the ghost's rectangle geometry, as pure functions. Nothing here
 * touches a view: the editor hands the decision a plain descriptor of the
 * transaction it just applied, and hands the geometry the coordinates it
 * measured. Both are unit-tested with plain numbers (Req 21).
 */

import { FLUID_DURATIONS_MS, isFluidLargeOperation } from './fluid';
import { elasticAt, glideAt } from './fluidCursor';

/** PRD 025 Req 7: the two effects the applicability table allows on the selection. */
export type FluidSelectionEffect = 'glide' | 'elastic';

/** One selection range's two ends, as document positions. */
export interface FluidRangeEnds {
  anchor: number;
  head: number;
}

/**
 * PRD 025 Req 11: what the decision needs to know about one applied
 * transaction — the update's flags, its (first) user-event annotation, the
 * main range before and after (`from` already mapped through the
 * transaction's changes, so undo/redo compare like-for-like) and how many
 * document lines each range touches (`1` for a caret).
 */
export interface FluidSelectionDescriptor {
  docChanged: boolean;
  selectionSet: boolean;
  /** CodeMirror's `Transaction.userEvent` annotation, or null when absent. */
  userEvent: string | null;
  from: FluidRangeEnds;
  to: FluidRangeEnds;
  fromLines: number;
  toLines: number;
}

/**
 * `'animate'`: tween the painted selection toward the new range.
 * `'snap'`: draw nothing and cancel any selection ghost in flight.
 * `'none'`: not a selection change this effect owns — leave the overlay alone.
 */
export type FluidSelectionDecision = 'animate' | 'snap' | 'none';

const spanOf = (r: FluidRangeEnds): number => Math.abs(r.head - r.anchor);

/**
 * PRD 025 Reqs 11, 14: what a transaction does to the painted selection.
 * `'none'` when no selection was set, when the result is a caret (that is
 * the cursor effect's territory, so one transaction never triggers both),
 * when neither end moved, or when the document changed for anything but an
 * undo/redo — typing over a selection, `delete.selection`, paste,
 * completions and smart-edit / table rewrites never animate the selection.
 * Otherwise `'snap'` when either the previous or the new range is a large
 * operation by `isFluidLargeOperation` (strictly more than the #333
 * thresholds), and `'animate'` for everything else: Shift+arrow/Home/End,
 * select-all, each `select.pointer` step of a drag, a host `selectRange`, a
 * find-hit, vim visual moves, and an undo/redo landing a range.
 */
export function fluidSelectionDecision(d: FluidSelectionDescriptor): FluidSelectionDecision {
  if (!d.selectionSet) return 'none';
  if (d.to.anchor === d.to.head) return 'none';
  if (d.from.anchor === d.to.anchor && d.from.head === d.to.head) return 'none';
  if (d.docChanged && d.userEvent !== 'undo' && d.userEvent !== 'redo') return 'none';
  if (isFluidLargeOperation(spanOf(d.from), d.fromLines) || isFluidLargeOperation(spanOf(d.to), d.toLines)) {
    return 'snap';
  }
  return 'animate';
}

/** A rectangle in the overlay layer's frame (CSS pixels from its top-left). */
export interface FluidRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The measured box of one document position, in the overlay layer's frame. */
export interface FluidPosCoords {
  left: number;
  top: number;
  bottom: number;
}

/**
 * PRD 025 Req 11: what the geometry needs — the boxes at the range's two
 * ends in document order (`start` ≤ `end`; both the same box for a caret)
 * and the content DOM's left/right edges, all already translated into the
 * overlay layer's frame.
 */
export interface FluidSelectionCoords {
  start: FluidPosCoords;
  end: FluidPosCoords;
  contentLeft: number;
  contentRight: number;
}

/** The three rectangle slots a selection ghost always has (Req 11: element-to-element tweening). */
export type FluidSelectionShape = [FluidRect, FluidRect, FluidRect];

const nonNegative = (n: number): number => (n > 0 ? n : 0);

/**
 * PRD 025 Req 11: a range's painted shape as at most three rectangles — the
 * first line's tail (start → content right edge), the full-width middle
 * block, and the last line's head (content left edge → end). A range whose
 * ends share a line yields one rectangle; a caret yields one zero-width
 * rectangle at the caret. The line test is geometric (the end box starts at
 * or below the start box's bottom), so wrapped visual lines split too, as
 * CodeMirror's own selection layer does.
 */
export function fluidSelectionRects(c: FluidSelectionCoords): FluidRect[] {
  const { start, end } = c;
  const multiLine = end.top >= start.bottom - 0.5;
  if (!multiLine) {
    const top = Math.min(start.top, end.top);
    const bottom = Math.max(start.bottom, end.bottom);
    return [{ left: start.left, top, width: nonNegative(end.left - start.left), height: bottom - top }];
  }
  return [
    { left: start.left, top: start.top, width: nonNegative(c.contentRight - start.left), height: start.bottom - start.top },
    {
      left: c.contentLeft,
      top: start.bottom,
      width: nonNegative(c.contentRight - c.contentLeft),
      height: nonNegative(end.top - start.bottom),
    },
    { left: c.contentLeft, top: end.top, width: nonNegative(end.left - c.contentLeft), height: end.bottom - end.top },
  ];
}

/**
 * PRD 025 Req 11: pad a one-rectangle shape to the three fixed slots so a
 * single-line range tweens into a multi-line one element-to-element. The
 * middle slot collapses to zero height along the rectangle's bottom edge and
 * the last-line slot to zero width at its right end, which is exactly where
 * those blocks grow from when the range gains a line.
 */
export function fluidSelectionShape(rects: FluidRect[]): FluidSelectionShape {
  if (rects.length >= 3) return [rects[0], rects[1], rects[2]];
  const r = rects[0] ?? { left: 0, top: 0, width: 0, height: 0 };
  return [
    r,
    { left: r.left, top: r.top + r.height, width: r.width, height: 0 },
    { left: r.left + r.width, top: r.top, width: 0, height: r.height },
  ];
}

/**
 * PRD 025 Reqs 7, 11: one rectangle's geometry at curve value `f` between
 * `from` (f = 0) and `to` (f = 1). Elastic's overshoot takes `f` past 1, which
 * extrapolates the edges beyond the target — the band stretching past the
 * new end before settling — while a size never goes below zero.
 */
export function fluidRectAt(from: FluidRect, to: FluidRect, f: number): FluidRect {
  return {
    left: from.left + (to.left - from.left) * f,
    top: from.top + (to.top - from.top) * f,
    width: nonNegative(from.width + (to.width - from.width) * f),
    height: nonNegative(from.height + (to.height - from.height) * f),
  };
}

/** PRD 025 Req 7: the curve and duration behind each selection effect — the same curves as the cursor's. */
export function fluidSelectionCurve(effect: FluidSelectionEffect): { at: (t: number) => number; durationMs: number } {
  return effect === 'elastic'
    ? { at: elasticAt, durationMs: FLUID_DURATIONS_MS.elastic }
    : { at: glideAt, durationMs: FLUID_DURATIONS_MS.glide };
}
