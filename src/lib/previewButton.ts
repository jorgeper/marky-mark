/**
 * PRD 023 §13 (issue #287; geometry issue #306; stacked by issue #343): the
 * preview selection button's placement, pure so it is unit-testable. The
 * button is floating viewport chrome that rides an anchor the App measures
 * (the host .doc's content-left edge and one line box), so the arithmetic
 * here decides where it lands: in the doc's left padding column, level with
 * the anchor line — or, when a margin copy-link already sits level with that
 * line, directly BENEATH the link so the two read as one column — clamped
 * into the viewport and below the app's top chrome.
 */

/** The button's size, its gap from the content edge / the link above, the
 * viewport inset, and the issue #18 toolbar band's floor. */
export const PREVIEW_BTN = { size: 24, gap: 4, edge: 4, toolbarFloor: 46 };

/**
 * What previewButtonPos places the button against — not the selection's own
 * rect (issue #306): the host doc's content edge for `left`, and one line
 * box (the selection's first line, or an active record's first painted
 * fragment — issue #343) for `top`.
 */
export interface PreviewButtonAnchor {
  /** The host .doc's content-left edge (its rect left + padding-left), viewport px. */
  contentLeft: number;
  /** Top of the anchor line box, viewport px. */
  y: number;
  /** Height of that line box. */
  h: number;
  /**
   * Issue #343: the copy-link grafted level with the anchor line
   * (`mm-hl-link`), when one is — its viewport bottom edge and x-centre. The
   * button then stacks one gap beneath it, centred on the same x, instead of
   * centring on the line: the copy-link sits directly above the button,
   * horizontally aligned, never over the words. The link's x is the graft's
   * clip-aware one (highlightLink.ts nudges it clear of a pane the doc's
   * padding has scrolled under), so following it keeps the button clickable
   * where the doc's content edge alone would not.
   */
  stack?: { bottom: number; centerX: number };
  /**
   * Issue #343: the viewport y the app's top chrome ends at — the file tab
   * strip's bottom while the strip shows. The fixed toolbar floor predated
   * the 38px strip (`--mm-tabstrip-h`); the button clears whichever is lower.
   */
  floor?: number;
}

export function previewButtonPos(
  sel: PreviewButtonAnchor,
  viewport: { width: number; height: number }
): { left: number; top: number } {
  const { size, gap, edge, toolbarFloor } = PREVIEW_BTN;
  const floor = Math.max(toolbarFloor, sel.floor ?? 0);
  const wantedTop = sel.stack ? sel.stack.bottom + gap : sel.y + sel.h / 2 - size / 2;
  const wantedLeft = sel.stack ? sel.stack.centerX - size / 2 : sel.contentLeft - gap - size;
  return {
    left: Math.max(edge, Math.min(wantedLeft, viewport.width - size - edge)),
    top: Math.max(floor, Math.min(wantedTop, viewport.height - size - edge)),
  };
}
