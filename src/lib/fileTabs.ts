/**
 * PRD 013 Req 7: the file tab strip's pure rules — the tab context menu's
 * item model (the single source of menu truth, in folderOps'
 * folderContextMenu mold) and the Close Others target order. No DOM, no
 * platform imports; the component renders the model, App runs the verbs.
 */

export type FileTabMenuItem = { id: 'close' | 'close-others' | 'close-all'; label: string };

/** PRD 013 Req 7: exactly three items, in this fixed order. */
export function fileTabContextMenu(): FileTabMenuItem[] {
  return [
    { id: 'close', label: 'Close' },
    { id: 'close-others', label: 'Close Others' },
    { id: 'close-all', label: 'Close All' },
  ];
}

/**
 * PRD 013 Req 7: Close Others' close sequence — every open-set file except
 * the kept one, in the list's own order (the strip's tree order, SPEC36 §1).
 */
export function closeOthersTargets(openFiles: string[], keep: string): string[] {
  return openFiles.filter((f) => f !== keep);
}

/* ---- PRD 013 Req 9 (issue #147): the rail's overflow/scroll math ---- */

/** One reading of the scrolling rail — the three numbers every rule needs. */
export interface RailMetrics {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

export interface RailArrowState {
  /** The tabs exceed the rail: arrows render at all. */
  overflow: boolean;
  leftEnabled: boolean;
  rightEnabled: boolean;
}

// PRD 013 Req 9: browsers report fractional scroll geometry, so a
// fully-scrolled rail can settle a fraction of a pixel short of the
// mathematical end. Anything within this tolerance reads as "at the end"
// (and a sub-pixel excess as "no overflow") rather than leaving an arrow
// enabled with nowhere to go.
const RAIL_EPSILON = 1;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The rail's maximum scrollLeft — 0 when the tabs fit. */
export function railMaxScroll(m: RailMetrics): number {
  return Math.max(0, m.scrollWidth - m.clientWidth);
}

/**
 * PRD 013 Req 9: arrow presence and liveness from one rail reading — arrows
 * exist only while the tabs overflow, and each one dies at its own end of
 * the range (left at scrollLeft 0, right at max scroll).
 */
export function railArrowState(m: RailMetrics): RailArrowState {
  const max = railMaxScroll(m);
  const overflow = max > RAIL_EPSILON;
  return {
    overflow,
    leftEnabled: overflow && m.scrollLeft > RAIL_EPSILON,
    rightEnabled: overflow && m.scrollLeft < max - RAIL_EPSILON,
  };
}

/**
 * PRD 013 Req 9: one arrow click's scroll target — half a viewport per step
 * (enough movement to feel like paging without losing all context), with a
 * floor so a squeezed rail still moves usably, clamped to the range.
 */
export function railStepTarget(m: RailMetrics, direction: -1 | 1): number {
  const step = Math.max(48, m.clientWidth / 2);
  return clamp(m.scrollLeft + direction * step, 0, railMaxScroll(m));
}

/**
 * PRD 013 Req 9: the minimal reveal — the scroll target that brings a tab at
 * `tabLeft`/`tabWidth` (rail-content coordinates) fully into view. Already
 * visible ⇒ the current position, byte-for-byte: activation must not nudge a
 * rail the user can see the tab in. Otherwise the NEAREST edge, never a
 * centring scroll, clamped to the range (FolderPanel's `block: 'nearest'`
 * reveal, rotated to the horizontal axis).
 */
export function railRevealTarget(m: RailMetrics, tabLeft: number, tabWidth: number): number {
  const hiddenLeft = m.scrollLeft - tabLeft > RAIL_EPSILON;
  const hiddenRight = tabLeft + tabWidth - (m.scrollLeft + m.clientWidth) > RAIL_EPSILON;
  if (!hiddenLeft && !hiddenRight) return m.scrollLeft;
  const max = railMaxScroll(m);
  // A tab wider than the window can't be fully shown: its left edge wins.
  if (hiddenLeft || tabWidth > m.clientWidth) return clamp(tabLeft, 0, max);
  return clamp(tabLeft + tabWidth - m.clientWidth, 0, max);
}

/**
 * PRD 013 Req 9 (issue #139's "common way"): the wheel-axis mapping — the
 * dominant axis drives the rail, so a trackpad's horizontal swipe passes
 * through AND a plain vertical wheel (a mouse with no horizontal axis at
 * all) still reaches the hidden tabs. The strip has no vertical scroll to
 * compete for the delta, so mapping it sideways is the tab-strip convention
 * (browser tab bars, editor tab strips) rather than a surprise. Ties go to
 * the horizontal reading.
 */
export function railWheelDelta(deltaX: number, deltaY: number): number {
  return Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
}

/**
 * PRD 013 Req 9: one wheel event's scroll target — the mapped delta applied
 * to the current position and clamped to the range, in railStepTarget's
 * mold. Returning the CURRENT position when the rail cannot move is what
 * lets the caller tell "consumed" from "fell through": at an end of the
 * range the event stays the surroundings' to handle.
 */
export function railWheelTarget(m: RailMetrics, deltaX: number, deltaY: number): number {
  return clamp(m.scrollLeft + railWheelDelta(deltaX, deltaY), 0, railMaxScroll(m));
}
