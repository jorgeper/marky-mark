import { describe, expect, test } from 'vitest';
import {
  LLM_RECOMMENDATIONS,
  NO_RECOMMENDATION_MESSAGE,
  PRICES_AS_OF,
  PRICE_CURRENCY,
  PRICING_CAVEAT,
  formatMoney,
  priceFor,
  priceLine,
  recommendationFor,
} from '../../src/lib/llmPricing';
import { LLM_PROVIDERS, LLM_PROVIDER_KINDS } from '../../src/lib/llmSettings';
import { estimateJob } from '../../src/lib/llmCost';

describe('PRD 011 Req 31 — the curated recommendation and its price', () => {
  test('U632: every provider kind is answered, and only `custom` has no recommendation', () => {
    // Exhaustive by construction: the record is keyed by `LlmProviderKind`, so
    // this asserts the runtime shape the typecheck already pins.
    expect(Object.keys(LLM_RECOMMENDATIONS).sort()).toEqual([...LLM_PROVIDER_KINDS].sort());
    for (const kind of LLM_PROVIDER_KINDS) {
      const rec = recommendationFor(kind);
      if (kind === 'custom') {
        // PRD 011 Req 31: absent, structurally — not a zero and not a blank.
        expect(rec).toBeNull();
        continue;
      }
      expect(rec).not.toBeNull();
      expect(rec!.modelId).not.toBe('');
      expect(rec!.currency).toBe(PRICE_CURRENCY);
      expect(rec!.price.inputPerMillion).toBeGreaterThan(0);
      expect(rec!.price.outputPerMillion).toBeGreaterThan(0);
    }
  });

  test('U633: each recommended model id is selectable from the existing chooser', () => {
    for (const kind of LLM_PROVIDER_KINDS) {
      const rec = recommendationFor(kind);
      if (!rec) continue;
      // Two catalogues cannot drift apart: what #119 recommends must be in the
      // list #116's model dropdown already offers.
      expect(LLM_PROVIDERS[kind].models, `${kind} must offer ${rec.modelId}`).toContain(rec.modelId);
    }
  });

  test('U634: a price is answered only for the curated id, and never guessed for another', () => {
    expect(priceFor('anthropic', 'claude-haiku-4-5')).toEqual(LLM_RECOMMENDATIONS.anthropic!.price);
    // Whitespace is the user's typing, not their intent.
    expect(priceFor('anthropic', '  claude-haiku-4-5 ')).toEqual(LLM_RECOMMENDATIONS.anthropic!.price);
    // PRD 011 Req 6: a free-text model id is UNPRICED — never a neighbour's rate.
    expect(priceFor('anthropic', 'claude-opus-5')).toBeNull();
    expect(priceFor('anthropic', 'some-model-shipped-tomorrow')).toBeNull();
    expect(priceFor('openai', 'gpt-4o-mini')).toEqual(LLM_RECOMMENDATIONS.openai!.price);
    expect(priceFor('openai', 'claude-haiku-4-5')).toBeNull();
    // PRD 011 Req 31: a custom endpoint prices nothing at all.
    expect(priceFor('custom', 'anything')).toBeNull();
    expect(priceFor('custom', '')).toBeNull();
  });

  test('U635: the caveat is one literal-dated sentence, and `custom` gets its own', () => {
    expect(PRICES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(PRICING_CAVEAT).toContain(PRICES_AS_OF);
    expect(PRICING_CAVEAT).toContain('check the provider');
    // The panel composes none of its own wording, so the `custom` sentence
    // exists here too — and says why, not just "none".
    expect(NO_RECOMMENDATION_MESSAGE).toContain('custom endpoint');
    // The price line carries the currency and both directions.
    const line = priceLine(LLM_RECOMMENDATIONS.anthropic!);
    expect(line).toContain(PRICE_CURRENCY);
    expect(line).toContain('input tokens');
    expect(line).toContain('output tokens');
  });

  test('U636: a small amount keeps its digits rather than rounding to nothing', () => {
    expect(formatMoney(1.5)).toBe('USD 1.50');
    expect(formatMoney(0.0003)).toBe('USD 0.0003');
    expect(formatMoney(0)).toBe('USD 0.00');
  });

  test('U637: the curated price feeds the estimator, and an unpriced model leaves it null', () => {
    const view = {
      level: 4 as const,
      title: 'Doc',
      entries: [
        {
          id: 'a',
          title: 'A',
          depth: 1,
          summary: { kind: 'section' as const },
          sources: [{ id: 'a', title: 'A', depth: 1, line: 1, endLine: 2, content: 'x'.repeat(400) }],
        },
      ],
    };
    const ctx = { level: 4 as const, providerId: 'anthropic', modelId: 'claude-haiku-4-5' };
    const priced = estimateJob(view as never, { ctx, price: priceFor('anthropic', ctx.modelId) });
    expect(priced.totalCost).not.toBeNull();
    const unpriced = estimateJob(view as never, { ctx, price: priceFor('anthropic', 'made-up-model') });
    expect(unpriced.totalCost).toBeNull();
    expect(unpriced.inputTokens).toBe(priced.inputTokens);
  });
});
