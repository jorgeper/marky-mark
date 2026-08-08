import { describe, expect, test } from 'vitest';
import { estimateJob } from '../../src/lib/llmCost';
import { priceFor } from '../../src/lib/llmPricing';
import { parseSections } from '../../src/lib/sectionModel';
import type { SummaryKeyContext } from '../../src/lib/summaryCache';
import {
  CONFIRM_ESTIMATE_NOTE,
  CONFIRM_SUMMARIES_TITLE,
  confirmCostLine,
  confirmSectionsLine,
  shouldConfirmSummaries,
} from '../../src/lib/summaryConfirm';
import { planSummarySlots, summaryRunId } from '../../src/lib/summaryPlan';
import { zoomView, type ZoomLevel } from '../../src/lib/zoomLevels';

const DOC = `# Field Notes

Intro prose for the document.

## Editing

Editing prose lives here.

## Viewing

Viewing prose lives here.
`;

const CTX: SummaryKeyContext = { level: 4, providerId: 'anthropic', modelId: 'claude-haiku-4-5' };
const PRICE = priceFor('anthropic', CTX.modelId);

const estimateAt = (level: ZoomLevel, cachedKeys: string[] = [], price = PRICE) =>
  estimateJob(zoomView(parseSections(DOC), level), { ctx: { ...CTX, level }, cachedKeys, price });

describe('PRD 011 Req 33 — the pre-summarization confirmation', () => {
  test('U646: a level with work to do asks, and names the sections and the estimate', () => {
    const estimate = estimateAt(4);
    expect(estimate.sectionsToSummarize).toBeGreaterThan(0);
    expect(shouldConfirmSummaries({ estimate, suppressed: false, approved: false })).toBe(true);

    const sections = confirmSectionsLine(estimate);
    expect(sections).toContain(`${estimate.sectionsToSummarize} sections`);
    // PRD 011 Req 33: every number is labelled an estimate.
    const cost = confirmCostLine(estimate);
    expect(cost).toContain('Estimated');
    expect(cost).toContain('USD');
    expect(CONFIRM_SUMMARIES_TITLE).toContain('Summarize');
    expect(CONFIRM_ESTIMATE_NOTE).toContain('estimates');
  });

  test('U647: nothing to summarize means no ask — every slot cached, or L5', () => {
    const level: ZoomLevel = 4;
    const allKeys = planSummarySlots(zoomView(parseSections(DOC), level), { ...CTX, level }).map((s) => s.key);
    const cached = estimateAt(level, allKeys);
    expect(cached.sectionsToSummarize).toBe(0);
    expect(shouldConfirmSummaries({ estimate: cached, suppressed: false, approved: false })).toBe(false);

    // L5 is the untouched document: no entries, so no slots and no spend.
    const full = estimateAt(5);
    expect(full.sectionsToSummarize).toBe(0);
    expect(shouldConfirmSummaries({ estimate: full, suppressed: false, approved: false })).toBe(false);
  });

  test('U648: suppression and a prior approval each silence the question', () => {
    const estimate = estimateAt(4);
    // "Don't ask again", persisted.
    expect(shouldConfirmSummaries({ estimate, suppressed: true, approved: false })).toBe(false);
    // The same run identity, already said yes to this session.
    expect(shouldConfirmSummaries({ estimate, suppressed: false, approved: true })).toBe(false);
  });

  test('U649: an unpriced model says the cost is not known rather than showing zero', () => {
    const estimate = estimateAt(4, [], priceFor('anthropic', 'a-model-shipped-tomorrow'));
    expect(estimate.totalCost).toBeNull();
    const cost = confirmCostLine(estimate);
    expect(cost).toContain('not known');
    expect(cost).not.toContain('USD 0.00');
    // The token counts are still shown, still as estimates.
    expect(cost).toContain('Estimated');
  });

  test('U650: the question is keyed to document, content, level and provider/model', () => {
    const base = { documentId: '/docs/zoom.md', content: DOC, level: 4 as ZoomLevel, ctx: CTX };
    const id = summaryRunId(base);
    // Re-entering the same level with the same everything is the same question.
    expect(summaryRunId({ ...base })).toBe(id);
    // Each of the four changes the identity — a different cost, so it asks again.
    expect(summaryRunId({ ...base, documentId: '/docs/other.md' })).not.toBe(id);
    expect(summaryRunId({ ...base, content: `${DOC}\nedited` })).not.toBe(id);
    expect(summaryRunId({ ...base, level: 3 })).not.toBe(id);
    expect(summaryRunId({ ...base, ctx: { ...CTX, providerId: 'openai' } })).not.toBe(id);
    expect(summaryRunId({ ...base, ctx: { ...CTX, modelId: 'gpt-4o-mini' } })).not.toBe(id);

    // ...and an approval is keyed by that identity, so only the same run is silent.
    const approvals = new Set([id]);
    const estimate = estimateAt(4);
    expect(
      shouldConfirmSummaries({ estimate, suppressed: false, approved: approvals.has(id) })
    ).toBe(false);
    expect(
      shouldConfirmSummaries({
        estimate,
        suppressed: false,
        approved: approvals.has(summaryRunId({ ...base, level: 3 })),
      })
    ).toBe(true);
  });
});
