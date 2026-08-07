import { describe, expect, it } from 'vitest';
import {
  createFakeLlm,
  DEFAULT_FAKE_OUTCOME,
  FAKE_UNREACHABLE_DETAIL,
  type FakeLlmOutcome,
} from '../../src/lib/llmFake';
import {
  ANTHROPIC_ENDPOINT,
  BAD_KEY_MESSAGE,
  GEMINI_BASE,
  OPENAI_ENDPOINT,
  OPENROUTER_ENDPOINT,
} from '../../src/lib/llmProviders';
import {
  runLlmRequest,
  UNREACHABLE_MESSAGE,
  type LlmProviderConfig,
  type LlmProviderKind,
  type LlmRequest,
} from '../../src/lib/llmSeam';

// PRD 011 Req 35: the local fake — the harness every LLM test drives, here
// driven against itself. It replaces only the sending, so the real provider
// adapters do the real parsing; no provider host is contacted, and the host
// strings below are inert data compared against a built descriptor.

const DUMMY_KEY = 'dummy-key';

/** One config per kind; `Object.values` iterates them in this order. */
const configs: Record<LlmProviderKind, LlmProviderConfig> = {
  openai: { kind: 'openai', apiKey: DUMMY_KEY, model: 'gpt-5' },
  anthropic: { kind: 'anthropic', apiKey: DUMMY_KEY, model: 'claude-opus-5' },
  gemini: { kind: 'gemini', apiKey: DUMMY_KEY, model: 'gemini-2.5-flash' },
  openrouter: { kind: 'openrouter', apiKey: DUMMY_KEY, model: 'meta-llama/llama-4' },
  custom: {
    kind: 'custom',
    apiKey: DUMMY_KEY,
    model: 'local-model',
    baseUrl: 'https://box.local/v1/',
  },
};

const ask = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  trigger: 'summarize',
  system: 'Summarize in two sentences.',
  prompt: 'The document body.',
  maxOutputTokens: 256,
  ...over,
});

describe('PRD 011 Req 35 — the local fake answers the seam', () => {
  it('U509: a canned success comes back as text plus the usage it was scripted with', async () => {
    const fake = createFakeLlm();
    fake.respondWith({
      outcome: 'text',
      text: 'Two sentences, as asked.',
      usage: { inputTokens: 33, outputTokens: 8 },
    });
    for (const config of Object.values(configs)) {
      await expect(fake.run(config, ask())).resolves.toEqual({
        ok: true,
        text: 'Two sentences, as asked.',
        usage: { known: true, inputTokens: 33, outputTokens: 8 },
      });
    }
  });

  it('U510: a canned success with no usage comes back as absent usage, for every provider kind', async () => {
    const fake = createFakeLlm({ outcome: 'text', text: 'No counts here.' });
    for (const config of Object.values(configs)) {
      await expect(fake.run(config, ask())).resolves.toEqual({
        ok: true,
        text: 'No counts here.',
        usage: { known: false },
      });
    }
  });

  it('U511: every failure kind can be scripted, and classifies the same for every provider', async () => {
    const kinds = ['bad-key', 'unknown-model', 'rate-limited', 'unreachable-host', 'unexpected'] as const;
    const fake = createFakeLlm();
    for (const kind of kinds) {
      for (const config of Object.values(configs)) {
        fake.respondWith({ outcome: 'failure', kind });
        const response = await fake.run(config, ask());
        expect(response.ok).toBe(false);
        if (response.ok) continue;
        expect(response.failure.kind).toBe(kind);
        expect(response.failure.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('U512: a scripted bad key reads as the seam’s bad-key failure with the provider’s words', async () => {
    const fake = createFakeLlm();
    fake.respondWith({ outcome: 'failure', kind: 'bad-key', providerMessage: 'Incorrect API key provided.' });
    await expect(fake.run(configs.openai, ask())).resolves.toEqual({
      ok: false,
      failure: {
        kind: 'bad-key',
        message: BAD_KEY_MESSAGE,
        status: 401,
        providerMessage: 'Incorrect API key provided.',
      },
    });
  });

  it('U513: a scripted unreachable host never produced an HTTP status, and carries the transport’s reason', async () => {
    const fake = createFakeLlm();
    fake.respondWith({ outcome: 'failure', kind: 'unreachable-host' });
    await expect(fake.run(configs.anthropic, ask())).resolves.toEqual({
      ok: false,
      failure: {
        kind: 'unreachable-host',
        message: UNREACHABLE_MESSAGE,
        providerMessage: FAKE_UNREACHABLE_DETAIL,
      },
    });
  });

  it('U514: a scripted rate limit carries the retry hint through each provider’s own wire form', async () => {
    const fake = createFakeLlm();
    fake.respondWith({ outcome: 'failure', kind: 'rate-limited', retryAfterSeconds: 12 });
    for (const config of [configs.openai, configs.anthropic, configs.gemini, configs.custom]) {
      const response = await fake.run(config, ask());
      expect(response.ok).toBe(false);
      if (response.ok) continue;
      expect(response.failure.kind).toBe('rate-limited');
      expect(response.failure.retryAfterSeconds).toBe(12);
    }
  });
});

describe('PRD 011 Req 35 — the fake records what was asked', () => {
  it('U515: a test can assert how many calls were made, and with which kind, model, prompt and trigger', async () => {
    const fake = createFakeLlm();
    await fake.run(configs.gemini, ask({ trigger: 'test-connection', prompt: 'ping' }));
    await fake.run(configs.anthropic, ask({ prompt: 'The other document.' }));
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]).toMatchObject({
      providerKind: 'gemini',
      model: 'gemini-2.5-flash',
      prompt: 'ping',
      system: 'Summarize in two sentences.',
      trigger: 'test-connection',
    });
    expect(fake.calls[1]).toMatchObject({
      providerKind: 'anthropic',
      model: 'claude-opus-5',
      prompt: 'The other document.',
      trigger: 'summarize',
    });
  });

  it('U516: the recorded provider kind and URL match the descriptor the real adapter built', async () => {
    const fake = createFakeLlm();
    for (const config of Object.values(configs)) await fake.run(config, ask());
    expect(fake.calls.map((call) => [call.providerKind, call.url])).toEqual([
      ['openai', OPENAI_ENDPOINT],
      ['anthropic', ANTHROPIC_ENDPOINT],
      ['gemini', `${GEMINI_BASE}/gemini-2.5-flash:generateContent`],
      ['openrouter', OPENROUTER_ENDPOINT],
      ['custom', 'https://box.local/v1/chat/completions'],
    ]);
  });

  it('U517: the fake is also a plain transport — the seam’s own entry point takes it directly', async () => {
    const fake = createFakeLlm({ outcome: 'text', text: 'through the seam' });
    const response = await runLlmRequest(fake.transport, configs.openrouter, ask());
    expect(response).toMatchObject({ ok: true, text: 'through the seam' });
    // No `run` to see the request, so there is no trigger to record — and the
    // provider kind still comes off the descriptor, not off remembered state.
    expect(fake.calls[0].trigger).toBeUndefined();
    expect(fake.calls[0].providerKind).toBe('openrouter');
  });

  it('U518: a fake makes no call until something asks it to, and reset clears what it saw', async () => {
    const fake = createFakeLlm();
    expect(fake.calls).toEqual([]);
    await fake.run(configs.openai, ask());
    expect(fake.calls).toHaveLength(1);
    fake.reset();
    expect(fake.calls).toEqual([]);
    // Reset restores the outcome the fake was created with.
    await expect(fake.run(configs.openai, ask())).resolves.toMatchObject({
      ok: true,
      text: DEFAULT_FAKE_OUTCOME.text,
    });
  });
});

describe('PRD 011 Req 35 — scriptable in sequence, and deterministic', () => {
  it('U519: queued outcomes are consumed in order, then the default resumes', async () => {
    const scripted: FakeLlmOutcome[] = [
      { outcome: 'failure', kind: 'rate-limited' },
      { outcome: 'text', text: 'second try' },
    ];
    const fake = createFakeLlm({ outcome: 'text', text: 'the default' });
    fake.queue(...scripted);
    const first = await fake.run(configs.openai, ask());
    const second = await fake.run(configs.openai, ask());
    const third = await fake.run(configs.openai, ask());
    expect(first).toMatchObject({ ok: false, failure: { kind: 'rate-limited' } });
    expect(second).toMatchObject({ ok: true, text: 'second try' });
    expect(third).toMatchObject({ ok: true, text: 'the default' });
    expect(fake.calls).toHaveLength(3);
  });

  it('U520: two identically scripted fakes answer identically — no clock, no randomness', async () => {
    const script = (): FakeLlmOutcome[] => [
      { outcome: 'text', text: 'one', usage: { inputTokens: 5, outputTokens: 1 } },
      { outcome: 'failure', kind: 'unknown-model' },
    ];
    const runAll = async () => {
      const fake = createFakeLlm();
      fake.queue(...script());
      return [await fake.run(configs.custom, ask()), await fake.run(configs.custom, ask())];
    };
    expect(await runAll()).toEqual(await runAll());
  });

  it('U521: concurrent runs each keep their own trigger', async () => {
    const fake = createFakeLlm();
    await Promise.all([
      fake.run(configs.openai, ask({ trigger: 'summarize', prompt: 'a' })),
      fake.run(configs.anthropic, ask({ trigger: 'test-connection', prompt: 'b' })),
    ]);
    expect(fake.calls.map((call) => [call.prompt, call.trigger])).toEqual([
      ['a', 'summarize'],
      ['b', 'test-connection'],
    ]);
  });
});
