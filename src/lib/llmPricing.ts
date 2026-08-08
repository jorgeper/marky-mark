/**
 * PRD 011 Req 31: the curated per-provider recommendation — one model that is
 * good enough for summarization, its price per million input/output tokens, and
 * the "as of <date>" caveat that says out loud this table is a snapshot.
 *
 * It declares no price shape of its own: `TokenPrice` is `llmCost.ts`'s, reused
 * so the estimator, the measured cost and this table cannot drift apart. The
 * settings area renders what this module answers and composes no sentence.
 *
 * PRD 011 Req 34: pure. Importing it does nothing — one record, some constants
 * and pure functions. No clock: the caveat's date is a literal string, never
 * `new Date()`, so what a reader sees is what an author wrote down.
 *
 * PRD 011 Req 16: nothing here contacts a provider. Prices are typed in, not
 * fetched — the app opens no network call site to price a model.
 */

import type { TokenPrice } from './llmCost';
import type { LlmProviderKind } from './llmSeam';

/**
 * PRD 011 Req 31: the ONE place the caveat's date is written. Every sentence
 * that dates a price derives from this constant, so a refresh is one edit.
 */
export const PRICES_AS_OF = '2026-08-08';

/** PRD 011 Req 31: every price carries the currency it is in. */
export const PRICE_CURRENCY = 'USD';

/**
 * PRD 011 Req 31: what this app recommends for summarization on one provider —
 * the model id and what it costs. `null` is a real answer (see `custom`).
 */
export interface LlmRecommendation {
  /** A model id this provider accepts, and one the chooser already offers. */
  modelId: string;
  /** `llmCost.ts`'s own price shape — not a second one. */
  price: TokenPrice;
  /** The currency `price` is quoted in. */
  currency: string;
}

/**
 * PRD 011 Req 31: the curated table, keyed by the seam's own union and
 * exhaustive by construction — a sixth provider kind fails the typecheck here
 * until it is either priced or explicitly declared unpriceable (`null`).
 *
 * The recommendation is deliberately the CHEAP good-enough model on each
 * provider: a zoomed level asks for a 2–3 sentence summary per section, which
 * is not work a flagship model does better. Each id also appears in that
 * provider's `LLM_PROVIDERS[kind].models` list, pinned by a unit test, so what
 * is recommended is selectable from the existing chooser.
 *
 * Anthropic's ids and prices are taken from the `claude-api` skill rather than
 * from memory, matching the note already on `LLM_PROVIDERS.anthropic`; the
 * others are the providers' own published list prices as of
 * {@link PRICES_AS_OF}. All are USD per million tokens.
 */
export const LLM_RECOMMENDATIONS: Record<LlmProviderKind, LlmRecommendation | null> = {
  anthropic: {
    // `claude-api` skill, Current Models: Claude Haiku 4.5, $1.00 / $5.00.
    modelId: 'claude-haiku-4-5',
    price: { inputPerMillion: 1, outputPerMillion: 5 },
    currency: PRICE_CURRENCY,
  },
  openai: {
    modelId: 'gpt-4o-mini',
    price: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    currency: PRICE_CURRENCY,
  },
  gemini: {
    modelId: 'gemini-2.5-flash',
    price: { inputPerMillion: 0.3, outputPerMillion: 2.5 },
    currency: PRICE_CURRENCY,
  },
  openrouter: {
    // OpenRouter bills the underlying model's rate through its own slug.
    modelId: 'openai/gpt-4.1',
    price: { inputPerMillion: 2, outputPerMillion: 8 },
    currency: PRICE_CURRENCY,
  },
  // PRD 011 Req 31: a custom endpoint has no recommendation and no price,
  // structurally. The app cannot know what an endpoint the reader points at
  // charges, and a fabricated 0 would read as "free".
  custom: null,
};

/**
 * PRD 011 Req 31: the caveat, written once. It says both things the
 * requirement asks for — when these prices were true, and where the current
 * ones are — so no panel composes its own wording.
 */
export const PRICING_CAVEAT = `Prices are as of ${PRICES_AS_OF}; check the provider for current pricing.`;

/** PRD 011 Req 31: the `custom` sentence — its own answer, never a blank or a 0. */
export const NO_RECOMMENDATION_MESSAGE =
  'No recommendation for a custom endpoint: only whoever runs it knows which models it accepts and what they charge.';

/** PRD 011 Req 31: what this provider recommends, or null where nothing is. */
export function recommendationFor(kind: LlmProviderKind): LlmRecommendation | null {
  return LLM_RECOMMENDATIONS[kind];
}

/**
 * PRD 011 Req 31: the price for ONE model id, or null.
 *
 * Only the curated id is priced. A free-text id (PRD 011 Req 6) is unpriced —
 * never priced by guessing a neighbour's rate — so a cost derived from this
 * answer is either right or honestly absent.
 */
export function priceFor(kind: LlmProviderKind, modelId: string): TokenPrice | null {
  const recommended = LLM_RECOMMENDATIONS[kind];
  if (!recommended) return null;
  return modelId.trim() === recommended.modelId ? recommended.price : null;
}

/** Two decimals, or four when the amount would otherwise round away to $0.00. */
export function formatMoney(amount: number, currency: string = PRICE_CURRENCY): string {
  const digits = amount !== 0 && Math.abs(amount) < 0.01 ? 4 : 2;
  return `${currency} ${amount.toFixed(digits)}`;
}

/**
 * PRD 011 Req 31: the price as one line, with its currency. The panel renders
 * this string; it does no arithmetic and picks no unit of its own.
 */
export function priceLine(recommendation: LlmRecommendation): string {
  const { price, currency } = recommendation;
  return `${formatMoney(price.inputPerMillion, currency)} per million input tokens · ${formatMoney(
    price.outputPerMillion,
    currency
  )} per million output tokens`;
}
