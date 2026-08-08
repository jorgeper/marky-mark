import { describe, expect, test } from 'vitest';
import { USAGE_UNKNOWN } from '../../src/lib/llmSeam';
import { parseSections } from '../../src/lib/sectionModel';
import { summaryKeyForEntry, type SummaryKeyContext } from '../../src/lib/summaryCache';
import {
  acceptsSummaryResult,
  planSummarySlots,
  retrySlots,
  slotsToRequest,
  summaryRunId,
  summaryUsageForStore,
  SUMMARY_MAX_IN_FLIGHT,
} from '../../src/lib/summaryPlan';
import { zoomView, type ZoomLevel } from '../../src/lib/zoomLevels';

const DOC = `# Field Notes

The intro paragraph.

## Editing

Editing prose.

### Smart edit

Smart edit prose.

## Viewing

Viewing prose.
`;

const doc = parseSections(DOC);
const CTX: SummaryKeyContext = { level: 4, providerId: 'anthropic', modelId: 'claude-opus-5' };
const view = (level: ZoomLevel) => zoomView(doc, level);

describe('PRD 011 Req 25 — on demand, this level only, cache misses only', () => {
  test('U600: the plan is derived from THIS level’s entries, never from every section', () => {
    expect(planSummarySlots(view(4), CTX).map((s) => s.entryId)).toEqual(['1', '1.1', '1.1.1', '1.2']);
    expect(planSummarySlots(view(2), CTX).map((s) => s.entryId)).toEqual(['1']);
    // L1 is one whole-document slot; L5 shows the document itself and asks for
    // nothing at all, which is why typing can never cost a request.
    expect(planSummarySlots(view(1), CTX).map((s) => s.kind)).toEqual(['document']);
    expect(planSummarySlots(view(5), CTX)).toEqual([]);
  });

  test('U601: every slot carries the cache key #115 files it under, for the level it was planned at', () => {
    const slots = planSummarySlots(view(3), CTX);
    const entries = view(3).entries;
    for (const [i, slot] of slots.entries()) {
      // The key is `summaryKeyForEntry()`'s, at the level the plan is for —
      // never the level that happened to be in the caller's context object.
      expect(slot.key).toBe(summaryKeyForEntry(entries[i], { ...CTX, level: 3 }));
      // The text summarized is the content the key answers for, folded-in
      // descendants included.
      expect(slot.source).toContain(entries[i].title);
    }
    expect(slots.find((s) => s.entryId === '1.1')?.source).toContain('Smart edit prose.');
    // A different provider or model is a different question: different keys.
    const other = planSummarySlots(view(3), { ...CTX, modelId: 'gpt-5.1' });
    expect(other.map((s) => s.key)).not.toEqual(slots.map((s) => s.key));
  });

  test('U602: a cached key produces no request, and identical blocks share one', () => {
    const slots = planSummarySlots(view(4), CTX);
    expect(slotsToRequest(slots)).toHaveLength(4);
    const cached = new Set(slots.slice(0, 2).map((s) => s.key));
    expect(slotsToRequest(slots, cached).map((s) => s.entryId)).toEqual(['1.1.1', '1.2']);
    // Every key cached: no request at all.
    expect(slotsToRequest(slots, new Set(slots.map((s) => s.key)))).toEqual([]);
    // Two blocks with byte-identical content are one key and one request.
    const twins = planSummarySlots(zoomView(parseSections('## A\n\nSame.\n\n## A\n\nSame.\n'), 4), CTX);
    expect(twins).toHaveLength(2);
    expect(twins[0].key).toBe(twins[1].key);
    expect(slotsToRequest(twins)).toHaveLength(1);
  });

  test('U603: usage is carried when the provider reported it and omitted — never zeroed — when it did not', () => {
    expect(summaryUsageForStore({ known: true, inputTokens: 120, outputTokens: 40 })).toEqual({
      usage: { promptTokens: 120, completionTokens: 40 },
    });
    expect(summaryUsageForStore(USAGE_UNKNOWN)).toEqual({});
    expect('usage' in summaryUsageForStore(USAGE_UNKNOWN)).toBe(false);
  });
});

describe('PRD 011 Req 26 — cancellation is one rule over a run identity', () => {
  const identity = {
    documentId: '/docs/zoom.md',
    content: DOC,
    level: 4 as ZoomLevel,
    ctx: CTX,
  };

  test('U604: a result is accepted only while the document, content, level and context all still hold', () => {
    const current = summaryRunId(identity);
    expect(acceptsSummaryResult(current, current)).toBe(true);
    // Every axis of the identity ends the run when it changes.
    for (const changed of [
      { ...identity, documentId: '/docs/other.md' },
      { ...identity, content: `${DOC}\nEdited.\n` },
      { ...identity, level: 3 as ZoomLevel },
      { ...identity, ctx: { ...CTX, modelId: 'gpt-5.1' } },
      { ...identity, ctx: { ...CTX, providerId: 'openai' } },
    ]) {
      expect(acceptsSummaryResult(summaryRunId(changed), current), JSON.stringify(changed)).toBe(false);
    }
    // Leaving the level entirely (no run at all) accepts nothing.
    expect(acceptsSummaryResult(null, current)).toBe(false);
    // The id is a bounded string whatever the document's size.
    expect(summaryRunId({ ...identity, content: 'x'.repeat(500_000) }).length).toBeLessThan(120);
  });

  test('U605: the in-flight bound is a small named constant, not an unbounded fan-out', () => {
    expect(SUMMARY_MAX_IN_FLIGHT).toBeGreaterThan(0);
    expect(SUMMARY_MAX_IN_FLIGHT).toBeLessThanOrEqual(4);
  });
});

describe('PRD 011 Req 27 — a retry re-requests exactly one section', () => {
  test('U606: the retry plan holds the one failed key and nothing else', () => {
    const slots = planSummarySlots(view(4), CTX);
    const failed = slots[2];
    const plan = retrySlots(slots, failed.key);
    expect(plan).toHaveLength(1);
    expect(plan[0].key).toBe(failed.key);
    expect(plan[0].entryId).toBe(failed.entryId);
    // A key this level no longer shows plans nothing — no accidental request.
    expect(retrySlots(slots, 'mmz1:p1:anthropic:claude-opus-5:l4:deadbeefdeadbeef')).toEqual([]);
  });
});
