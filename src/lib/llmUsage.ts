/**
 * PRD 011 Req 32: what a summarization ACTUALLY spent, folded up from the token
 * counts providers returned — the run that just finished, and a running total.
 *
 * Every rule about honesty lives here. A call whose provider reported nothing
 * is counted as unmeasured rather than as zero; a model with no curated price
 * contributes its tokens with the cost left unknown rather than a fabricated
 * amount. The costs themselves come from `measuredCost()` in `llmCost.ts` —
 * there is no second cost formula in the app.
 *
 * PRD 011 Req 34: pure. It folds plain data into plain data; the run that
 * produced the usage, the store that cached it and the settings layer that
 * persists the total are all somebody else's job.
 */

import { measuredCost, type TokenPrice } from './llmCost.ts';
import type { LlmUsage } from './llmSeam.ts';
import { formatMoney, PRICE_CURRENCY } from './llmPricing.ts';

/**
 * PRD 011 Req 32: one accounting answer. The two counts are what makes it
 * honest: `unmeasuredCalls` is calls the provider said nothing about, and
 * `unpricedCalls` is measured calls whose model the curated table does not
 * price. Either one being non-zero means the totals below understate reality,
 * and the sentence says so rather than hiding it.
 */
export interface UsageTally {
  /** Calls whose provider reported token counts. */
  measuredCalls: number;
  /** Calls whose provider reported none (`LlmUsage.known === false`). */
  unmeasuredCalls: number;
  /** Measured calls whose model has no curated price — cost unknown, not 0. */
  unpricedCalls: number;
  /** Input tokens over the measured calls only. */
  inputTokens: number;
  /** Output tokens over the measured calls only. */
  outputTokens: number;
  /** Cost of the priced calls; null when none were priced. */
  cost: number | null;
}

/** PRD 011 Req 32: nothing has been spent. Stated once so no caller builds it. */
export const EMPTY_USAGE_TALLY: UsageTally = {
  measuredCalls: 0,
  unmeasuredCalls: 0,
  unpricedCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cost: null,
};

/** How many calls this tally saw at all, measured or not. */
export function tallyCalls(tally: UsageTally): number {
  return tally.measuredCalls + tally.unmeasuredCalls;
}

/**
 * PRD 011 Req 32: is every number in this tally knowable and priced? Written as
 * a type guard so a caller that has asked may then read `cost` as a number,
 * rather than asserting one past the null the type still admits.
 */
export function tallyCostKnown(tally: UsageTally): tally is UsageTally & { cost: number } {
  return tally.cost !== null && tally.unpricedCalls === 0;
}

/**
 * PRD 011 Req 32: fold ONE call's usage into a tally. `price` is the curated
 * table's answer for the model that ran — null is normal (a free-text model id)
 * and produces an unknown cost, never a zero one.
 */
export function addUsage(tally: UsageTally, usage: LlmUsage, price?: TokenPrice | null): UsageTally {
  const measured = measuredCost(
    usage.known ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : null,
    price
  );
  if (!measured.known) {
    return { ...tally, unmeasuredCalls: tally.unmeasuredCalls + 1 };
  }
  // A null cost is the unpriced case: the tokens still count, the money does
  // not, and the tally's own `cost` is left exactly as it was.
  const cost = measured.totalCost;
  return {
    measuredCalls: tally.measuredCalls + 1,
    unmeasuredCalls: tally.unmeasuredCalls,
    unpricedCalls: tally.unpricedCalls + (cost === null ? 1 : 0),
    inputTokens: tally.inputTokens + measured.inputTokens,
    outputTokens: tally.outputTokens + measured.outputTokens,
    cost: cost === null ? tally.cost : (tally.cost ?? 0) + cost,
  };
}

/** PRD 011 Req 32: add a finished run's tally into the running total. */
export function mergeTally(total: UsageTally, run: UsageTally): UsageTally {
  return {
    measuredCalls: total.measuredCalls + run.measuredCalls,
    unmeasuredCalls: total.unmeasuredCalls + run.unmeasuredCalls,
    unpricedCalls: total.unpricedCalls + run.unpricedCalls,
    inputTokens: total.inputTokens + run.inputTokens,
    outputTokens: total.outputTokens + run.outputTokens,
    cost: run.cost === null ? total.cost : (total.cost ?? 0) + run.cost,
  };
}

/**
 * PRD 011 Req 32: is this a value the settings layer may honour? A hand-edited
 * settings file must not put a NaN or a negative count into the accounting, so
 * every field is checked rather than trusted.
 */
export function isUsageTally(raw: unknown): raw is UsageTally {
  if (typeof raw !== 'object' || raw === null) return false;
  const t = raw as Record<string, unknown>;
  const count = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  return (
    count(t.measuredCalls) &&
    count(t.unmeasuredCalls) &&
    count(t.unpricedCalls) &&
    count(t.inputTokens) &&
    count(t.outputTokens) &&
    (t.cost === null || count(t.cost))
  );
}

/** PRD 011 Req 32: nothing has been summarized yet — said, not shown as 0. */
export const NO_USAGE_YET_MESSAGE = 'Nothing summarized yet.';

/** PRD 011 Req 32: the provider returned no token counts at all for these calls. */
export const NO_USAGE_DATA_MESSAGE = 'The provider returned no usage data.';

/** PRD 011 Req 32: tokens were measured but the model has no curated price. */
export const COST_UNKNOWN_MESSAGE = 'cost unknown (no curated price for this model)';

/**
 * PRD 011 Req 32: the one sentence a tally renders as. Every state has its own
 * words — nothing measured, nothing reported, measured-but-unpriced, and the
 * partial case where some calls reported and others did not — so the panel
 * never has to decide what a zero means.
 */
export function usageSentence(tally: UsageTally, currency: string = PRICE_CURRENCY): string {
  if (tallyCalls(tally) === 0) return NO_USAGE_YET_MESSAGE;
  if (tally.measuredCalls === 0) {
    return `${NO_USAGE_DATA_MESSAGE} ${callCount(tally.unmeasuredCalls)} could not be measured.`;
  }
  const cost = tallyCostKnown(tally) ? formatMoney(tally.cost, currency) : COST_UNKNOWN_MESSAGE;
  const parts = [
    `${tally.inputTokens.toLocaleString('en-US')} input + ${tally.outputTokens.toLocaleString(
      'en-US'
    )} output tokens over ${callCount(tally.measuredCalls)}`,
    cost,
  ];
  if (tally.unmeasuredCalls > 0) {
    parts.push(`${callCount(tally.unmeasuredCalls)} returned no usage data`);
  }
  return `${parts.join(' · ')}.`;
}

function callCount(n: number): string {
  return n === 1 ? '1 call' : `${n} calls`;
}
