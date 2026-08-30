/**
 * PRD 011 Req 33: the pre-summarization confirmation, as rules and sentences.
 *
 * Two questions live here: whether to ask at all, and what the question says.
 * Both are pure functions over `estimateJob()`'s answer, so "with everything
 * cached, at L5, or with no runner, we never ask" is a unit test rather than a
 * chain of conditions in a component.
 *
 * PRD 011 Req 33: every number this module words is labelled an estimate, and
 * an unknown price says the cost is not known rather than showing a zero.
 * Nothing here is presented as measured usage — that is `llmUsage.ts`'s job.
 *
 * PRD 011 Req 34: pure. It decides nothing about spending and starts nothing;
 * a caller acting on the reader's click does.
 */

import type { JobEstimate } from './llmCost.ts';
import { formatMoney, PRICE_CURRENCY } from './llmPricing.ts';

/** PRD 011 Req 33: everything the "should we ask?" rule reads, as plain data. */
export interface ConfirmSummariesInput {
  /** What the run would do — `estimateJob()`'s answer for this level. */
  estimate: JobEstimate;
  /** The reader ticked "don't ask again" (a persisted setting). */
  suppressed: boolean;
  /** This exact run identity was already approved in this session. */
  approved: boolean;
}

/**
 * PRD 011 Req 33: ask only when the run would actually spend something. A level
 * whose every slot is already answered summarizes nothing, so there is nothing
 * to confirm and no request to make; the same goes for a suppressed
 * confirmation and for a run the reader already said yes to.
 */
export function shouldConfirmSummaries(input: ConfirmSummariesInput): boolean {
  if (input.suppressed || input.approved) return false;
  return input.estimate.sectionsToSummarize > 0;
}

/** PRD 011 Req 33: the question, worded once. */
export const CONFIRM_SUMMARIES_TITLE = 'Summarize this level?';

/** PRD 011 Req 33: what the reader is agreeing to pay for, in one line. */
export function confirmSectionsLine(estimate: JobEstimate): string {
  const n = estimate.sectionsToSummarize;
  const sections = n === 1 ? '1 section' : `${n} sections`;
  const cached =
    estimate.sectionsCached > 0 ? ` (${estimate.sectionsCached} more are already cached and cost nothing)` : '';
  return `About ${sections} would be sent to the provider${cached}.`;
}

/**
 * PRD 011 Req 33: the cost line — always labelled an estimate, and honest when
 * no price is known. `estimateJob()` already answers null costs where no price
 * was supplied, so an uncurated model reads as "not known", never as free.
 */
export function confirmCostLine(estimate: JobEstimate, currency: string = PRICE_CURRENCY): string {
  const tokens = `Estimated ${estimate.inputTokens.toLocaleString('en-US')} input + ${estimate.outputTokens.toLocaleString(
    'en-US'
  )} output tokens`;
  return estimate.totalCost === null
    ? `${tokens}; the cost is not known — this model is not in the app's price table.`
    : `${tokens}, about ${formatMoney(estimate.totalCost, currency)}.`;
}

/** PRD 011 Req 33: the reminder that none of the above is a measurement. */
export const CONFIRM_ESTIMATE_NOTE =
  'These are estimates from a characters-per-token rule of thumb, not a quote. Actual usage is reported in Settings → LLM providers after the run.';
