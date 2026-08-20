import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * SPEC35 §3.2: how every pointer-anchored menu in the app behaves — it opens
 * at the pointer clamped into the viewport, and it is dismissed by Escape, any
 * outside pointer-down, a scroll anywhere, or a resize. One copy for the
 * sidebar's folder-menu and the tab strip's file-tab-menu (PRD 013 Req 7): two
 * menus opened the same way must close the same way.
 *
 * `anchor` null means no menu is up — nothing is positioned and nothing is
 * bound. The returned ref goes on the menu element.
 */
export function useAnchoredMenu(anchor: { x: number; y: number } | null, close: () => void) {
  const menuRef = useRef<HTMLDivElement>(null);
  // The latest `close`, read from the effects so an inline arrow from the
  // caller doesn't re-bind every listener on every render.
  const closeRef = useRef(close);
  closeRef.current = close;

  // Positioned at the pointer, clamped to the viewport.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !anchor) return;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(anchor.x, window.innerWidth - r.width - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(anchor.y, window.innerHeight - r.height - 4))}px`;
  }, [anchor]);

  // Dismissed by Esc, any outside pointer-down, scroll, resize.
  useEffect(() => {
    if (!anchor) return;
    const dismiss = () => closeRef.current();
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) dismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dismiss();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [anchor]);

  return menuRef;
}
