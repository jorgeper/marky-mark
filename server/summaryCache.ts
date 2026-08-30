// PRD 011 Req 29: the hosted half of the summary cache — server-side and
// scoped to the WORKSPACE, so every member reuses every other member's
// summaries instead of each browser paying for the same call.
//
// Where the blobs live is the load-bearing decision: `workspaces/<id>/
// summary-cache/<key>.json`, outside the workspace's `files/` prefix:
//
//  - outside `files/`, so `GET /api/workspaces/<id>/files` never lists a
//    cache blob and no member ever sees one as a document;
//  - under `workspaces/`, so `RESERVED_PREFIXES` in server/app.ts already
//    makes it unreachable through the legacy `/api/files/` scaffold.
//
// One blob per key rather than one file per workspace: entries are written
// independently by concurrent members, and a whole-file rewrite would make
// every put a lost-update race. There is no size cap here — that is the
// desktop store's promise (Req 29); the hosted side reports its size and
// offers Clear (Req 30) and adds no operator knob.

import type {
  SummaryCacheEntry,
  SummaryCacheInput,
  SummaryCacheSize,
} from '../src/lib/summaryCacheStore.ts';
import type { StorageProvider } from './providers/types.ts';
import { WORKSPACES_PREFIX } from './workspaces.ts';

/** PRD 011 Req 29: one workspace's cache prefix — outside its `files/`. */
export function summaryCachePrefix(id: string): string {
  return `${WORKSPACES_PREFIX}${id}/summary-cache/`;
}

/**
 * A key is not a path. `encodeURIComponent` is injective, so two distinct
 * keys can never name one blob, and it emits no `/` — a key cannot address
 * anything outside its own workspace's prefix however it is spelled.
 */
export function summaryCacheBlobPath(id: string, key: string): string {
  return `${summaryCachePrefix(id)}${encodeURIComponent(key)}.json`;
}

/**
 * The longest key accepted. #110's keys are ~60 characters; this is far above
 * that and far below any store's path limit, so a caller cannot make a blob
 * name the backend would reject.
 */
const MAX_KEY_LENGTH = 512;

/** A usable cache key, or null — the caller answers 400. */
export function readSummaryCacheKey(raw: string | null): string | null {
  if (raw === null) return null;
  return raw.length > 0 && raw.length <= MAX_KEY_LENGTH ? raw : null;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * PRD 011 Req 28: the untrusted PUT body as an entry, or the named reason it
 * is not one. Validated rather than coerced — a stored entry has to be
 * self-describing for #120's inspect view, and the server is the only place
 * that can promise that about what a browser sent.
 */
export function validateSummaryCacheEntry(value: unknown): SummaryCacheInput | string {
  if (typeof value !== 'object' || value === null) return 'cache entry must be an object';
  const e = value as Record<string, unknown>;
  for (const field of ['key', 'summary', 'providerId', 'modelId', 'promptVersion'] as const) {
    if (typeof e[field] !== 'string') return `cache entry ${field} must be a string`;
  }
  if (!readSummaryCacheKey(e.key as string)) return 'cache entry key must be a non-empty key';
  const entry: SummaryCacheInput = {
    key: e.key as string,
    summary: e.summary as string,
    providerId: e.providerId as string,
    modelId: e.modelId as string,
    promptVersion: e.promptVersion as string,
  };
  // PRD 011 Req 33: usage rides along when the producer knows it (#119), and
  // is simply absent otherwise — never half-present.
  const usage = e.usage as { promptTokens?: unknown; completionTokens?: unknown } | undefined;
  if (usage !== undefined) {
    if (typeof usage !== 'object' || usage === null) return 'cache entry usage must be an object';
    if (!isFiniteNumber(usage.promptTokens) || !isFiniteNumber(usage.completionTokens)) {
      return 'cache entry usage must carry numeric promptTokens and completionTokens';
    }
    entry.usage = { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens };
  }
  return entry;
}

/**
 * PRD 011 Req 28: a get for a key nothing wrote — or for a blob that no
 * longer parses as an entry — is a MISS, never an error. A cache that can
 * fail a request is worse than no cache at all.
 */
export async function readCachedSummary(
  store: StorageProvider,
  id: string,
  key: string,
): Promise<SummaryCacheEntry | null> {
  const stored = await store.read(summaryCacheBlobPath(id, key));
  if (!stored) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored.content);
  } catch {
    return null;
  }
  const entry = validateSummaryCacheEntry(parsed);
  if (typeof entry === 'string') return null;
  const at = (parsed as { at?: unknown }).at;
  return { ...entry, at: isFiniteNumber(at) ? at : 0 };
}

/** Write one entry. The SERVER stamps `at`, as it does every other timestamp. */
export async function writeCachedSummary(
  store: StorageProvider,
  id: string,
  entry: SummaryCacheInput,
  at: number,
): Promise<void> {
  await store.write(summaryCacheBlobPath(id, entry.key), JSON.stringify({ ...entry, at }));
}

/**
 * PRD 011 Req 30: roughly how much this workspace's cache holds — the sizes
 * the listing already carries, with no blob read. "Roughly" is the honest
 * word: it is what the store reports for the blobs, which is what an inspect
 * view needs to decide whether Clear is worth offering.
 */
export async function summaryCacheUsage(store: StorageProvider, id: string): Promise<SummaryCacheSize> {
  const blobs = await store.list(summaryCachePrefix(id));
  return { bytes: blobs.reduce((sum, b) => sum + b.size, 0), entries: blobs.length };
}

/** PRD 011 Req 30: Clear — every cache blob of this workspace and nothing else. */
export async function clearSummaryCache(store: StorageProvider, id: string): Promise<number> {
  const blobs = await store.list(summaryCachePrefix(id));
  await Promise.all(blobs.map((b) => store.delete(b.path)));
  return blobs.length;
}
