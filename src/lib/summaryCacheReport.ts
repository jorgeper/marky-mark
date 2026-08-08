/**
 * PRD 011 Req 30: what the LLM providers page SAYS about the summary cache, and
 * which of its two controls it is honest to draw — as pure functions over the
 * store's own `SummaryCacheSize` and the area state `llmSettings.ts` already
 * computes. The React panel renders these answers and decides nothing itself,
 * so the wording, the rounding and the availability rules are unit-testable
 * with no DOM, no platform and no store.
 *
 * PRD 011 Req 16: importing this module does nothing. Nothing here reads a
 * file, sends a request or touches a store — a size arrives, a sentence comes
 * back.
 */

import type { LlmAreaState } from './llmSettings';
import type { SummaryCacheSize } from './summaryCacheStore';

/**
 * PRD 011 Req 30: a cache holding nothing says so in its own words rather than
 * reporting `0 summaries · about 0 B`, which reads like a broken counter.
 */
export const SUMMARY_CACHE_EMPTY_MESSAGE = 'Empty — no summaries are cached.';

/** PRD 011 Req 30: the size could not be read at all (a broken store or bus). */
export const SUMMARY_CACHE_UNREADABLE_MESSAGE = 'The summary cache could not be read.';

/**
 * PRD 011 Req 30: the hosted cache belongs to the WORKSPACE, so Clear throws
 * away every member's summaries. Said before the click, not after it.
 */
export const SUMMARY_CACHE_SHARED_NOTE =
  'This cache belongs to the workspace: clearing it throws away every member’s cached summaries, not just yours.';

/** PRD 011 Req 30: a refused clear — the one case the hosted route really has. */
export const SUMMARY_CACHE_CLEAR_DENIED =
  'The summary cache was not cleared: clearing this workspace’s shared cache needs the workspace settings permission.';

/** PRD 011 Req 30: any other refusal. Nothing was deleted, and the size stands. */
export const SUMMARY_CACHE_CLEAR_FAILED = 'The summary cache was not cleared. Nothing was deleted.';

/**
 * PRD 011 Req 30: what a size read answers the page — the store's own
 * {@link SummaryCacheSize}, or a refusal carrying the sentence to render. The
 * page never invents a size, so "it could not be read" is a state of its own
 * rather than a zero that would read as "already cleared". Both mount points
 * answer in this shape: the inline panel from the store directly, the desktop
 * aux window over the bus.
 */
export type SummaryCacheSizeResult = { ok: true; size: SummaryCacheSize } | { ok: false; message: string };

/**
 * PRD 011 Req 30: what a clear answers. A failure carries its own sentence and
 * leaves the displayed size alone — nothing was deleted.
 */
export type SummaryCacheClearResult = { ok: true } | { ok: false; message: string };

/**
 * PRD 011 Req 30: bytes in the reader's units. The cap is 4 MiB
 * (`SUMMARY_CACHE_MAX_BYTES`) and the number is an aggregate over a store that
 * changes as they read, so it is rounded to whole KB and one decimal MB rather
 * than pretending to a precision it does not have. Under a kibibyte the raw
 * byte count is the honest answer — "0 KB" would read as empty.
 */
export function formatCacheBytes(bytes: number): string {
  const b = Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * PRD 011 Req 30: the whole report, in one human sentence — `12 summaries ·
 * about 34 KB`. Read from the store's `size()`, never from a count the view
 * kept for itself, and hedged with "about" because the byte figure is the
 * serialized file, not a promise about any one summary.
 */
export function summaryCacheReport(size: SummaryCacheSize): string {
  const entries = Number.isFinite(size.entries) && size.entries > 0 ? Math.floor(size.entries) : 0;
  if (entries === 0) return SUMMARY_CACHE_EMPTY_MESSAGE;
  return `${entries} ${entries === 1 ? 'summary' : 'summaries'} · about ${formatCacheBytes(size.bytes)}`;
}

/**
 * PRD 011 Reqs 9+30: is there a Summary cache section to draw at all? A
 * CAPABILITY question — whether the window that holds the platform reached a
 * `SummaryCacheStore` — never a flavor one, plus the one area state where no
 * control can work (`no-path`, the static web build, which also installs no
 * store). No store means no section: not a dead size line and a disabled
 * button, but nothing.
 */
export function offersSummaryCacheSection(area: LlmAreaState, hasStore: boolean): boolean {
  return hasStore && area.state !== 'no-path';
}

/**
 * PRD 011 Req 30: is the cache shared with other people? True exactly where the
 * deployment owns it — a hosted workspace store — and false for the desktop
 * file store, which is the reader's own.
 */
export function summaryCacheIsShared(area: LlmAreaState): boolean {
  return area.state === 'hosted' || area.state === 'operator-unconfigured';
}

/**
 * PRD 011 Reqs 7+30: why a clear did not happen, in the reader's words. The
 * reason a store throws is the SERVER's (`forbidden`, an HTTP line) — it is
 * matched here and answered with one of this module's own sentences, so no raw
 * server internals and no credential material can reach the page through a
 * failure path.
 */
export function summaryCacheClearFailureMessage(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  return /forbidden|permission|\b403\b/i.test(raw) ? SUMMARY_CACHE_CLEAR_DENIED : SUMMARY_CACHE_CLEAR_FAILED;
}
