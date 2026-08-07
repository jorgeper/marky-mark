import { describe, expect, test } from 'vitest';
import {
  CHARS_PER_TOKEN,
  PROMPT_OVERHEAD_TOKENS,
  SUMMARY_OUTPUT_TOKENS,
  estimateJob,
  estimateTokens,
  measuredCost,
  type TokenPrice,
} from '../../src/lib/llmCost';
import { parseSections } from '../../src/lib/sectionModel';
import { summaryKeyForEntry, type SummaryKeyContext } from '../../src/lib/summaryCache';
import { zoomView } from '../../src/lib/zoomLevels';

const CTX: SummaryKeyContext = { level: 4, providerId: 'openai', modelId: 'gpt-4o-mini' };
const PRICE: TokenPrice = { inputPerMillion: 2, outputPerMillion: 10 };
const SOURCE = '# Guide\n\nOpening.\n\n## Alpha\n\nAlpha body.\n\n## Beta\n\nBeta body.\n';
const doc = parseSections(SOURCE);

describe('PRD 011 Req 32, Req 33 — token and cost math', () => {
  test('U510: token estimation follows the documented characters-per-token heuristic', () => {
    expect(CHARS_PER_TOKEN).toBe(4);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2); // partial tokens round up
    expect(estimateTokens('x'.repeat(400))).toBe(100);
  });

  test('U511: a job estimate counts only the sections a level would actually summarize', () => {
    const view = zoomView(doc, 4);
    const all = estimateJob(view, { ctx: CTX, price: PRICE });
    expect(all.estimated).toBe(true);
    expect(all.level).toBe(4);
    expect(all).toMatchObject({ sectionsTotal: 3, sectionsCached: 0, sectionsToSummarize: 3 });
    expect(all.outputTokens).toBe(3 * SUMMARY_OUTPUT_TOKENS);
    expect(all.inputTokens).toBeGreaterThan(3 * PROMPT_OVERHEAD_TOKENS);
    expect(all.inputCost).toBeCloseTo((all.inputTokens / 1_000_000) * 2, 12);
    expect(all.outputCost).toBeCloseTo((all.outputTokens / 1_000_000) * 10, 12);
    expect(all.totalCost).toBeCloseTo(all.inputCost! + all.outputCost!, 12);

    // Cached sections are not summarized again, so they cost nothing.
    const cachedKeys = view.entries.slice(0, 2).map((e) => summaryKeyForEntry(e, CTX));
    const partial = estimateJob(view, { ctx: CTX, price: PRICE, cachedKeys });
    expect(partial).toMatchObject({ sectionsTotal: 3, sectionsCached: 2, sectionsToSummarize: 1 });
    expect(partial.outputTokens).toBe(SUMMARY_OUTPUT_TOKENS);
    expect(partial.inputTokens).toBeLessThan(all.inputTokens);

    // L5 shows the document verbatim: nothing to summarize, nothing to pay.
    expect(estimateJob(zoomView(doc, 5), { ctx: CTX, price: PRICE })).toMatchObject({
      sectionsTotal: 0,
      sectionsToSummarize: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
    });
  });

  test('U512: without a price the estimate reports unknown cost rather than zero', () => {
    const estimate = estimateJob(zoomView(doc, 2), { ctx: { ...CTX, level: 2 } });
    expect(estimate.sectionsToSummarize).toBe(1);
    expect(estimate.inputTokens).toBeGreaterThan(0);
    expect(estimate.inputCost).toBeNull();
    expect(estimate.outputCost).toBeNull();
    expect(estimate.totalCost).toBeNull();
  });

  test('U513: measured cost uses the provider-returned token counts', () => {
    const measured = measuredCost({ inputTokens: 1_000, outputTokens: 500 }, PRICE);
    expect(measured.known).toBe(true);
    expect(measured).toMatchObject({ inputTokens: 1_000, outputTokens: 500 });
    if (!measured.known) throw new Error('expected known usage');
    expect(measured.inputCost).toBeCloseTo(0.002, 12);
    expect(measured.outputCost).toBeCloseTo(0.005, 12);
    expect(measured.totalCost).toBeCloseTo(0.007, 12);

    // Known tokens with no price is still honest: counts yes, cost unknown.
    const priceless = measuredCost({ inputTokens: 10, outputTokens: 20 });
    expect(priceless).toMatchObject({ known: true, inputTokens: 10, outputTokens: 20, totalCost: null });
  });

  test('U514: absent or partial usage is an explicit unknown, never 0', () => {
    for (const usage of [null, undefined, {}, { inputTokens: 5 }, { inputTokens: 5, outputTokens: null }]) {
      const measured = measuredCost(usage, PRICE);
      expect(measured, JSON.stringify(usage)).toEqual({
        known: false,
        reason: 'usage-missing',
        inputTokens: null,
        outputTokens: null,
      });
    }
  });
});
