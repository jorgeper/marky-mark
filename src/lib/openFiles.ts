/**
 * SPEC36 §1: the open-file set — pure logic for the sidebar's multi-open
 * tabs. No DOM, no platform imports; paths are '/'-and-'\'-tolerant like
 * folderTree.ts. The list is ALWAYS kept in visible tree order: display
 * (the only-open flat list) and Ctrl+Tab cycling both read it as-is.
 */

/** Persistence cap for foldertree.json's openFiles (in-session is uncapped). */
export const OPEN_CAP = 50;

const parts = (p: string): string[] => p.split(/[\\/]/).filter(Boolean);

/**
 * Visible tree order for two absolute FILE paths: walk components from the
 * front; at the first difference a directory component (one with more
 * components after it) sorts before a file component (the last one) — the
 * same folders-first rule as compareEntries — then case-insensitive
 * localeCompare. Independent of the tree's expansion state.
 */
export function treeOrderCompare(a: string, b: string): number {
  if (a === b) return 0;
  const as = parts(a);
  const bs = parts(b);
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    const ca = as[i];
    const cb = bs[i];
    if (ca === cb) continue;
    const aDir = i < as.length - 1;
    const bDir = i < bs.length - 1;
    if (aDir !== bDir) return aDir ? -1 : 1;
    const byName = ca.toLowerCase().localeCompare(cb.toLowerCase());
    if (byName !== 0) return byName;
    return ca < cb ? -1 : 1; // case-only difference: deterministic tiebreak
  }
  return as.length - bs.length;
}

/** The list with `path` inserted in tree order; already present ⇒ unchanged. */
export function addOpen(list: string[], path: string): string[] {
  if (list.includes(path)) return list;
  return [...list, path].sort(treeOrderCompare);
}

/**
 * Remove `path`. `nextActive` is the entry that followed it in tree order,
 * else the one before it, else null. Absent path ⇒ unchanged list, null.
 */
export function closeOpen(list: string[], path: string): { list: string[]; nextActive: string | null } {
  const idx = list.indexOf(path);
  if (idx === -1) return { list, nextActive: null };
  const next = [...list.slice(0, idx), ...list.slice(idx + 1)];
  return { list: next, nextActive: next[idx] ?? next[idx - 1] ?? null };
}

/**
 * The neighbouring entry with wrap-around; `active` not in the list (or
 * null) ⇒ the first entry; fewer than 2 entries ⇒ null (no-op).
 */
export function cycleOpen(list: string[], active: string | null, dir: 1 | -1): string | null {
  if (list.length < 2) return null;
  const idx = active === null ? -1 : list.indexOf(active);
  if (idx === -1) return list[0];
  return list[(idx + dir + list.length) % list.length];
}

/**
 * `path` with `oldPrefix` (an exact entry or a directory prefix, separator
 * -aware) rewritten to `newPrefix`; null when `path` is unaffected. Local
 * twin of SPEC35's remapPath so this module stays dependency-free.
 */
export function remapPathPrefix(path: string, oldPrefix: string, newPrefix: string): string | null {
  if (path === oldPrefix) return newPrefix;
  const at = path[oldPrefix.length];
  if (path.startsWith(oldPrefix) && (at === '/' || at === '\\')) return newPrefix + path.slice(oldPrefix.length);
  return null;
}

/**
 * Every entry rewritten through the rename, then re-sorted — a rename can
 * move a file across the tree order.
 */
export function remapOpen(list: string[], oldPrefix: string, newPrefix: string): string[] {
  return list.map((p) => remapPathPrefix(p, oldPrefix, newPrefix) ?? p).sort(treeOrderCompare);
}

/** Drop the deleted entry and anything under it as a directory. */
export function pruneOpen(list: string[], deletedPath: string): string[] {
  return list.filter((p) => remapPathPrefix(p, deletedPath, deletedPath) === null);
}
