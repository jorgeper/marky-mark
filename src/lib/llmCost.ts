/**
 * PRD 011 Req 33: before the first summarization of a document at a level, the
 * user is told roughly how many sections will be summarized and what it will
 * cost — always labelled as an estimate.
 * PRD 011 Req 32: measured usage comes from the token counts providers return,
 * and when a provider returns none the app says so rather than inventing a
 * number.
 *
 * PRD 011 Req 34: pure arithmetic. Prices are parameters — the curated
 * per-provider table and its "as of <date>" caveat belong to #119, not here.
 */

import { sectionContent } from './sectionModel';
import { summaryKeyForEntry, type SummaryKeyContext } from './summaryCache';
import type { ZoomView } from './zoomLevels';

/**
 * The token heuristic: ~4 characters per token for English prose, the rule of
 * thumb the major tokenizers land near. It is an approximation by
 * construction, which is why every number derived from it is surfaced as an
 * estimate (Req 33) and never as measured usage (Req 32).
 */
export const CHARS_PER_TOKEN = 4;

/** Instructions wrapped around each section's text, in tokens. */
export const PROMPT_OVERHEAD_TOKENS = 80;

/** Room for the 2–3 sentence summary a level asks for (PRD 011 Req 17). */
export const SUMMARY_OUTPUT_TOKENS = 96;

export interface TokenPrice {
  /** Currency per million input tokens (US dollars, by the caller's choice). */
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface ProviderUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
}

/** PRD 011 Req 33: token counts from the heuristic, never from a tokenizer. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface JobEstimate {
  /** Always true: these numbers are estimates and are labelled as such (Req 33). */
  estimated: true;
  level: number;
  /** Summary slots this level shows. */
  sectionsTotal: number;
  /** Slots already cached — no call is made for them (Req 25, Req 28). */
  sectionsCached: number;
  /** Slots that would actually be summarized. */
  sectionsToSummarize: number;
  inputTokens: number;
  outputTokens: number;
  /** Null when no price was supplied — an unknown cost, never a fabricated 0. */
  inputCost: number | null;
  outputCost: number | null;
  totalCost: number | null;
}

export interface JobEstimateOptions {
  ctx: SummaryKeyContext;
  /** Keys already in the cache; anything listed here costs nothing. */
  cachedKeys?: Iterable<string>;
  price?: TokenPrice | null;
  /** Override the per-summary output allowance (defaults to `SUMMARY_OUTPUT_TOKENS`). */
  outputTokensPerSummary?: number;
}

const costOf = (tokens: number, perMillion: number | undefined): number | null =>
  typeof perMillion === 'number' && Number.isFinite(perMillion) ? (tokens / 1_000_000) * perMillion : null;

const sum = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a + b);

/**
 * PRD 011 Req 33: what summarizing this level would do — how many sections are
 * left after the cache, and the estimated tokens and cost for them.
 */
export function estimateJob(view: ZoomView, opts: JobEstimateOptions): JobEstimate {
  const cached = new Set(opts.cachedKeys ?? []);
  const perSummary = opts.outputTokensPerSummary ?? SUMMARY_OUTPUT_TOKENS;
  let inputTokens = 0;
  let toSummarize = 0;
  let cachedCount = 0;

  for (const entry of view.entries) {
    if (cached.has(summaryKeyForEntry(entry, opts.ctx))) {
      cachedCount++;
      continue;
    }
    toSummarize++;
    inputTokens += PROMPT_OVERHEAD_TOKENS + estimateTokens(entry.sources.map(sectionContent).join('\n\n'));
  }

  const outputTokens = toSummarize * perSummary;
  const inputCost = costOf(inputTokens, opts.price?.inputPerMillion);
  const outputCost = costOf(outputTokens, opts.price?.outputPerMillion);
  return {
    estimated: true,
    level: view.level,
    sectionsTotal: view.entries.length,
    sectionsCached: cachedCount,
    sectionsToSummarize: toSummarize,
    inputTokens,
    outputTokens,
    inputCost,
    outputCost,
    totalCost: sum(inputCost, outputCost),
  };
}

export type MeasuredCost =
  | {
      known: true;
      inputTokens: number;
      outputTokens: number;
      inputCost: number | null;
      outputCost: number | null;
      totalCost: number | null;
    }
  | {
      known: false;
      reason: 'usage-missing';
      inputTokens: null;
      outputTokens: null;
    };

/**
 * PRD 011 Req 32: measured cost from provider-returned usage. A provider that
 * returns no usage yields an explicit unknown — never 0, never an estimate
 * dressed up as a measurement. Costs stay null when no price was supplied, so
 * "we know the tokens but not the price" reads honestly too.
 */
export function measuredCost(usage: ProviderUsage | null | undefined, price?: TokenPrice | null): MeasuredCost {
  const input = usage?.inputTokens;
  const output = usage?.outputTokens;
  if (typeof input !== 'number' || typeof output !== 'number' || !Number.isFinite(input) || !Number.isFinite(output)) {
    return { known: false, reason: 'usage-missing', inputTokens: null, outputTokens: null };
  }
  const inputCost = costOf(input, price?.inputPerMillion);
  const outputCost = costOf(output, price?.outputPerMillion);
  return {
    known: true,
    inputTokens: input,
    outputTokens: output,
    inputCost,
    outputCost,
    totalCost: sum(inputCost, outputCost),
  };
}
