import { describe, expect, test } from 'vitest';
import {
  formatCacheBytes,
  offersSummaryCacheSection,
  summaryCacheClearFailureMessage,
  summaryCacheIsShared,
  summaryCacheReport,
  SUMMARY_CACHE_CLEAR_DENIED,
  SUMMARY_CACHE_CLEAR_FAILED,
  SUMMARY_CACHE_EMPTY_MESSAGE,
} from '../../src/lib/summaryCacheReport';
import { llmAreaState, type LlmAreaState, type LlmSettingsValues } from '../../src/lib/llmSettings';
import { SUMMARY_CACHE_MAX_BYTES } from '../../src/lib/summaryCacheStore';

/** The four persisted values, complete (the `llm-settings` fixture's shape). */
const configured: LlmSettingsValues = {
  llmProvider: 'anthropic',
  llmModel: 'claude-opus-5',
  llmApiKey: 'sk-secret',
  llmBaseUrl: '',
};
const noKey: LlmSettingsValues = { ...configured, llmApiKey: '' };

/** The five area states, built through the real rule rather than hand-shaped. */
const areas: Record<LlmAreaState['state'], LlmAreaState> = {
  'no-path': llmAreaState({ transport: false, hosted: null }, configured),
  'operator-unconfigured': llmAreaState({ transport: false, hosted: { configured: false } }, configured),
  hosted: llmAreaState(
    { transport: false, hosted: { configured: true, provider: 'anthropic', model: 'claude-opus-5' } },
    configured
  ),
  unconfigured: llmAreaState({ transport: true, hosted: null }, noKey),
  ready: llmAreaState({ transport: true, hosted: null }, configured),
};

describe('PRD 011 Req 30 — cache size and clear', () => {
  test('U621: an empty cache reads as empty in its own words, never as a zero count', () => {
    expect(summaryCacheReport({ entries: 0, bytes: 0 })).toBe(SUMMARY_CACHE_EMPTY_MESSAGE);
    // A file with a header but no entries still holds bytes; it is still empty.
    expect(summaryCacheReport({ entries: 0, bytes: 31 })).toBe(SUMMARY_CACHE_EMPTY_MESSAGE);
    expect(SUMMARY_CACHE_EMPTY_MESSAGE).not.toMatch(/\d/);
  });

  test('U622: bytes render in B / KB / MB without claiming precision the cap has not got', () => {
    expect(formatCacheBytes(0)).toBe('0 B');
    expect(formatCacheBytes(940)).toBe('940 B');
    // Whole kibibytes: nothing reports a fraction of a KB.
    expect(formatCacheBytes(1024)).toBe('1 KB');
    expect(formatCacheBytes(34_500)).toBe('34 KB');
    expect(formatCacheBytes(1024 * 1024 - 1)).toBe('1024 KB');
    // MB gets exactly one decimal, and the 4 MiB cap reads as 4.0 MB.
    expect(formatCacheBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatCacheBytes(SUMMARY_CACHE_MAX_BYTES)).toBe('4.0 MB');
    // Junk from a broken store is floored rather than rendered as NaN.
    expect(formatCacheBytes(-5)).toBe('0 B');
    expect(formatCacheBytes(Number.NaN)).toBe('0 B');
  });

  test('U623: a non-empty cache reports its entries and its rounded size in one sentence', () => {
    expect(summaryCacheReport({ entries: 12, bytes: 34_500 })).toBe('12 summaries · about 34 KB');
    // One entry is not "1 summaries".
    expect(summaryCacheReport({ entries: 1, bytes: 700 })).toBe('1 summary · about 700 B');
    expect(summaryCacheReport({ entries: 4096, bytes: SUMMARY_CACHE_MAX_BYTES })).toBe(
      '4096 summaries · about 4.0 MB'
    );
  });

  test('U624: the cache section is offered on the capability, never on a flavor', () => {
    // With a store: every state that draws controls at all draws the section.
    expect(offersSummaryCacheSection(areas['operator-unconfigured'], true)).toBe(true);
    expect(offersSummaryCacheSection(areas.hosted, true)).toBe(true);
    expect(offersSummaryCacheSection(areas.unconfigured, true)).toBe(true);
    expect(offersSummaryCacheSection(areas.ready, true)).toBe(true);
    // No LLM path at all is the static web build: no control can work there.
    expect(offersSummaryCacheSection(areas['no-path'], true)).toBe(false);
    // No store: no section anywhere — not a dead size line and a disabled button.
    for (const area of Object.values(areas)) {
      expect(offersSummaryCacheSection(area, false)).toBe(false);
    }
  });

  test('U625: only a hosted cache is shared, and it says so before the click', () => {
    expect(summaryCacheIsShared(areas.hosted)).toBe(true);
    expect(summaryCacheIsShared(areas['operator-unconfigured'])).toBe(true);
    expect(summaryCacheIsShared(areas.ready)).toBe(false);
    expect(summaryCacheIsShared(areas.unconfigured)).toBe(false);
    expect(summaryCacheIsShared(areas['no-path'])).toBe(false);
  });

  test('U626: a refused clear says why in the reader’s words and never repeats the server', () => {
    // What `createHostedSummaryCache.clear` throws when the route answers 403.
    expect(summaryCacheClearFailureMessage(new Error('forbidden'))).toBe(SUMMARY_CACHE_CLEAR_DENIED);
    expect(summaryCacheClearFailureMessage('HTTP 403')).toBe(SUMMARY_CACHE_CLEAR_DENIED);
    // Anything else is the plain refusal — and nothing was deleted either way.
    const other = new Error('The summary cache could not be cleared (HTTP 500).');
    expect(summaryCacheClearFailureMessage(other)).toBe(SUMMARY_CACHE_CLEAR_FAILED);
    expect(summaryCacheClearFailureMessage(undefined)).toBe(SUMMARY_CACHE_CLEAR_FAILED);
    // PRD 011 Req 7: no raw server text and no credential can ride out here.
    const hostile = new Error('sk-secret leaked by a hostile body: forbidden');
    expect(summaryCacheClearFailureMessage(hostile)).toBe(SUMMARY_CACHE_CLEAR_DENIED);
    expect(summaryCacheClearFailureMessage(hostile)).not.toContain('sk-secret');
    expect(summaryCacheClearFailureMessage(other)).not.toContain('500');
  });
});
