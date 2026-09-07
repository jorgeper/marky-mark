/**
 * PRD 025 Req 12 (issue #336): Fluid mode — the deletion-effect decision,
 * the ghost's box and the Burst particle geometry, as pure functions.
 * Nothing here touches a view: the editor hands the decision a plain
 * descriptor of the transaction it just applied (what `iterChanges`
 * yielded), and hands the geometry the coordinates it measured. All three
 * are unit-tested with plain numbers (Req 21). Insertion (#337) reuses the
 * replacement seam and the box helper.
 */

import { isFluidLargeOperation } from './fluid';
import type { FluidPosCoords, FluidRect } from './fluidSelection';

/** PRD 025 Req 7: the three effects the applicability table allows on a deletion. */
export type FluidDeletionEffect = 'fade' | 'pop' | 'burst';

/**
 * One changed range of an applied transaction, as `ChangeSet.iterChanges`
 * yields it: the removed range in start-document coordinates (`fromA`..`toA`),
 * where it now sits in the new document (`fromB`), how many characters the
 * range inserted in its place, and how many start-document lines the removed
 * range touched (`lineAt(toA).number - lineAt(fromA).number + 1`).
 */
export interface FluidChangedSpan {
  fromA: number;
  toA: number;
  fromB: number;
  insertedLength: number;
  lines: number;
}

/** PRD 025 Req 12: what the decision needs to know about one applied transaction. */
export interface FluidDeletionDescriptor {
  docChanged: boolean;
  /** CodeMirror's `Transaction.userEvent` annotation, or null when absent. */
  userEvent: string | null;
  spans: FluidChangedSpan[];
}

/**
 * PRD 025 Reqs 12, 14: which removed spans of one transaction get a ghost.
 * Nothing when the document did not change or no span removes text
 * (typing, paste, Enter, an insertion-only undo/redo). A span that removes
 * AND inserts is a replacement — typing or pasting over a selection,
 * completions, IME composition, smart-edit / table rewrites — and is never
 * ghosted (that seam is the insertion effect's, #337). Every other
 * pure-removal span is returned whatever the user event (`delete.*`, `undo`,
 * `redo`, a drop's removal, or none at all for a host `applyEdit` / vim
 * `x`), unless the eligible spans together are a large operation by
 * `isFluidLargeOperation` — strictly more than either threshold — in which
 * case nothing animates at all.
 */
export function fluidDeletionSpans(d: FluidDeletionDescriptor): FluidChangedSpan[] {
  if (!d.docChanged) return [];
  const removals = d.spans.filter((s) => s.toA > s.fromA && s.insertedLength === 0);
  if (removals.length === 0) return [];
  let chars = 0;
  let lines = 0;
  for (const s of removals) {
    chars += s.toA - s.fromA;
    lines += s.lines;
  }
  if (isFluidLargeOperation(chars, lines)) return [];
  return removals;
}

/**
 * PRD 025 Req 12: what the ghost's box needs — the measured box of the
 * removal's start (`coordsAtPos(fromB)` after the change) and the content
 * DOM's left/right edges, all already translated into the overlay frame.
 */
export interface FluidDeletionCoords {
  start: FluidPosCoords;
  contentLeft: number;
  contentRight: number;
}

/**
 * The ghost's placement: a content-wide block at the removal's line whose
 * first line is indented to where the removed text started, so later lines
 * of a multi-line removal fall back to the content's left edge and land
 * line-for-line under `white-space: pre-wrap`.
 */
export interface FluidDeletionBox {
  left: number;
  top: number;
  width: number;
  indent: number;
  lineHeight: number;
}

/** PRD 025 Req 12: the ghost's box from the measured start of the removal. */
export function fluidDeletionBox(c: FluidDeletionCoords): FluidDeletionBox {
  return {
    left: c.contentLeft,
    top: c.start.top,
    width: c.contentRight - c.contentLeft,
    indent: c.start.left - c.contentLeft,
    lineHeight: c.start.bottom - c.start.top,
  };
}

/** PRD 025 Reqs 7, 8: how many particles a Burst scatters (a handful: between 6 and 12). */
export const FLUID_BURST_PARTICLES = 8;

/** PRD 025 Req 7: the farthest a Burst particle travels, in CSS pixels. */
export const FLUID_BURST_DISTANCE_PX = 24;

/** One Burst particle: its origin in the overlay frame and the vector it travels while fading. */
export interface FluidBurstParticle {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/**
 * PRD 025 Req 7: the Burst geometry — `count` particles whose origins are
 * spread along `box` (the removed text's first painted line; a zero-width
 * box puts every origin at that point) and whose displacement vectors fan
 * out around the compass, each shorter than `FLUID_BURST_DISTANCE_PX` and
 * never zero. Everything is a function of the index — no `Math.random` — so
 * two calls with the same box scatter identically and a test can assert on
 * the numbers.
 */
export function fluidBurstParticles(box: FluidRect, count: number): FluidBurstParticle[] {
  const out: FluidBurstParticle[] = [];
  for (let i = 0; i < count; i++) {
    const along = (i + 0.5) / count; // evenly along the line
    const across = ((i * 7) % count) / Math.max(1, count - 1); // a deterministic shuffle down the line's height
    // Fan around the compass, starting up-left so the first few read as an upward puff.
    const angle = -Math.PI * 0.75 + (i / count) * Math.PI * 2;
    // Alternate long and short so the cloud has depth without leaving the radius.
    const length = FLUID_BURST_DISTANCE_PX * (i % 2 === 0 ? 1 : 0.6);
    out.push({
      x: box.left + box.width * along,
      y: box.top + box.height * across,
      dx: Math.cos(angle) * length,
      dy: Math.sin(angle) * length,
    });
  }
  return out;
}
