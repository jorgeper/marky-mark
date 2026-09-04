import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { DIAGRAM_CLASS, sizeDrawnSvg } from '@marky-mark/editor';
import { resizedDiagramBox, type DiagramCorner } from '../lib/diagramResize';

/**
 * PRD 015 Req 5: preview-mode diagram resize, the SPEC20 image overlay's
 * shape rebuilt for the fence-diagram graft. Click a drawn diagram → outline,
 * four corner handles, live size badge. Drag a handle → aspect-locked rescale
 * of the drawn SVG, live, clamped to [40px, the drawing's natural viewBox
 * width] (Req 6). Release → the owner rewrites the opening fence's `width=N`
 * token through the buffer (Req 7). Double-click → the token removed (Req 8).
 * Escape or a click anywhere else → deselected.
 *
 * Everything here is overlay-only: the overlay is a sibling of the rendered
 * document positioned in the workspace's content coordinates, never a child
 * of it, so the rendered text — the comment-anchor coordinate space — is
 * byte-identical throughout. Selection is identified by the fence's
 * `data-mm-line` stamp; a block without one (a fence nested in a list), or
 * whose diagram is `pending`/`error`, is not selectable (Req 11). The CSS is
 * SPEC20's surviving `.img-resize-overlay` block (styles.css), which the
 * print rules already hide — the testids are this overlay's own, so the
 * images-have-no-handles tests (E118/E122) stay meaningful.
 */

interface Props {
  /** PRD 015 Req 10: `docGrants.edit` — off, no listeners even install. */
  active: boolean;
  /** The rendered document element (diagram hosts live here). */
  docRef: RefObject<HTMLDivElement | null>;
  /** The scroll container; the overlay positions in its content coordinates. */
  workspaceRef: RefObject<HTMLDivElement | null>;
  /** Re-bind trigger: the injected html changed (the preview re-rendered). */
  html: string;
  /** Rewrite the fence line's width token (null removes); no-ops are skipped by the owner. */
  onRewrite(line: number, width: number | null): void;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What a selection needs: the line to rewrite, and the drawing to rescale. */
interface DiagramParts {
  line: number;
  shadow: ShadowRoot;
  svg: SVGSVGElement;
}

/** The live drag, from the pointerdown on a handle to its pointerup. */
interface Drag {
  corner: DiagramCorner;
  startX: number;
  startWidth: number;
  vbWidth: number;
  vbHeight: number;
  shadow: ShadowRoot;
  /** The width last written to the drawing — what the release persists. */
  width: number;
  moved: boolean;
}

const CORNERS: DiagramCorner[] = ['nw', 'ne', 'sw', 'se'];

/**
 * PRD 015 Req 11: the selectable identity behind a fence's `<pre>` — the
 * block in the `done` state, carrying a `data-mm-line` stamp, its grafted
 * host next to it with the drawn SVG reachable in the open shadow root.
 * Anything less is inert: no line to aim a rewrite at, or nothing drawn yet.
 */
function partsOf(pre: Element | null): DiagramParts | null {
  if (!(pre instanceof HTMLElement) || pre.dataset.mmDiagram !== 'done') return null;
  if (!/^\d+$/.test(pre.dataset.mmLine ?? '')) return null;
  const host = pre.nextElementSibling;
  if (!(host instanceof HTMLElement) || !host.classList.contains(DIAGRAM_CLASS)) return null;
  const shadow = host.shadowRoot;
  const svg = shadow?.querySelector('svg');
  if (!shadow || !svg) return null;
  return { line: Number(pre.dataset.mmLine), shadow, svg };
}

export function DiagramResizer({ active, docRef, workspaceRef, html, onRewrite }: Props) {
  const [sel, setSel] = useState<number | null>(null); // the fence's data-mm-line
  const [box, setBox] = useState<Box | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  const dragRef = useRef<Drag | null>(null);
  // The click that fires right after a drag's pointerup must not deselect.
  const suppressClickRef = useRef(false);

  const findParts = useCallback(
    (line: number | null): DiagramParts | null =>
      line === null ? null : partsOf(docRef.current?.querySelector(`pre[data-mm-line="${line}"]`) ?? null),
    [docRef]
  );

  const measure = useCallback(() => {
    const parts = findParts(selRef.current);
    const ws = workspaceRef.current;
    if (!parts || !ws) {
      setBox(null);
      return;
    }
    const wsRect = ws.getBoundingClientRect();
    const r = parts.svg.getBoundingClientRect();
    setBox({
      left: r.left - wsRect.left + ws.scrollLeft,
      top: r.top - wsRect.top + ws.scrollTop,
      width: r.width,
      height: r.height,
    });
  }, [findParts, workspaceRef]);

  // Selection / deselection: delegated clicks, installed only while the
  // document may be edited (Req 10).
  useEffect(() => {
    if (!active) {
      setSel(null);
      return;
    }
    // The diagram a mouse event landed on. Shadow-tree clicks retarget to the
    // host, so the graft's class is the whole test; its `<pre>` — the sibling
    // before it — carries the identity (`partsOf`). A failure badge is a host
    // of the OTHER class, so it never matches: pending and error are inert.
    const diagramAt = (e: MouseEvent): DiagramParts | null => {
      const host = (e.target as HTMLElement).closest?.(`.${DIAGRAM_CLASS}`);
      if (!host || !docRef.current?.contains(host)) return null;
      return partsOf(host.previousElementSibling);
    };
    const onClick = (e: MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      // Handle interaction, not a click-away.
      if ((e.target as HTMLElement).closest?.('.img-resize-overlay')) return;
      setSel(diagramAt(e)?.line ?? null);
    };
    const onDblClick = (e: MouseEvent) => {
      const parts = diagramAt(e);
      if (!parts) return;
      // PRD 015 Req 8: back to natural size — the token removed. A fence
      // with no width token makes this a no-op the owner skips entirely.
      onRewrite(parts.line, null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selRef.current !== null) setSel(null);
    };
    window.addEventListener('click', onClick);
    window.addEventListener('dblclick', onDblClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', onClick);
      window.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [active, docRef, onRewrite]);

  // Track the selected drawing's box across renders and reflows. The parent's
  // injection effect replaces the rendered DOM AFTER this child effect runs,
  // so re-measure and re-observe on the next frame too — that is what keeps
  // the diagram selected across a release's rewrite, the overlay re-bound to
  // the re-rendered host with the badge reading the new size (Req 7).
  useLayoutEffect(() => {
    if (sel === null) {
      setBox(null);
      return;
    }
    let ro: ResizeObserver | null = null;
    const bind = () => {
      measure();
      const parts = findParts(selRef.current);
      ro?.disconnect();
      ro = null;
      if (!parts) return;
      ro = new ResizeObserver(measure);
      ro.observe(parts.svg);
    };
    bind();
    const raf = requestAnimationFrame(bind);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [sel, html, measure, findParts]);

  const startDrag = (corner: DiagramCorner) => (e: React.PointerEvent) => {
    const parts = findParts(selRef.current);
    if (!parts) return;
    e.preventDefault();
    e.stopPropagation();
    const r = parts.svg.getBoundingClientRect();
    const vb = parts.svg.viewBox.baseVal;
    dragRef.current = {
      corner,
      startX: e.clientX,
      startWidth: r.width,
      vbWidth: vb?.width ?? 0,
      vbHeight: vb?.height ?? 0,
      shadow: parts.shadow,
      width: Math.round(r.width),
      moved: false,
    };

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      if (dx !== 0) d.moved = true;
      // PRD 015 Req 6: clamp + aspect from the pure core; the write goes
      // through the one owner of the sizing rule, synchronously, so the
      // drawing follows the pointer within the same frame.
      d.width = Math.round(resizedDiagramBox(d.corner, d.startWidth, dx, d.vbWidth, d.vbHeight).width);
      sizeDrawnSvg(d.shadow, d.width);
      measure();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      suppressClickRef.current = true;
      // PRD 015 Req 6: a drag that never moved (a plain click) resizes nothing.
      if (!d.moved) return;
      const line = selRef.current;
      // PRD 015 Req 7: persist through the buffer; the owner compares first,
      // so releasing at the width the fence already carries writes nothing.
      if (line !== null) onRewrite(line, d.width);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (!active || sel === null || !box) return null;
  return (
    <div
      className="img-resize-overlay"
      data-testid="diagram-resize-overlay"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    >
      <div className="img-size-badge" data-testid="diagram-size-badge">
        {Math.round(box.width)} × {Math.round(box.height)}
      </div>
      {CORNERS.map((c) => (
        <div
          key={c}
          className={`img-handle ${c}`}
          data-testid={`diagram-resize-handle-${c}`}
          onPointerDown={startDrag(c)}
        />
      ))}
    </div>
  );
}
