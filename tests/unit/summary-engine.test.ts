import { describe, expect, test } from 'vitest';
import { createFakeLlm } from '../../src/lib/llmFake';
import { selectLlmRunner } from '../../src/lib/llmRunner';
import { llmAreaState, type LlmRunner, type LlmSettingsValues } from '../../src/lib/llmSettings';
import type { LlmRequest } from '../../src/lib/llmSeam';
import { parseSections } from '../../src/lib/sectionModel';
import { SUMMARY_PROMPT_VERSION, type SummaryKeyContext } from '../../src/lib/summaryCache';
import type { SummaryCacheEntry, SummaryCacheInput, SummaryCacheStore } from '../../src/lib/summaryCacheStore';
import { runSummaries } from '../../src/lib/summaryEngine';
import { planSummarySlots, retrySlots, type SummarySlotState } from '../../src/lib/summaryPlan';
import { zoomView, type ZoomLevel } from '../../src/lib/zoomLevels';

const DOC = `# Field Notes

The intro paragraph.

## Editing

Editing prose.

## Viewing

Viewing prose.

## Sharing

Sharing prose.

## Printing

Printing prose.
`;

const VALUES: LlmSettingsValues = {
  llmProvider: 'anthropic',
  llmModel: 'claude-opus-5',
  llmApiKey: 'sk-engine',
  llmBaseUrl: '',
};

const CTX: SummaryKeyContext = { level: 4, providerId: 'anthropic', modelId: 'claude-opus-5' };
const slotsFor = (level: ZoomLevel = 4) => planSummarySlots(zoomView(parseSections(DOC), level), CTX);

/** A store with the real capability's surface and none of its I/O. */
function memoryStore(): SummaryCacheStore & { entries: Map<string, SummaryCacheEntry> } {
  const entries = new Map<string, SummaryCacheEntry>();
  return {
    entries,
    get: (key) => Promise.resolve(entries.get(key) ?? null),
    put: (entry: SummaryCacheInput) => {
      entries.set(entry.key, { ...entry, at: 1 });
      return Promise.resolve();
    },
    size: () => Promise.resolve({ bytes: 0, entries: entries.size }),
    clear: () => {
      entries.clear();
      return Promise.resolve();
    },
  };
}

/** A runner whose replies a test resolves by hand, to observe what is in flight. */
function deferredRunner(): { run: LlmRunner; inFlight: Array<{ request: LlmRequest; reply: (text: string) => void }> } {
  const inFlight: Array<{ request: LlmRequest; reply: (text: string) => void }> = [];
  return {
    inFlight,
    run: (request) =>
      new Promise((resolve) => {
        inFlight.push({
          request,
          reply: (text) => resolve({ ok: true, text, usage: { known: false } }),
        });
      }),
  };
}

/** Let every already-resolved promise settle before asserting on the run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const collector = () => {
  const states = new Map<string, SummarySlotState>();
  const order: string[] = [];
  return {
    states,
    order,
    onState: (key: string, state: SummarySlotState) => {
      states.set(key, state);
      order.push(`${key}:${state.status}`);
    },
  };
};

const runnerFor = (fake: ReturnType<typeof createFakeLlm>): LlmRunner =>
  selectLlmRunner(llmAreaState({ transport: true, hosted: null }, VALUES), { transport: fake.transport })!;

describe('PRD 011 Req 25 — cache first, then only the misses', () => {
  test('U609: every slot is looked up before any request, and a hit costs no call', async () => {
    const fake = createFakeLlm();
    const store = memoryStore();
    const slots = slotsFor();
    // Pre-fill two of the five keys, exactly as an earlier zoom cycle would.
    for (const slot of slots.slice(0, 2)) {
      await store.put({
        key: slot.key,
        summary: `cached ${slot.entryId}`,
        providerId: CTX.providerId,
        modelId: CTX.modelId,
        promptVersion: SUMMARY_PROMPT_VERSION,
      });
    }
    const sink = collector();
    await runSummaries({
      slots,
      ctx: CTX,
      run: runnerFor(fake),
      store,
      onState: sink.onState,
      isCancelled: () => false,
    });
    expect(slots).toHaveLength(5);
    expect(fake.calls).toHaveLength(3);
    // Only the misses were requested, each carrying the app's own prompt (the
    // `trigger: 'summarize'` those requests are built with is U597's).
    for (const call of fake.calls) expect(call.prompt).toContain('Section: ');
    expect(sink.states.get(slots[0].key)).toEqual({ status: 'summary', text: 'cached 1' });
    expect(sink.states.get(slots[2].key)).toEqual({ status: 'summary', text: 'A fake summary.' });
    // Every block passed through pending on its way to a result.
    expect(sink.order.filter((o) => o.endsWith(':pending'))).toHaveLength(5);
  });

  test('U610: the generated summary is stored in #115’s entry shape, with usage only when reported', async () => {
    const store = memoryStore();
    const slots = slotsFor(2).slice(0, 1);
    const withUsage = createFakeLlm({
      outcome: 'text',
      text: 'Told usage.',
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    await runSummaries({
      slots,
      ctx: CTX,
      run: runnerFor(withUsage),
      store,
      onState: () => {},
      isCancelled: () => false,
    });
    expect(store.entries.get(slots[0].key)).toMatchObject({
      key: slots[0].key,
      summary: 'Told usage.',
      providerId: 'anthropic',
      modelId: 'claude-opus-5',
      promptVersion: SUMMARY_PROMPT_VERSION,
      usage: { promptTokens: 100, completionTokens: 20 },
    });

    // A provider that reported nothing leaves the field ABSENT, never zeroed.
    const quiet = memoryStore();
    await runSummaries({
      slots,
      ctx: CTX,
      run: runnerFor(createFakeLlm({ outcome: 'text', text: 'Silent usage.' })),
      store: quiet,
      onState: () => {},
      isCancelled: () => false,
    });
    expect(quiet.entries.get(slots[0].key)?.usage).toBeUndefined();
    expect('usage' in (quiet.entries.get(slots[0].key) as object)).toBe(false);
  });

  test('U611: no store, or a store that throws, still summarizes', async () => {
    const slots = slotsFor(2);
    for (const store of [
      undefined,
      {
        get: () => Promise.reject(new Error('disk gone')),
        put: () => Promise.reject(new Error('disk gone')),
        size: () => Promise.resolve({ bytes: 0, entries: 0 }),
        clear: () => Promise.resolve(),
      } as SummaryCacheStore,
    ]) {
      const fake = createFakeLlm();
      const sink = collector();
      await runSummaries({
        slots,
        ctx: CTX,
        run: runnerFor(fake),
        store,
        onState: sink.onState,
        isCancelled: () => false,
      });
      expect(fake.calls).toHaveLength(slots.length);
      expect(sink.states.get(slots[0].key)).toEqual({ status: 'summary', text: 'A fake summary.' });
    }
  });

  test('U612: a session memo answers repeat keys, and never for a key the store missed', async () => {
    const fake = createFakeLlm();
    const memo = new Map<string, string>();
    const slots = slotsFor();
    const args = { slots, ctx: CTX, run: runnerFor(fake), memo, onState: () => {}, isCancelled: () => false };
    await runSummaries(args);
    expect(fake.calls).toHaveLength(5);
    // Re-entering the level: the memo holds the same keys, so nothing is re-asked.
    await runSummaries(args);
    expect(fake.calls).toHaveLength(5);
    // A key nothing has answered is still a miss: the memo only ever holds keys
    // a store hit or this session produced.
    expect(memo.has('mmz1:p1:anthropic:claude-opus-5:l4:0000000000000000')).toBe(false);
  });
});

describe('PRD 011 Req 26 — pending, bounded, in order, and cancellable', () => {
  test('U613: requests leave in document order, at most SUMMARY_MAX_IN_FLIGHT at a time', async () => {
    const { run, inFlight } = deferredRunner();
    const slots = slotsFor();
    const sink = collector();
    const done = runSummaries({ slots, ctx: CTX, run, onState: sink.onState, isCancelled: () => false });
    await settle();
    // Every block announced itself as pending immediately — the view shows the
    // level's structure without waiting for a single reply.
    expect([...sink.states.values()].every((s) => s.status === 'pending')).toBe(true);
    expect(sink.states.size).toBe(5);
    // …and exactly three requests are outstanding, for the first three blocks.
    expect(inFlight).toHaveLength(3);
    expect(inFlight[0].request.prompt).toContain('Field Notes');
    expect(inFlight[2].request.prompt).toContain('Viewing');

    // A block fills the moment ITS reply lands; a slow sibling holds up nothing.
    inFlight[1].reply('Editing, summarized.');
    await settle();
    expect(sink.states.get(slots[1].key)).toEqual({ status: 'summary', text: 'Editing, summarized.' });
    expect(sink.states.get(slots[0].key)).toEqual({ status: 'pending' });
    expect(inFlight).toHaveLength(4);

    for (const pending of inFlight) pending.reply('Done.');
    await settle();
    for (const pending of inFlight) pending.reply('Done.');
    await done;
    expect(inFlight).toHaveLength(5);
  });

  test('U614: a cancelled run issues no further request and renders no result, but keeps what it paid for', async () => {
    const { run, inFlight } = deferredRunner();
    const store = memoryStore();
    const slots = slotsFor();
    const sink = collector();
    let cancelled = false;
    const done = runSummaries({
      slots,
      ctx: CTX,
      run,
      store,
      onState: sink.onState,
      isCancelled: () => cancelled,
    });
    await settle();
    expect(inFlight).toHaveLength(3);

    // "request issued → the buffer is edited → the result resolves": the run
    // identity moved on, so the answer reaches no view state at all.
    cancelled = true;
    sink.states.clear();
    sink.order.length = 0;
    for (const pending of inFlight) pending.reply('Too late.');
    await done;
    expect(sink.states.size).toBe(0);
    expect(sink.order).toEqual([]);
    // No further request was issued for the abandoned run.
    expect(inFlight).toHaveLength(3);
    // The summaries that were paid for ARE cached: the key is content-addressed,
    // so they are correct for the content they summarized (PRD 011 Req 26).
    expect(store.entries.size).toBe(3);
    expect(store.entries.get(slots[0].key)?.summary).toBe('Too late.');
  });

  test('U615: re-entering after cancellation re-plans from the cache and asks only for what is missing', async () => {
    const { run, inFlight } = deferredRunner();
    const store = memoryStore();
    const slots = slotsFor();
    let cancelled = false;
    const first = runSummaries({
      slots,
      ctx: CTX,
      run,
      store,
      onState: () => {},
      isCancelled: () => cancelled,
    });
    await settle();
    cancelled = true;
    for (const pending of inFlight) pending.reply('Stored anyway.');
    await first;

    const fake = createFakeLlm();
    const sink = collector();
    await runSummaries({
      slots,
      ctx: CTX,
      run: runnerFor(fake),
      store,
      onState: sink.onState,
      isCancelled: () => false,
    });
    // The three that completed are hits; only the two that never ran are asked.
    expect(fake.calls).toHaveLength(2);
    expect(sink.states.get(slots[0].key)).toEqual({ status: 'summary', text: 'Stored anyway.' });
  });
});

describe('PRD 011 Req 27 — per-section failure and retry', () => {
  test('U616: a failed section carries the seam’s failure and retries alone, leaving siblings summarized', async () => {
    const fake = createFakeLlm();
    // The second request fails; everything else succeeds.
    fake.queue(
      { outcome: 'text', text: 'One.' },
      { outcome: 'failure', kind: 'rate-limited', retryAfterSeconds: 9 },
      { outcome: 'text', text: 'Three.' }
    );
    const slots = slotsFor(3);
    const store = memoryStore();
    const sink = collector();
    const args = {
      ctx: CTX,
      run: runnerFor(fake),
      store,
      onState: sink.onState,
      isCancelled: () => false,
    };
    await runSummaries({ ...args, slots });
    const failedKey = [...sink.states.entries()].find(([, s]) => s.status === 'failed')?.[0];
    expect(failedKey).toBeTruthy();
    const failed = sink.states.get(failedKey!);
    expect(failed).toMatchObject({ status: 'failed' });
    if (failed?.status === 'failed') {
      // The seam's own taxonomy and its own retry hint — not a second sentence.
      expect(failed.failure.kind).toBe('rate-limited');
      expect(failed.failure.retryAfterSeconds).toBe(9);
    }
    const summarized = [...sink.states.values()].filter((s) => s.status === 'summary');
    expect(summarized.length).toBe(slots.length - 1);

    // The retry re-requests exactly that section: one more call, one more state.
    const before = fake.calls.length;
    fake.respondWith({ outcome: 'text', text: 'Second, at last.' });
    await runSummaries({ ...args, slots: retrySlots(slots, failedKey!) });
    expect(fake.calls).toHaveLength(before + 1);
    expect(sink.states.get(failedKey!)).toEqual({ status: 'summary', text: 'Second, at last.' });
    // No sibling reverted to pending, and none was re-requested.
    expect([...sink.states.values()].filter((s) => s.status === 'summary')).toHaveLength(slots.length);
  });

  test('U617: a retry that fails again stays retryable, and a failure is never cached', async () => {
    const fake = createFakeLlm({ outcome: 'failure', kind: 'bad-key' });
    const store = memoryStore();
    const slots = slotsFor(2);
    const sink = collector();
    const args = { ctx: CTX, run: runnerFor(fake), store, onState: sink.onState, isCancelled: () => false };
    await runSummaries({ ...args, slots });
    expect(sink.states.get(slots[0].key)).toMatchObject({ status: 'failed' });
    await runSummaries({ ...args, slots: retrySlots(slots, slots[0].key) });
    // Still failed, still exactly one call per attempt, and nothing was stored —
    // a failure must never become a cache hit that can never be retried.
    expect(sink.states.get(slots[0].key)).toMatchObject({ status: 'failed' });
    expect(fake.calls).toHaveLength(2);
    expect(store.entries.size).toBe(0);
  });
});
