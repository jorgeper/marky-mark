/**
 * SPEC14 §1: pure next/previous stepping over the open comments in document
 * order. No active (or unknown) id enters at the first (dir 1) / last
 * (dir −1); stepping wraps at both ends; empty list → null.
 */
export function stepComment(orderedIds: string[], activeId: string | null, dir: 1 | -1): string | null {
  if (orderedIds.length === 0) return null;
  const idx = activeId ? orderedIds.indexOf(activeId) : -1;
  if (idx === -1) return dir === 1 ? orderedIds[0] : orderedIds[orderedIds.length - 1];
  return orderedIds[(idx + dir + orderedIds.length) % orderedIds.length];
}
