/**
 * PRD 011 Req 29: the desktop half of the summary cache — ONE JSON file in the
 * app config directory, next to `positions.json`, `draft.json` and `themes/`.
 * This module is the I/O edge; every decision it makes about shape, size and
 * eviction comes from the pure `src/lib/summaryCacheStore.ts`.
 *
 * Where it deliberately does NOT write: the document's directory, a workspace
 * folder, or any path derived from a document path. The only path input is the
 * `configDir()` the Platform seam hands it, so a cached summary can never land
 * beside the user's file or inside their repository.
 *
 * It is shared rather than duplicated: `tauri.ts` gives it the real Tauri fs
 * and `browser.ts` (the e2e shim) gives it the virtual one, so both drive the
 * same eviction and corruption behaviour.
 */

import {
  EMPTY_SUMMARY_CACHE,
  SUMMARY_CACHE_MAX_BYTES,
  parseSummaryCache,
  readSummaryCacheEntry,
  serializeSummaryCache,
  summaryCacheSize,
  writeSummaryCacheEntry,
  type SummaryCacheFile,
  type SummaryCacheStore,
  type SummaryClock,
} from '../lib/summaryCacheStore';
import type { Platform } from './types';

/** The file-access slice of the Platform seam this store is handed. */
export type SummaryCacheFs = Pick<
  Platform,
  'configDir' | 'join' | 'readTextFile' | 'writeTextFile' | 'exists' | 'mkdirp' | 'remove'
>;

/** The one file, in the one directory. */
export const SUMMARY_CACHE_FILE = 'summary-cache.json';

export interface FileSummaryCacheOptions {
  /** Injected so tests pin eviction order; desktop passes `Date.now`. */
  now: SummaryClock;
  /** Overridable so a test can exercise eviction without writing 4 MiB. */
  maxBytes?: number;
}

/**
 * PRD 011 Req 28+29: a store over `<configDir>/summary-cache.json`. State
 * lives in the file and nowhere else — a second instance built over the same
 * directory reads back everything the first one wrote, which is what makes
 * "document reopen" and "app restart" the same code path as any other get.
 */
export function createFileSummaryCache(fs: SummaryCacheFs, options: FileSummaryCacheOptions): SummaryCacheStore {
  const cap = options.maxBytes ?? SUMMARY_CACHE_MAX_BYTES;

  const filePath = async (): Promise<string> => fs.join(await fs.configDir(), SUMMARY_CACHE_FILE);

  const load = async (): Promise<SummaryCacheFile> => {
    const path = await filePath();
    // A missing file is an empty cache, not a failure — the first run, and
    // every run after a Clear, take this branch.
    if (!(await fs.exists(path))) return { ...EMPTY_SUMMARY_CACHE };
    try {
      return parseSummaryCache(await fs.readTextFile(path));
    } catch {
      // Unreadable (permissions, a directory in its place) is a miss too: a
      // cache that cannot be read must never stop the app from summarizing.
      return { ...EMPTY_SUMMARY_CACHE };
    }
  };

  const save = async (file: SummaryCacheFile): Promise<void> => {
    const dir = await fs.configDir();
    await fs.mkdirp(dir);
    await fs.writeTextFile(fs.join(dir, SUMMARY_CACHE_FILE), serializeSummaryCache(file));
  };

  // One file, so operations are serialized: a put that read the file before an
  // earlier put wrote it would silently drop that entry.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    get: (key) => serial(async () => readSummaryCacheEntry(await load(), key)),

    put: (entry) =>
      serial(async () => {
        const before = await load();
        const after = writeSummaryCacheEntry(before, entry, options.now(), cap);
        // An oversized entry is refused, and a refusal rewrites nothing.
        if (after !== before) await save(after);
      }),

    size: () => serial(async () => summaryCacheSize(await load())),

    clear: () =>
      serial(async () => {
        const path = await filePath();
        if (await fs.exists(path)) await fs.remove(path);
      }),
  };
}
