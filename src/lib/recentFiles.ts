/**
 * SPEC29 §1: the Open Recent store (recent.json in the config dir).
 * Most-recent-first, deduped by path, capped. Corruption-tolerant. Pure —
 * mirrors readingPositions.ts.
 */

export interface RecentEntry {
  path: string;
  at: string; // ISO-8601
}

export interface RecentStore {
  version: 1;
  entries: RecentEntry[];
}

export const RECENT_CAP = 10;

const EMPTY: RecentStore = { version: 1, entries: [] };

export function parseRecent(json: string): RecentStore {
  try {
    const data = JSON.parse(json) as { entries?: unknown };
    if (!Array.isArray(data.entries)) return { ...EMPTY, entries: [] };
    const entries = (data.entries as unknown[])
      .filter(
        (e): e is RecentEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as RecentEntry).path === 'string' &&
          (e as RecentEntry).path.length > 0 &&
          typeof (e as RecentEntry).at === 'string'
      )
      .slice(0, RECENT_CAP);
    return { version: 1, entries };
  } catch {
    return { ...EMPTY, entries: [] };
  }
}

export function serializeRecent(store: RecentStore): string {
  return `${JSON.stringify(store, null, 2)}\n`;
}

/** MRU insert: the path moves to (or enters at) the front; cap holds. */
export function rememberRecent(store: RecentStore, path: string, atIso: string): RecentStore {
  const rest = store.entries.filter((e) => e.path !== path);
  return { version: 1, entries: [{ path, at: atIso }, ...rest].slice(0, RECENT_CAP) };
}

export function removeRecent(store: RecentStore, path: string): RecentStore {
  return { version: 1, entries: store.entries.filter((e) => e.path !== path) };
}

export function clearRecent(): RecentStore {
  return { version: 1, entries: [] };
}

/**
 * Menu labels: the basename, disambiguated with the parent folder's name
 * when two entries share a basename (" — parent"), macOS-style.
 */
export function recentMenuEntries(
  store: RecentStore,
  basename: (p: string) => string,
  dirname: (p: string) => string
): Array<{ path: string; label: string }> {
  const counts = new Map<string, number>();
  for (const e of store.entries) {
    const b = basename(e.path);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return store.entries.map((e) => {
    const b = basename(e.path);
    if ((counts.get(b) ?? 0) < 2) return { path: e.path, label: b };
    const parent = basename(dirname(e.path));
    return { path: e.path, label: parent ? `${b} — ${parent}` : b };
  });
}
