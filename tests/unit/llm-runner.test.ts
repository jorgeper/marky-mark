import { describe, expect, test } from 'vitest';
import { createFakeLlm } from '../../src/lib/llmFake';
import { selectLlmRunner, summaryKeyContextFor } from '../../src/lib/llmRunner';
import { TEST_CONNECTION_REQUEST, llmAreaState, type LlmSettingsValues } from '../../src/lib/llmSettings';
import type { LlmRequest, LlmResponse } from '../../src/lib/llmSeam';

const VALUES: LlmSettingsValues = {
  llmProvider: 'anthropic',
  llmModel: 'claude-opus-5',
  llmApiKey: 'sk-runner',
  llmBaseUrl: '',
};

const SUMMARY_REQUEST: LlmRequest = {
  trigger: 'summarize',
  system: 'system',
  prompt: 'prompt',
  maxOutputTokens: 96,
};

describe('PRD 011 Reqs 9+25 — the runner is chosen by capability, once', () => {
  test('U607: a desktop transport sends through the seam, a hosted client server-side, and nothing else sends', async () => {
    const fake = createFakeLlm();
    const desktop = llmAreaState({ transport: true, hosted: null }, VALUES);
    const runner = selectLlmRunner(desktop, { transport: fake.transport });
    expect(runner).not.toBeNull();
    const response = await runner!(SUMMARY_REQUEST);
    expect(response.ok).toBe(true);
    // The REAL seam and the REAL provider adapter ran: the fake saw the
    // configured provider, model and trigger (PRD 011 Req 35).
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].providerKind).toBe('anthropic');
    expect(fake.calls[0].model).toBe('claude-opus-5');
    expect(fake.calls[0].prompt).toBe('prompt');

    // Hosted: the client runs it, and the desktop transport is not consulted
    // even when the window happens to hold one.
    const seen: LlmRequest[] = [];
    const hosted = llmAreaState(
      { transport: true, hosted: { configured: true, provider: 'openai', model: 'gpt-5.1' } },
      VALUES
    );
    const hostedRunner = selectLlmRunner(hosted, {
      hosted: {
        run: (request): Promise<LlmResponse> => {
          seen.push(request);
          return Promise.resolve({ ok: true, text: 'server-side', usage: { known: false } });
        },
      },
      transport: fake.transport,
    });
    await expect(hostedRunner!(TEST_CONNECTION_REQUEST)).resolves.toEqual({
      ok: true,
      text: 'server-side',
      usage: { known: false },
    });
    expect(seen).toHaveLength(1);
    expect(fake.calls).toHaveLength(1);

    // No capability, or a capability with nothing configured behind it: no
    // runner at all — which is exactly where the excerpts stay (Req 22).
    expect(selectLlmRunner(desktop, {})).toBeNull();
    expect(selectLlmRunner(hosted, { transport: fake.transport })).toBeNull();
    expect(
      selectLlmRunner(llmAreaState({ transport: false, hosted: null }, VALUES), { transport: fake.transport })
    ).toBeNull();
    expect(
      selectLlmRunner(llmAreaState({ transport: true, hosted: null }, { ...VALUES, llmApiKey: '' }), {
        transport: fake.transport,
      })
    ).toBeNull();
  });

  test('U608: one function answers which provider and model a key is filed under', () => {
    const desktop = llmAreaState({ transport: true, hosted: null }, VALUES);
    expect(summaryKeyContextFor(desktop, 3)).toEqual({
      level: 3,
      providerId: 'anthropic',
      modelId: 'claude-opus-5',
    });
    // Hosted names the OPERATOR's provider and model, not the reader's settings.
    const hosted = llmAreaState(
      { transport: false, hosted: { configured: true, provider: 'gemini', model: 'gemini-2.5-pro' } },
      VALUES
    );
    expect(summaryKeyContextFor(hosted, 1)).toEqual({
      level: 1,
      providerId: 'gemini',
      modelId: 'gemini-2.5-pro',
    });
    // Nothing to send: no context, so nothing is keyed or requested.
    for (const area of [
      llmAreaState({ transport: false, hosted: null }, VALUES),
      llmAreaState({ transport: true, hosted: null }, { ...VALUES, llmModel: '  ' }),
      llmAreaState({ transport: false, hosted: { configured: false } }, VALUES),
    ]) {
      expect(summaryKeyContextFor(area, 4)).toBeNull();
    }
  });
});
