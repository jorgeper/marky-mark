/**
 * SPEC16 §3: per-document reading positions (positions.json in the config
 * dir). Most-recent-first, LRU-capped, corruption-tolerant. Pure.
 */

export interface PositionEntry {
  path: string;
  line: number;
  at: string; // ISO-8601
}

export interface PositionStore {
  version: 1;
  entries: PositionEntry[];
}

const CAP = 200;

const EMPTY: PositionStore = { version: 1, entries: [] };

export function parsePositions(json: string): PositionStore {
  try {
    const data = JSON.parse(json) as { version?: unknown; entries?: unknown };
    if (!Array.isArray(data.entries)) return { ...EMPTY, entries: [] };
    const entries = (data.entries as unknown[])
      .filter(
        (e): e is PositionEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as PositionEntry).path === 'string' &&
          typeof (e as PositionEntry).line === 'number' &&
          Number.isFinite((e as PositionEntry).line) &&
          typeof (e as PositionEntry).at === 'string'
      )
      .slice(0, CAP);
    return { version: 1, entries };
  } catch {
    return { ...EMPTY, entries: [] };
  }
}

export function serializePositions(store: PositionStore): string {
  return `${JSON.stringify(store, null, 2)}\n`;
}

/** Front-insert (most recent first), dedupe by path, cap at 200. */
export function rememberPosition(store: PositionStore, path: string, line: number, at: string): PositionStore {
  const rest = store.entries.filter((e) => e.path !== path);
  return { version: 1, entries: [{ path, line, at }, ...rest].slice(0, CAP) };
}

export function positionFor(store: PositionStore, path: string): number | null {
  return store.entries.find((e) => e.path === path)?.line ?? null;
}
