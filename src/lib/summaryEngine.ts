/**
 * PRD 011 Reqs 25+26+27: the orchestration half of real summaries — cache
 * first, then a bounded, in-order fan-out through whichever runner the window
 * has, reporting each block's state the moment it changes.
 *
 * It holds NO rules: what a level asks for, which slots need a request, what a
 * block shows and whether a result is still wanted are all `summaryPlan.ts`'s,
 * and the prompt is `summaryPrompt.ts`'s. What lives here — and only here — is
 * the promise plumbing: awaiting the store, running at most
 * {@link SUMMARY_MAX_IN_FLIGHT} requests at a time, and handing results back.
 * That is why it is not in `zoom-purity.test.ts`'s module list: it is
 * legitimately impure orchestration, not a rule smuggled out of the pure core.
 *
 * It still imports no React, no platform module and no component: the store and
 * the runner arrive as arguments, so a unit test drives the whole thing with
 * the local fake (PRD 011 Req 35).
 *
 * PRD 011 Req 16: importing this file starts nothing. Every request begins at
 * {@link runSummaries}, called because a reader entered a zoomed level or
 * clicked a retry.
 */

import type { LlmRunner } from './llmSettings';
import {
  SUMMARY_MAX_IN_FLIGHT,
  slotsToRequest,
  summaryUsageForStore,
  type SummarySlot,
  type SummarySlotState,
} from './summaryPlan';
import { buildSummaryRequest } from './summaryPrompt';
import { SUMMARY_PROMPT_VERSION, type SummaryKeyContext } from './summaryCache';
import type { SummaryCacheStore } from './summaryCacheStore';

export interface SummaryRunOptions {
  /** The level's slots, in document order (`planSummarySlots()`). */
  slots: readonly SummarySlot[];
  /** The key context these slots were planned with. */
  ctx: SummaryKeyContext;
  /** Whoever sends a request here — `selectLlmRunner()`'s answer. */
  run: LlmRunner;
  /**
   * PRD 011 Req 25: the `platform.summaryCache` capability, when the window has
   * one. Absent is fine — the cache is an optimisation, not a precondition.
   */
  store?: SummaryCacheStore | null;
  /**
   * A session-level memo of the SAME keys, shared across runs. It only ever
   * holds keys the store answered or this session generated, so it can never
   * answer for a key the store missed.
   */
  memo?: Map<string, string> | null;
  /** Called whenever a block's state changes; never called once cancelled. */
  onState: (key: string, state: SummarySlotState) => void;
  /** PRD 011 Req 26: the run identity guard, asked before every emission. */
  isCancelled: () => boolean;
}

/** A store read that answers a miss for anything it cannot answer (Req 25). */
async function cachedSummary(store: SummaryCacheStore | null | undefined, key: string): Promise<string | null> {
  if (!store) return null;
  try {
    const entry = await store.get(key);
    return entry ? entry.summary : null;
  } catch {
    // A store that throws degrades to "summarize again", never to a broken view.
    return null;
  }
}

/**
 * PRD 011 Req 25: write the generated summary back in #115's entry shape —
 * key, text, provider, model, prompt version, and the provider-reported usage
 * only when it reported any.
 *
 * PRD 011 Req 26: this runs even when the result was DROPPED by the run guard.
 * The key is content-addressed, so the summary is correct for the content it
 * summarized whatever the view moved on to; throwing it away would mean paying
 * for it twice the moment the reader returns to that level.
 */
async function storeSummary(
  store: SummaryCacheStore | null | undefined,
  key: string,
  summary: string,
  ctx: SummaryKeyContext,
  usage: ReturnType<typeof summaryUsageForStore>
): Promise<void> {
  if (!store || summary === '') return;
  try {
    await store.put({
      key,
      summary,
      providerId: ctx.providerId,
      modelId: ctx.modelId,
      promptVersion: ctx.promptVersion ?? SUMMARY_PROMPT_VERSION,
      ...usage,
    });
  } catch {
    // A store that cannot write costs a re-summarization later, nothing more.
  }
}

/**
 * PRD 011 Reqs 25+26: fill these slots. Every slot is looked up in the cache
 * BEFORE any request is built; misses are requested in document order, at most
 * {@link SUMMARY_MAX_IN_FLIGHT} at a time, and each block's state is reported as
 * it lands so a slow section never holds up a fast one.
 *
 * The promise resolves when the run is done or abandoned. A cancelled run
 * issues no further request and emits no further state.
 */
export async function runSummaries(opts: SummaryRunOptions): Promise<void> {
  const { slots, ctx, run, store, memo, onState, isCancelled } = opts;
  const emit = (key: string, state: SummarySlotState): void => {
    if (!isCancelled()) onState(key, state);
  };

  // One entry per distinct key: two blocks with identical content share a key,
  // and therefore share one request and one answer.
  const wanted = slotsToRequest(slots);
  for (const slot of wanted) emit(slot.key, { status: 'pending' });

  const todo: SummarySlot[] = [];
  for (const slot of wanted) {
    if (isCancelled()) return;
    const hit = memo?.get(slot.key) ?? (await cachedSummary(store, slot.key));
    if (hit !== null) {
      memo?.set(slot.key, hit);
      emit(slot.key, { status: 'summary', text: hit });
    } else {
      todo.push(slot);
    }
  }

  // PRD 011 Req 26: a fixed pool over one shared cursor — requests leave in
  // document order, and never more than SUMMARY_MAX_IN_FLIGHT are outstanding.
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (isCancelled()) return;
      const slot = todo[next++];
      if (!slot) return;
      const response = await run(
        buildSummaryRequest({ level: slot.level, kind: slot.kind, title: slot.title, source: slot.source })
      );
      if (!response.ok) {
        emit(slot.key, { status: 'failed', failure: response.failure });
        continue;
      }
      const text = response.text.trim();
      memo?.set(slot.key, text);
      await storeSummary(store, slot.key, text, ctx, summaryUsageForStore(response.usage));
      emit(slot.key, { status: 'summary', text });
    }
  };

  const width = Math.max(1, Math.min(SUMMARY_MAX_IN_FLIGHT, todo.length));
  await Promise.all(Array.from({ length: width }, () => worker()));
}
