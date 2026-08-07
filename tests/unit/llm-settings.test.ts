import { describe, expect, test } from 'vitest';
import {
  canTestConnection,
  hostedReadyMessage,
  llmAreaState,
  LLM_PROVIDER_KINDS,
  LLM_PROVIDERS,
  NO_KEY_MESSAGE,
  NO_LLM_PLATFORM_MESSAGE,
  NO_MODEL_MESSAGE,
  isLlmProviderKind,
  resolveLlmProvider,
  TEST_CONNECTION_REQUEST,
  testConnection,
  testFailureMessage,
  type LlmCapabilities,
  type LlmSettingsValues,
} from '../../src/lib/llmSettings';
import { INVALID_BASE_URL_MESSAGE } from '../../src/lib/llmProviders';
import { NO_LLM_CONFIGURED_MESSAGE } from '../../src/lib/llmDeployment';
import { createFakeLlm } from '../../src/lib/llmFake';
import { runLlmRequest, type LlmResponse } from '../../src/lib/llmSeam';

/** A configured desktop user, as the four persisted values. */
const configured: LlmSettingsValues = {
  llmProvider: 'anthropic',
  llmModel: 'claude-opus-5',
  llmApiKey: 'sk-secret',
  llmBaseUrl: '',
};
const desktop: LlmCapabilities = { transport: true, hosted: null };

describe('PRD 011 Req 5 provider inventory', () => {
  test('U556: the chooser offers exactly the seam five kinds, keyed exhaustively by the seam union', () => {
    expect([...LLM_PROVIDER_KINDS].sort()).toEqual(
      ['anthropic', 'custom', 'gemini', 'openai', 'openrouter'].sort()
    );
    // Every kind carries a label, and no kind is a stub.
    for (const kind of LLM_PROVIDER_KINDS) expect(LLM_PROVIDERS[kind].label).toBeTruthy();
    expect(isLlmProviderKind('anthropic')).toBe(true);
    expect(isLlmProviderKind('perplexity')).toBe(false);
    expect(isLlmProviderKind(7)).toBe(false);
  });

  test('U557: each hosted provider offers a SHORT curated model list; custom curates none', () => {
    for (const kind of LLM_PROVIDER_KINDS) {
      const { models } = LLM_PROVIDERS[kind];
      if (kind === 'custom') {
        // The endpoint is the user's, so there is no catalogue to curate.
        expect(models).toEqual([]);
        continue;
      }
      // A handful of known-good ids, not an exhaustive catalogue.
      expect(models.length).toBeGreaterThan(0);
      expect(models.length).toBeLessThanOrEqual(6);
      expect(new Set(models).size).toBe(models.length);
      for (const m of models) expect(m.trim()).toBe(m);
    }
    // The Anthropic ids are the current ones, taken from the claude-api skill.
    expect(LLM_PROVIDERS.anthropic.models).toContain('claude-opus-5');
  });
});

describe('PRD 011 Req 5 one active provider', () => {
  test('U558: the settings resolve through one pure function to a SINGLE config, never a set', () => {
    const config = resolveLlmProvider(configured);
    expect(config).toEqual({ kind: 'anthropic', apiKey: 'sk-secret', model: 'claude-opus-5' });
    // A discriminated union value, not a collection of enabled providers.
    expect(Array.isArray(config)).toBe(false);
    expect(Object.keys(config).sort()).toEqual(['apiKey', 'kind', 'model']);
  });

  test('U559: the custom kind additionally carries the base URL; other kinds carry none', () => {
    const custom = resolveLlmProvider({
      llmProvider: 'custom',
      llmModel: '  local-model  ',
      llmApiKey: 'k',
      llmBaseUrl: ' https://llm.example.com/v1 ',
    });
    expect(custom).toEqual({
      kind: 'custom',
      apiKey: 'k',
      model: 'local-model',
      baseUrl: 'https://llm.example.com/v1',
    });
    expect('baseUrl' in resolveLlmProvider(configured)).toBe(false);
  });

  test('U560: a free-text model id the curated list does not have resolves unchanged', () => {
    // PRD 011 Req 6: a new model must never require an app release.
    const exotic = resolveLlmProvider({ ...configured, llmModel: 'claude-nonesuch-99' });
    expect(exotic.model).toBe('claude-nonesuch-99');
    expect(LLM_PROVIDERS.anthropic.models).not.toContain('claude-nonesuch-99');
  });
});

describe('PRD 011 Req 9 LLM availability', () => {
  test('U561: neither capability — LLM features are unavailable on this platform, with no config read', () => {
    const state = llmAreaState({ transport: false, hosted: null }, configured);
    expect(state).toEqual({ state: 'no-path', message: NO_LLM_PLATFORM_MESSAGE });
    expect(canTestConnection(state)).toBe(false);
  });

  test('U562: desktop with nothing configured names the missing piece, in order', () => {
    const noKey = llmAreaState(desktop, { ...configured, llmApiKey: '' });
    expect(noKey).toEqual({ state: 'unconfigured', missing: 'key', message: NO_KEY_MESSAGE });

    // Whitespace is not a model (PRD 011 Req 5) — it reports unavailable
    // rather than sending a request that cannot work.
    for (const blank of ['', '   ', '\t\n']) {
      const noModel = llmAreaState(desktop, { ...configured, llmModel: blank });
      expect(noModel).toEqual({ state: 'unconfigured', missing: 'model', message: NO_MODEL_MESSAGE });
      expect(canTestConnection(noModel)).toBe(false);
    }
  });

  test('U563: an unusable custom base URL reuses the seam INVALID_BASE_URL_MESSAGE', () => {
    const bad = llmAreaState(desktop, {
      llmProvider: 'custom',
      llmModel: 'local-model',
      llmApiKey: 'k',
      llmBaseUrl: 'not a url',
    });
    // Not a second hand-written URL validator, and not a second sentence.
    expect(bad).toEqual({ state: 'unconfigured', missing: 'base-url', message: INVALID_BASE_URL_MESSAGE });
  });

  test('U564: hosted with configured:false reuses NO_LLM_CONFIGURED_MESSAGE', () => {
    const state = llmAreaState({ transport: false, hosted: { configured: false } }, configured);
    expect(state).toEqual({ state: 'operator-unconfigured', message: NO_LLM_CONFIGURED_MESSAGE });
    expect(canTestConnection(state)).toBe(false);
  });

  test('U565: hosted with configured:true reports the operator provider and model, read-only', () => {
    const state = llmAreaState(
      { transport: false, hosted: { configured: true, provider: 'openai', model: 'gpt-5' } },
      // The reader's own settings are irrelevant on hosted: the credential is
      // the operator's, so what they typed never becomes the active config.
      { ...configured, llmApiKey: '', llmModel: '' }
    );
    expect(state).toEqual({
      state: 'hosted',
      provider: 'openai',
      model: 'gpt-5',
      message: hostedReadyMessage('openai', 'gpt-5'),
    });
    expect(state.message).toContain('gpt-5');
    expect(canTestConnection(state)).toBe(true);
  });

  test('U566: desktop, fully configured — available, carrying the one active config', () => {
    const state = llmAreaState(desktop, configured);
    expect(state.state).toBe('ready');
    if (state.state !== 'ready') throw new Error('unreachable');
    expect(state.config).toEqual({ kind: 'anthropic', apiKey: 'sk-secret', model: 'claude-opus-5' });
    expect(canTestConnection(state)).toBe(true);
  });

  test('U567: availability never leaks the key into the sentence it renders', () => {
    for (const values of [configured, { ...configured, llmModel: '' }, { ...configured, llmApiKey: '' }]) {
      for (const caps of [desktop, { transport: false, hosted: null }] as LlmCapabilities[]) {
        expect(llmAreaState(caps, values).message).not.toContain('sk-secret');
      }
    }
  });
});

describe('PRD 011 Req 10 test connection', () => {
  test('U568: the request is attributable, minimal and cheap', () => {
    expect(TEST_CONNECTION_REQUEST.trigger).toBe('test-connection');
    expect(TEST_CONNECTION_REQUEST.prompt).toBeTruthy();
    expect(TEST_CONNECTION_REQUEST.maxOutputTokens).toBeLessThanOrEqual(32);
  });

  test('U569: nothing is sent until the action fires, and one action is exactly one call', async () => {
    // PRD 011 Req 35: the fake, so no real provider is contacted.
    const fake = createFakeLlm();
    const run = (request: typeof TEST_CONNECTION_REQUEST): Promise<LlmResponse> =>
      runLlmRequest(fake.transport, resolveLlmProvider(configured), request);

    // Req 16: importing, resolving and computing availability send nothing.
    llmAreaState(desktop, configured);
    resolveLlmProvider(configured);
    expect(fake.calls).toHaveLength(0);

    const result = await testConnection(run);
    expect(result).toEqual({ ok: true });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].providerKind).toBe('anthropic');
    expect(fake.calls[0].model).toBe('claude-opus-5');
    expect(fake.calls[0].trigger).toBeUndefined(); // driven through the seam directly

    await testConnection(run);
    expect(fake.calls).toHaveLength(2); // one per action, never more
  });

  test('U570: the trigger reaching the seam is test-connection, not a summarize request', async () => {
    const fake = createFakeLlm();
    await testConnection((request) => fake.run(resolveLlmProvider(configured), request));
    expect(fake.calls.map((c) => c.trigger)).toEqual(['test-connection']);
  });

  test('U571: each specific failure kind is reported as the seam own typed failure', async () => {
    const fake = createFakeLlm();
    for (const kind of ['bad-key', 'unknown-model', 'unreachable-host', 'rate-limited', 'unexpected'] as const) {
      fake.respondWith({ outcome: 'failure', kind });
      const result = await testConnection((request) =>
        runLlmRequest(fake.transport, resolveLlmProvider(configured), request)
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.failure.kind).toBe(kind);
      expect(result.failure.message).toBeTruthy();
      // PRD 011 Req 7: nothing that reaches a reader carries key material.
      expect(JSON.stringify(result)).not.toContain('sk-secret');
    }
  });

  test('U572: a rate-limit retry hint rides in the rendered sentence, not a new one per call site', async () => {
    const fake = createFakeLlm();
    fake.respondWith({ outcome: 'failure', kind: 'rate-limited', retryAfterSeconds: 30 });
    const result = await testConnection((request) =>
      runLlmRequest(fake.transport, resolveLlmProvider(configured), request)
    );
    if (result.ok) throw new Error('expected a failure');
    expect(result.failure.retryAfterSeconds).toBe(30);
    expect(testFailureMessage(result.failure)).toBe(`${result.failure.message} (retry in 30s)`);
    // Without a hint the sentence is the seam's own, unchanged.
    expect(testFailureMessage({ kind: 'bad-key', message: 'nope' })).toBe('nope');
  });

  test('U573: the result never carries the generated text across a window boundary', async () => {
    const fake = createFakeLlm();
    fake.respondWith({ outcome: 'text', text: 'a very chatty reply' });
    const result = await testConnection((request) =>
      runLlmRequest(fake.transport, resolveLlmProvider(configured), request)
    );
    expect(result).toEqual({ ok: true });
    expect(JSON.stringify(result)).not.toContain('chatty');
  });
});
