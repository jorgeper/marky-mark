/**
 * PRD 011 Req 28: the storage layer under #110's keys. `summaryCache.ts` says
 * WHAT a summary is keyed by; this module says how a keyed summary is held so
 * it survives a zoom cycle, a document reopen and a process restart. It adds
 * no second keying scheme and re-hashes nothing — a key arrives, an entry
 * comes back.
 *
 * PRD 011 Req 29: pure by construction — parse, serialize, byte accounting and
 * eviction only. It reads no file and makes no request: the desktop flavor
 * hands it file access (`src/platform/summaryCacheFiles.ts`) and the hosted
 * flavor never uses this half at all, exactly the drafts/readingPositions
 * split where `src/lib/` holds the arithmetic and the edge holds the I/O.
 */

/** The shape version stored on disk; a file claiming any other reads empty. */
export const SUMMARY_CACHE_VERSION = 1;

/**
 * PRD 011 Req 28: what one cached summary carries. The key is #110's, and
 * provider/model/promptVersion are stored even though the key already encodes
 * them: an entry read back has to be self-describing for #120's inspect view,
 * which lists what is cached without being able to invert a hash.
 */
export interface SummaryCacheEntry {
  /** #110's `summaryCacheKey` / `summaryKeyForSection` / `summaryKeyForEntry`. */
  key: string;
  /** The summary text itself. */
  summary: string;
  providerId: string;
  modelId: string;
  /** #110's `SUMMARY_PROMPT_VERSION` as of the write. */
  promptVersion: string;
  /**
   * Milliseconds since the epoch, from the store's injected clock — never
   * `Date.now()` in here. It orders eviction and dates a row in #120's view.
   */
  at: number;
  /**
   * PRD 011 Req 33: what the generating call cost, when the producer knows it.
   * Optional and carried rather than dropped, so #119's usage accounting has
   * somewhere to land without a stored-shape migration; nothing in this issue
   * writes it, because this issue has no producer.
   */
  usage?: { promptTokens: number; completionTokens: number };
}

/** An entry as a caller supplies it: the store stamps `at` from its clock. */
export type SummaryCacheInput = Omit<SummaryCacheEntry, 'at'>;

/** The whole cache as one value — what a backing file parses to. */
export interface SummaryCacheFile {
  version: typeof SUMMARY_CACHE_VERSION;
  /** Most recently written first; eviction takes from the tail. */
  entries: SummaryCacheEntry[];
}

/** PRD 011 Req 30: what #120's inspect view reports before it offers Clear. */
export interface SummaryCacheSize {
  bytes: number;
  entries: number;
}

/**
 * PRD 011 Req 29: the ONE interface both flavors present, so #118 and #120 are
 * written once against the capability instead of branching on desktop vs
 * hosted. A get for an unknown key answers null — a miss, never a throw.
 */
export interface SummaryCacheStore {
  get(key: string): Promise<SummaryCacheEntry | null>;
  put(entry: SummaryCacheInput): Promise<void>;
  size(): Promise<SummaryCacheSize>;
  clear(): Promise<void>;
}

/** Milliseconds since the epoch, injected (the `src/lib/time.ts` precedent). */
export type SummaryClock = () => number;

/**
 * PRD 011 Req 29: the desktop cap, in BYTES of the serialized store. 4 MiB:
 * a section summary is a few hundred bytes to a couple of kilobytes, so this
 * holds thousands of them — more than a long document produces across every
 * zoom level — while staying small enough that the whole file is one cheap
 * JSON parse at startup and invisible next to the app's own footprint.
 */
export const SUMMARY_CACHE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * A fresh empty cache. A function rather than a shared constant so every
 * caller owns its result: two "empty" reads must not alias one `entries`
 * array, or a later mutation in one place would be visible in every other.
 */
export function emptySummaryCache(): SummaryCacheFile {
  return { version: SUMMARY_CACHE_VERSION, entries: [] };
}

const encoder = new TextEncoder();

/** Byte length, not character length: the cap is a promise about disk. */
function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

const isEntry = (value: unknown): value is SummaryCacheEntry => {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as SummaryCacheEntry;
  return (
    typeof e.key === 'string' &&
    e.key.length > 0 &&
    typeof e.summary === 'string' &&
    typeof e.providerId === 'string' &&
    typeof e.modelId === 'string' &&
    typeof e.promptVersion === 'string' &&
    typeof e.at === 'number' &&
    Number.isFinite(e.at)
  );
};

/**
 * PRD 011 Req 28: corruption-tolerant, in the stance of `parsePositions` and
 * `parseDraft` — truncated JSON, the wrong shape or a version this build does
 * not know all read as an EMPTY cache, so the worst a damaged file can do is
 * cost one re-summarization. It never throws into the caller.
 */
export function parseSummaryCache(json: string): SummaryCacheFile {
  try {
    const data = JSON.parse(json) as { version?: unknown; entries?: unknown };
    if (data.version !== SUMMARY_CACHE_VERSION || !Array.isArray(data.entries)) return emptySummaryCache();
    // Per-entry filtering, not all-or-nothing: one damaged row must not throw
    // away every good summary beside it.
    return { version: SUMMARY_CACHE_VERSION, entries: (data.entries as unknown[]).filter(isEntry) };
  } catch {
    return emptySummaryCache();
  }
}

export function serializeSummaryCache(file: SummaryCacheFile): string {
  return `${JSON.stringify(file)}\n`;
}

/** What the cache costs on disk, measured on exactly what gets written. */
export function summaryCacheBytes(file: SummaryCacheFile): number {
  return utf8Bytes(serializeSummaryCache(file));
}

export function summaryCacheSize(file: SummaryCacheFile): SummaryCacheSize {
  return { bytes: summaryCacheBytes(file), entries: file.entries.length };
}

/** PRD 011 Req 28: a get for a key nothing wrote is a miss, not an error. */
export function readSummaryCacheEntry(file: SummaryCacheFile, key: string): SummaryCacheEntry | null {
  return file.entries.find((e) => e.key === key) ?? null;
}

/**
 * PRD 011 Req 29: write one entry and hold the cap, OLDEST-OUT by least
 * recently WRITTEN (not read) — `at` is the write stamp, a re-put refreshes
 * it, and a plain get never reorders anything. Least-recently-written is the
 * choice because it needs no write on the read path: the desktop store would
 * otherwise rewrite the whole file every cache HIT, which is the case this
 * cache exists to make cheap.
 *
 * Front-insert plus drop-from-the-tail is what makes the two edges true: the
 * entry just written is at the head, so eviction can never take it while a
 * strictly older one is still there; and an entry that alone exceeds the cap
 * is REFUSED rather than emptying the cache to store one oversized row it
 * would then have to evict anyway. A refusal returns `file` ITSELF, so a
 * caller with a file to rewrite detects it as `after === before`.
 */
export function writeSummaryCacheEntry(
  file: SummaryCacheFile,
  input: SummaryCacheInput,
  at: number,
  cap: number = SUMMARY_CACHE_MAX_BYTES,
): SummaryCacheFile {
  const entry: SummaryCacheEntry = { ...input, at };
  if (summaryCacheBytes({ version: SUMMARY_CACHE_VERSION, entries: [entry] }) > cap) return file;
  let entries = [entry, ...file.entries.filter((e) => e.key !== entry.key)];
  while (entries.length > 1 && summaryCacheBytes({ version: SUMMARY_CACHE_VERSION, entries }) > cap) {
    entries = entries.slice(0, -1);
  }
  return { version: SUMMARY_CACHE_VERSION, entries };
}
