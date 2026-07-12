import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { ImageTagParts } from '../lib/imageResize';

/**
 * SPEC20 §4.2: preview-mode image resize. Click an image → outline, four
 * corner handles, size badge. Drag a handle → live aspect-locked resize,
 * clamped to [40px, natural width]. Release → the owner rewrites the image's
 * markdown source span (App splices the buffer; the re-render restamps spans
 * and this layer re-binds). Double-click → width removed. Escape or a click
 * anywhere else → deselected.
 *
 * Selection is identified by the image's data-mm-src-start/end offsets, and
 * everything here is attributes-and-overlay only: the rendered text — the
 * SPEC6 comment-anchor coordinate space — is never touched.
 */

export interface ImageRewriteRequest {
  start: number;
  end: number;
  parts: ImageTagParts;
  /** Pixel width to persist, or null to remove the width (natural size). */
  width: number | null;
}

interface Props {
  active: boolean;
  /** The rendered document element (images live here). */
  docRef: RefObject<HTMLDivElement | null>;
  /** The scroll container; the overlay positions in its content coordinates. */
  workspaceRef: RefObject<HTMLDivElement | null>;
  /** Re-bind trigger: the injected html changed (spans restamped). */
  html: string;
  /** Rewrite the span; returns the image's new span, or null for a no-op. */
  onRewrite(req: ImageRewriteRequest): { start: number; end: number } | null;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];
export const MIN_IMG_WIDTH = 40;

export function ImageResizer({ active, docRef, workspaceRef, html, onRewrite }: Props) {
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  const dragRef = useRef<{ corner: Corner; startX: number; startWidth: number; aspect: number } | null>(null);
  // The click that fires right after a drag's pointerup must not deselect.
  const suppressClickRef = useRef(false);

  const findImg = useCallback(
    (s: { start: number } | null): HTMLImageElement | null =>
      s ? docRef.current?.querySelector<HTMLImageElement>(`img[data-mm-src-start="${s.start}"]`) ?? null : null,
    [docRef]
  );

  const partsFor = (img: HTMLImageElement): ImageTagParts => ({
    // The original source spelling was stashed before src was rewritten to a
    // loadable URL (asset:/data:); fall back to the attribute just in case.
    src: img.dataset.mmOriginalSrc ?? img.getAttribute('src') ?? '',
    alt: img.getAttribute('alt') ?? '',
    title: img.getAttribute('title') || undefined,
  });

  const measure = useCallback(() => {
    const img = findImg(selRef.current);
    const ws = workspaceRef.current;
    if (!img || !ws) {
      setBox(null);
      return;
    }
    const wsRect = ws.getBoundingClientRect();
    const r = img.getBoundingClientRect();
    setBox({
      left: r.left - wsRect.left + ws.scrollLeft,
      top: r.top - wsRect.top + ws.scrollTop,
      width: r.width,
      height: r.height,
    });
  }, [findImg, workspaceRef]);

  // Selection / deselection: delegated clicks. A fresh render drops selection
  // only if the image's span vanished (the rewrite path re-selects itself).
  useEffect(() => {
    if (!active) {
      setSel(null);
      return;
    }
    const onClick = (e: MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      const t = e.target as HTMLElement;
      if (t.closest('.img-resize-overlay')) return; // handle interaction, not a click-away
      if (
        t instanceof HTMLImageElement &&
        t.dataset.mmSrcStart !== undefined &&
        t.dataset.mmSrcEnd !== undefined &&
        docRef.current?.contains(t)
      ) {
        setSel({ start: Number(t.dataset.mmSrcStart), end: Number(t.dataset.mmSrcEnd) });
      } else {
        setSel(null);
      }
    };
    const onDblClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!(t instanceof HTMLImageElement) || t.dataset.mmSrcStart === undefined) return;
      if (!docRef.current?.contains(t)) return;
      const next = onRewrite({
        start: Number(t.dataset.mmSrcStart),
        end: Number(t.dataset.mmSrcEnd),
        parts: partsFor(t),
        width: null,
      });
      if (next) setSel(next);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selRef.current) setSel(null);
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

  // Track the selected image's box across renders, loads, and reflows.
  useLayoutEffect(() => {
    if (!sel) {
      setBox(null);
      return;
    }
    measure();
    const img = findImg(sel);
    if (!img) return;
    const onLoad = () => measure();
    img.addEventListener('load', onLoad);
    window.addEventListener('resize', onLoad);
    const ro = new ResizeObserver(measure);
    ro.observe(img);
    return () => {
      img.removeEventListener('load', onLoad);
      window.removeEventListener('resize', onLoad);
      ro.disconnect();
    };
  }, [sel, html, measure, findImg]);

  const startDrag = (corner: Corner) => (e: React.PointerEvent) => {
    const img = findImg(selRef.current);
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    const r = img.getBoundingClientRect();
    dragRef.current = {
      corner,
      startX: e.clientX,
      startWidth: r.width,
      aspect: r.width > 0 ? r.height / r.width : 1,
    };

    const clampWidth = (w: number) => {
      const natural = img.naturalWidth > 0 ? img.naturalWidth : Infinity;
      return Math.min(natural, Math.max(MIN_IMG_WIDTH, w));
    };
    const widthAt = (ev: PointerEvent) => {
      const d = dragRef.current!;
      const dx = ev.clientX - d.startX;
      // West-side handles grow leftward: invert the delta.
      return clampWidth(d.startWidth + (d.corner === 'nw' || d.corner === 'sw' ? -dx : dx));
    };
    const onMove = (ev: PointerEvent) => {
      // Aspect lock is free: height follows width in layout; the style pins
      // only the width, live, without touching the document text.
      img.style.width = `${Math.round(widthAt(ev))}px`;
      measure();
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!dragRef.current) return;
      const width = Math.round(widthAt(ev)); // before dropping the drag state
      dragRef.current = null;
      suppressClickRef.current = true;
      const s = selRef.current;
      if (!s) return;
      img.style.width = '';
      const next = onRewrite({
        start: s.start,
        end: s.end,
        parts: partsFor(img),
        width,
      });
      if (next) setSel(next);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (!active || !sel || !box) return null;
  return (
    <div
      className="img-resize-overlay"
      data-testid="img-resize-overlay"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    >
      <div className="img-size-badge" data-testid="img-size-badge">
        {Math.round(box.width)} × {Math.round(box.height)}
      </div>
      {CORNERS.map((c) => (
        <div key={c} className={`img-handle ${c}`} data-testid={`img-handle-${c}`} onPointerDown={startDrag(c)} />
      ))}
    </div>
  );
}
