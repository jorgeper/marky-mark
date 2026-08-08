/**
 * PRD 011 Reqs 25+26+27: the planning half of real summaries — what a level
 * asks for, what each block shows while it waits, and which results are still
 * wanted by the time they arrive.
 *
 * Everything here is a pure function over plain data: the level's slots come
 * from `zoomLevels.ts`'s entries, the keys from `summaryCache.ts`, and the run
 * identity from the same content hash the keys use. The orchestration — the
 * store, the promises, the bounded fan-out — is `summaryEngine.ts`; this module
 * is what the tests can pin down without a DOM, a platform or a clock.
 *
 * PRD 011 Req 16: importing this module does nothing. It builds descriptions of
 * requests; it never makes one.
 */

import type { LlmFailure, LlmUsage } from './llmSeam';
import { sectionContent } from './sectionModel';
import {
  contentHash,
  summaryKeyForEntry,
  SUMMARY_PROMPT_VERSION,
  type SummaryKeyContext,
} from './summaryCache';
import type { ZoomEntry, ZoomLevel, ZoomView } from './zoomLevels';

/**
 * PRD 011 Req 26: how many summary requests may be in flight at once.
 * Three is a deliberate middle: a zoomed level is a handful of blocks, and
 * three concurrent requests fill them visibly faster than one at a time while
 * staying far below any provider's per-minute limit — a level with twenty
 * sections must not look like a burst worth rate-limiting. It also keeps the
 * order observable: with a small window, blocks fill roughly in document order,
 * which is what makes the behaviour testable at all.
 */
export const SUMMARY_MAX_IN_FLIGHT = 3;

/**
 * PRD 011 Req 25: one slot a level wants filled — the block it belongs to, the
 * cache key that answers for it, and the text a request would summarize.
 */
export interface SummarySlot {
  /** The `ZoomEntry`/`ZoomBlock` id this slot fills. */
  entryId: string;
  /** `summaryKeyForEntry()`'s key — the cache's question and this slot's identity. */
  key: string;
  kind: 'section' | 'document';
  title: string;
  level: ZoomLevel;
  /** The entry's own content plus everything folded into it, in source order. */
  source: string;
}

/**
 * PRD 011 Req 26: what a block knows about its summary right now. A slot with
 * no state at all is a block whose run has not reached it yet; the view's own
 * rule (`semanticZoom.ts`) turns that into the pending state.
 */
export type SummarySlotState =
  | { status: 'pending' }
  | { status: 'summary'; text: string }
  | { status: 'failed'; failure: LlmFailure };

/** Every summary state a level holds, keyed by cache key rather than by block. */
export type SummaryStates = ReadonlyMap<string, SummarySlotState>;

/** The empty state map, so a caller resetting a run does not build its own. */
export const NO_SUMMARY_STATES: SummaryStates = new Map();

/** The text one slot summarizes: the same content its key is computed over. */
function sourceOf(entry: ZoomEntry): string {
  return entry.sources.map(sectionContent).join('\n\n');
}

/**
 * PRD 011 Req 25: the slots THIS level shows, in document order — derived from
 * `zoomView()`'s entries, never from every section in the document. L5 has no
 * entries and therefore no slots, which is why typing in the full document can
 * ask for nothing.
 */
export function planSummarySlots(view: ZoomView, ctx: SummaryKeyContext): SummarySlot[] {
  return view.entries.map((entry) => ({
    entryId: entry.id,
    key: summaryKeyForEntry(entry, { ...ctx, level: view.level }),
    kind: entry.summary.kind,
    title: entry.title || view.title,
    level: view.level,
    source: sourceOf(entry),
  }));
}

/**
 * PRD 011 Req 25: the slots that actually need a request — the ones whose key
 * nothing already answers. Two blocks with identical content share a key and
 * therefore one request, and a key listed in `have` (a cache hit, or a summary
 * this session already produced) costs no call at all.
 */
export function slotsToRequest(
  slots: readonly SummarySlot[],
  have: ReadonlySet<string> = new Set()
): SummarySlot[] {
  const seen = new Set<string>();
  return slots.filter((slot) => {
    if (have.has(slot.key) || seen.has(slot.key)) return false;
    seen.add(slot.key);
    return true;
  });
}

/**
 * PRD 011 Req 27: what a per-section retry re-requests — exactly the one key
 * that failed, never the level. A key the level no longer shows plans nothing.
 */
export function retrySlots(slots: readonly SummarySlot[], key: string): SummarySlot[] {
  return slotsToRequest(slots.filter((slot) => slot.key === key));
}

/**
 * PRD 011 Req 26: what makes a run of summaries the run it is. A result is
 * only wanted while every one of these still holds: the same document, the
 * same content, the same level, and the same provider/model/prompt the key
 * context names.
 */
export interface SummaryRunIdentity {
  /** The open document: a path, or the untitled buffer's own marker. */
  documentId: string;
  /** The buffer's canonical text — editing it ends the run. */
  content: string;
  level: ZoomLevel;
  ctx: SummaryKeyContext;
}

/**
 * PRD 011 Req 26: the run identity as one comparable string. Hashed rather
 * than concatenated so holding it costs a few bytes whatever the document's
 * size, and derived from the same `contentHash` the cache keys use rather than
 * a second scheme.
 */
export function summaryRunId(identity: SummaryRunIdentity): string {
  const { documentId, content, level, ctx } = identity;
  return [
    'run',
    contentHash([documentId, content]),
    `l${level}`,
    ctx.providerId,
    ctx.modelId,
    ctx.promptVersion ?? SUMMARY_PROMPT_VERSION,
  ].join(':');
}

/**
 * PRD 011 Req 26: the ONE rule that decides whether a result may be rendered.
 * A result carries the id of the run that asked for it; if the current run is
 * no longer that one — the level was left, the document closed or switched,
 * the buffer edited, the feature turned off, the provider changed — the result
 * is dropped. No `if (mounted)` anywhere: this is the whole guard.
 */
export function acceptsSummaryResult(currentRunId: string | null, resultRunId: string): boolean {
  return currentRunId !== null && currentRunId === resultRunId;
}

/**
 * PRD 011 Req 25: the provider's own usage report, mapped onto the store's
 * optional field. Unknown usage is OMITTED rather than zeroed — `{known:false}`
 * is not "it cost nothing", and #119's accounting must be able to tell the
 * difference.
 */
export function summaryUsageForStore(
  usage: LlmUsage
): { usage: { promptTokens: number; completionTokens: number } } | Record<string, never> {
  return usage.known
    ? { usage: { promptTokens: usage.inputTokens, completionTokens: usage.outputTokens } }
    : {};
}
