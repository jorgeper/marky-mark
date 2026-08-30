/**
 * PRD 015 Reqs 6–8: the pure geometry and text surgery behind the preview
 * diagram resize gesture (components/DiagramResizer.tsx). The drag math —
 * pointer delta → aspect-locked, clamped box — and the buffer-level fence
 * rewrite live here so both are unit-testable without a DOM; the component
 * owns only listeners, measurement and the overlay. Pure per the lib rules:
 * no react, no CodeMirror, no component imports.
 */

import { rewriteFenceWidth } from './fenceWidth.ts';

/** PRD 015 Req 6: the drag's floor — a drawing never shrinks below this. */
export const MIN_DIAGRAM_WIDTH = 40;

export type DiagramCorner = 'nw' | 'ne' | 'sw' | 'se';

/**
 * PRD 015 Req 6: the box a corner drag implies. West-side handles grow the
 * drawing leftward, so their pointer delta inverts; the result is clamped to
 * [MIN_DIAGRAM_WIDTH, the drawing's natural layout width] — the viewBox's
 * width/height, mermaid's own statement of how the drawing lays out — and the
 * height always follows the viewBox aspect: the whole drawing scales, nothing
 * crops. A degenerate viewBox (no width) leaves the drag uncapped above and
 * the height at zero, which the caller's `height: auto` styling ignores.
 */
export function resizedDiagramBox(
  corner: DiagramCorner,
  startWidth: number,
  dx: number,
  viewBoxWidth: number,
  viewBoxHeight: number
): { width: number; height: number } {
  const wanted = startWidth + (corner === 'nw' || corner === 'sw' ? -dx : dx);
  const natural = viewBoxWidth > 0 ? viewBoxWidth : Infinity;
  const width = Math.min(natural, Math.max(MIN_DIAGRAM_WIDTH, wanted));
  const aspect = viewBoxWidth > 0 ? viewBoxHeight / viewBoxWidth : 0;
  return { width, height: width * aspect };
}

/**
 * PRD 015 Reqs 7–8: rewrite the opening fence line sitting at 1-based `line`
 * in `text` with `rewriteFenceWidth` — a width to persist, null to remove the
 * token. Everything outside that one line survives byte-for-byte, and a no-op
 * rewrite (the width the line already carries, a removal with no token, a
 * line that is not an opening fence, a line beyond the document) returns the
 * INPUT text itself, so the caller can compare by identity and skip the
 * buffer write entirely — no dirty dot, no undo entry, no save.
 */
export function rewriteFenceWidthAt(text: string, line: number, width: number | null): string {
  if (!Number.isInteger(line) || line < 1) return text;
  let start = 0;
  for (let i = 1; i < line; i++) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) return text; // line beyond the document: nothing to aim at
    start = nl + 1;
  }
  const nl = text.indexOf('\n', start);
  const end = nl === -1 ? text.length : nl;
  const current = text.slice(start, end);
  const next = rewriteFenceWidth(current, width);
  if (next === current) return text;
  return text.slice(0, start) + next + text.slice(end);
}
