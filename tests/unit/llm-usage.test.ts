import { describe, expect, test } from 'vitest';
import { createFakeLlm } from '../../src/lib/llmFake';
import {
  COST_UNKNOWN_MESSAGE,
  EMPTY_USAGE_TALLY,
  NO_USAGE_DATA_MESSAGE,
  NO_USAGE_YET_MESSAGE,
  addUsage,
  isUsageTally,
  mergeTally,
  tallyCalls,
  tallyCostKnown,
  usageSentence,
} from '../../src/lib/llmUsage';
import { priceFor } from '../../src/lib/llmPricing';
import { parseSections } from '../../src/lib/sectionModel';
import type { LlmUsage } from '../../src/lib/llmSeam';
import type { SummaryKeyContext } from '../../src/lib/summaryCache';
import { runSummaries } from '../../src/lib/summaryEngine';
import { planSummarySlots } from '../../src/lib/summaryPlan';
import { zoomView } from '../../src/lib/zoomLevels';

const PRICE = priceFor('anthropic', 'claude-haiku-4-5')!;
const measured = (input: number, output: number): LlmUsage => ({
  known: true,
  inputTokens: input,
  outputTokens: output,
});
const UNKNOWN: LlmUsage = { known: false };

describe('PRD 011 Req 32 — measured usage, folded honestly', () => {
  test('U638: measured calls accumulate tokens and cost from the curated price', () => {
    let tally = addUsage(EMPTY_USAGE_TALLY, measured(1_000_000, 100_000), PRICE);
    tally = addUsage(tally, measured(500_000, 50_000), PRICE);
    expect(tally.measuredCalls).toBe(2);
    expect(tally.unmeasuredCalls).toBe(0);
    expect(tally.inputTokens).toBe(1_500_000);
    expect(tally.outputTokens).toBe(150_000);
    // 1.5 × $1.00 input + 0.15 × $5.00 output. One cost formula, not a second.
    expect(tally.cost).toBeCloseTo(1.5 + 0.75, 10);
    expect(tallyCostKnown(tally)).toBe(true);
    expect(usageSentence(tally)).toContain('1,500,000 input');
    expect(usageSentence(tally)).toContain('USD 2.25');
  });

  test('U639: unknown usage is said, not invented — and never counted as zero', () => {
    expect(usageSentence(EMPTY_USAGE_TALLY)).toBe(NO_USAGE_YET_MESSAGE);
    const none = addUsage(addUsage(EMPTY_USAGE_TALLY, UNKNOWN, PRICE), UNKNOWN, PRICE);
    expect(none.measuredCalls).toBe(0);
    expect(none.unmeasuredCalls).toBe(2);
    expect(none.inputTokens).toBe(0);
    // The sentence says "no usage data", never "0 tokens · USD 0.00".
    const sentence = usageSentence(none);
    expect(sentence).toContain(NO_USAGE_DATA_MESSAGE);
    expect(sentence).toContain('2 calls');
    expect(sentence).not.toContain('USD 0.00');
  });

  test('U640: a mixed run reports what it measured AND what it could not', () => {
    let tally = addUsage(EMPTY_USAGE_TALLY, measured(200_000, 20_000), PRICE);
    tally = addUsage(tally, UNKNOWN, PRICE);
    expect(tallyCalls(tally)).toBe(2);
    const sentence = usageSentence(tally);
    expect(sentence).toContain('200,000 input');
    // The total states how many calls it could not measure rather than
    // silently under-reporting them.
    expect(sentence).toContain('1 call returned no usage data');
  });

  test('U641: a model with no curated price reports tokens with the cost unknown', () => {
    const tally = addUsage(EMPTY_USAGE_TALLY, measured(400_000, 40_000), priceFor('anthropic', 'a-new-model'));
    expect(tally.measuredCalls).toBe(1);
    expect(tally.unpricedCalls).toBe(1);
    expect(tally.inputTokens).toBe(400_000);
    expect(tallyCostKnown(tally)).toBe(false);
    const sentence = usageSentence(tally);
    expect(sentence).toContain('400,000 input');
    expect(sentence).toContain(COST_UNKNOWN_MESSAGE);
    expect(sentence).not.toMatch(/USD \d/);
  });

  test('U642: the running total merges runs, and a reset empties it without touching a run', () => {
    const runA = addUsage(EMPTY_USAGE_TALLY, measured(100_000, 10_000), PRICE);
    const runB = addUsage(addUsage(EMPTY_USAGE_TALLY, measured(300_000, 30_000), PRICE), UNKNOWN, PRICE);
    const total = mergeTally(mergeTally(EMPTY_USAGE_TALLY, runA), runB);
    expect(total.inputTokens).toBe(400_000);
    expect(total.measuredCalls).toBe(2);
    expect(total.unmeasuredCalls).toBe(1);
    expect(total.cost).toBeCloseTo(0.4 + 0.2, 10);
    // Reset is exactly this value — the run figure above is untouched by it.
    expect(usageSentence(EMPTY_USAGE_TALLY)).toBe(NO_USAGE_YET_MESSAGE);
    expect(runA.inputTokens).toBe(100_000);
  });

  test('U643: a hand-edited settings value is validated, not trusted', () => {
    expect(isUsageTally(EMPTY_USAGE_TALLY)).toBe(true);
    expect(isUsageTally({ ...EMPTY_USAGE_TALLY, cost: 1.25 })).toBe(true);
    expect(isUsageTally(null)).toBe(false);
    expect(isUsageTally('lots')).toBe(false);
    expect(isUsageTally({ ...EMPTY_USAGE_TALLY, inputTokens: Number.NaN })).toBe(false);
    expect(isUsageTally({ ...EMPTY_USAGE_TALLY, measuredCalls: -1 })).toBe(false);
    expect(isUsageTally({ measuredCalls: 1 })).toBe(false);
  });
});

const DOC = `# Notes

Intro prose.

## One

One prose.

## Two

Two prose.
`;
const CTX: SummaryKeyContext = { level: 4, providerId: 'anthropic', modelId: 'claude-haiku-4-5' };

describe('PRD 011 Reqs 32+35 — usage travels from the seam, against the local fake', () => {
  /** PRD 011 Req 35: no test contacts a real provider; this is the fake. */
  const runWith = async (usage?: { inputTokens: number; outputTokens: number }) => {
    const fake = createFakeLlm({ outcome: 'text', text: 'A summary.', ...(usage ? { usage } : {}) });
    const slots = planSummarySlots(zoomView(parseSections(DOC), 4), CTX);
    let tally = EMPTY_USAGE_TALLY;
    await runSummaries({
      slots,
      ctx: CTX,
      run: (request) => fake.run({ kind: 'anthropic', apiKey: 'sk-usage', model: CTX.modelId }, request),
      onState: () => {},
      onUsage: (u) => {
        tally = addUsage(tally, u, PRICE);
      },
      isCancelled: () => false,
    });
    return { tally, calls: fake.calls.length };
  };

  test('U644: a reply carrying usage is measured; one without it is reported as unmeasured', async () => {
    const withUsage = await runWith({ inputTokens: 120, outputTokens: 40 });
    expect(withUsage.calls).toBeGreaterThan(0);
    expect(withUsage.tally.measuredCalls).toBe(withUsage.calls);
    expect(withUsage.tally.inputTokens).toBe(120 * withUsage.calls);

    const without = await runWith();
    expect(without.tally.measuredCalls).toBe(0);
    expect(without.tally.unmeasuredCalls).toBe(without.calls);
    expect(usageSentence(without.tally)).toContain(NO_USAGE_DATA_MESSAGE);
  });

  test('U645: a run served entirely from the memo makes no call and reports no usage', async () => {
    const fake = createFakeLlm({ outcome: 'text', text: 'A summary.', usage: { inputTokens: 10, outputTokens: 5 } });
    const slots = planSummarySlots(zoomView(parseSections(DOC), 4), CTX);
    const memo = new Map(slots.map((slot) => [slot.key, 'Cached summary.']));
    let tally = EMPTY_USAGE_TALLY;
    await runSummaries({
      slots,
      ctx: CTX,
      run: (request) => fake.run({ kind: 'anthropic', apiKey: 'sk-usage', model: CTX.modelId }, request),
      memo,
      onState: () => {},
      onUsage: (u) => {
        tally = addUsage(tally, u, PRICE);
      },
      isCancelled: () => false,
    });
    expect(fake.calls.length).toBe(0);
    // A cache/memo hit contributes nothing at all — not even an empty run.
    expect(tally).toEqual(EMPTY_USAGE_TALLY);
    expect(usageSentence(tally)).toBe(NO_USAGE_YET_MESSAGE);
  });
});
