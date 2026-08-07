import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFakeLlm } from '../../src/lib/llmFake';
import { GEMINI_BASE, INVALID_BASE_URL_MESSAGE } from '../../src/lib/llmProviders';
import {
  redactKey,
  runLlmRequest,
  UNREACHABLE_MESSAGE,
  USAGE_UNKNOWN,
  type LlmHttpRequest,
  type LlmProviderConfig,
  type LlmProviderKind,
  type LlmRequest,
  type LlmTransport,
  type LlmTransportResult,
} from '../../src/lib/llmSeam';

// PRD 011 Reqs 11+16: the seam itself — one entry point taking an injected
// transport, one response type, no work on import, and no request that does not
// name the user action behind it. Every call here goes through the local fake
// or a hand-written transport; nothing reaches a real provider.

const KEY = 'sk-SENTINEL-do-not-leak-0123456789';

/** One config per kind. The insertion order is what `EVERY_CONFIG` iterates in. */
const CONFIGS: Record<LlmProviderKind, LlmProviderConfig> = {
  openai: { kind: 'openai', apiKey: KEY, model: 'gpt-5' },
  anthropic: { kind: 'anthropic', apiKey: KEY, model: 'claude-opus-5' },
  gemini: { kind: 'gemini', apiKey: KEY, model: 'gemini-2.5-flash' },
  openrouter: { kind: 'openrouter', apiKey: KEY, model: 'meta-llama/llama-4' },
  custom: { kind: 'custom', apiKey: KEY, model: 'local-model', baseUrl: 'https://box.local/v1' },
};

const EVERY_CONFIG = Object.values(CONFIGS);

const ask = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  trigger: 'summarize',
  system: 'Summarize in two sentences.',
  prompt: 'The document body.',
  maxOutputTokens: 256,
  ...over,
});

/** A transport that answers one canned result and counts what it was handed. */
function stubTransport(result: LlmTransportResult | (() => Promise<LlmTransportResult>)) {
  const sent: LlmHttpRequest[] = [];
  const transport: LlmTransport = (request) => {
    sent.push(request);
    return typeof result === 'function' ? result() : Promise.resolve(result);
  };
  return { transport, sent };
}

describe('PRD 011 Req 16 — the seam does nothing until a user action asks it to', () => {
  it('U480: importing the seam with a fake transport installed makes zero calls to it', async () => {
    const fake = createFakeLlm();
    // The imports at the top of this file have already run; a module that
    // registered a timer, a listener or a startup request would show here.
    const fresh = await import('../../src/lib/llmSeam');
    expect(fake.calls).toEqual([]);
    expect(typeof fresh.runLlmRequest).toBe('function');
  });

  it('U481: a request cannot be constructed without naming the user action that caused it', () => {
    // @ts-expect-error PRD 011 Req 16: `trigger` is required and has no default.
    const unattributable: LlmRequest = { prompt: 'x', maxOutputTokens: 8 };
    expect(unattributable).toBeTruthy();
    const attributed: LlmRequest = { trigger: 'test-connection', prompt: 'x', maxOutputTokens: 8 };
    expect(attributed.trigger).toBe('test-connection');
  });
});

describe('PRD 011 Req 11 — one entry point, one response shape', () => {
  it('U482: the entry point sends what the active provider built and answers its success', async () => {
    const fake = createFakeLlm({
      outcome: 'text',
      text: 'A two-sentence summary.',
      usage: { inputTokens: 40, outputTokens: 9 },
    });
    const response = await runLlmRequest(fake.transport, CONFIGS.openai, ask());
    expect(response).toEqual({
      ok: true,
      text: 'A two-sentence summary.',
      usage: { known: true, inputTokens: 40, outputTokens: 9 },
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].providerKind).toBe('openai');
  });

  it('U483: every provider kind answers the same response shape through the one entry point', async () => {
    const fake = createFakeLlm({ outcome: 'text', text: 'same shape' });
    for (const config of EVERY_CONFIG) {
      const response = await runLlmRequest(fake.transport, config, ask());
      expect(response.ok).toBe(true);
      if (!response.ok) continue;
      expect(response.text).toBe('same shape');
      // PRD 011 Req 32: no usage from the provider is said, not guessed at zero.
      expect(response.usage).toEqual(USAGE_UNKNOWN);
      expect(response.usage.known).toBe(false);
    }
    expect(fake.calls.map((call) => call.providerKind)).toEqual([
      'openai',
      'anthropic',
      'gemini',
      'openrouter',
      'custom',
    ]);
  });
});

describe('PRD 011 Req 10 — transport-level failure is an unreachable host', () => {
  it('U484: a transport reporting no HTTP response is an unreachable host, not a status', async () => {
    const { transport } = stubTransport({ kind: 'no-response', detail: 'getaddrinfo ENOTFOUND' });
    const response = await runLlmRequest(transport, CONFIGS.anthropic, ask());
    expect(response).toEqual({
      ok: false,
      failure: {
        kind: 'unreachable-host',
        message: UNREACHABLE_MESSAGE,
        providerMessage: 'getaddrinfo ENOTFOUND',
      },
    });
  });

  it('U485: a transport that rejects is an unreachable host too, and never throws out of the seam', async () => {
    const { transport } = stubTransport(() => Promise.reject(new Error('connect ECONNREFUSED')));
    const response = await runLlmRequest(transport, CONFIGS.openrouter, ask());
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.failure.kind).toBe('unreachable-host');
    expect(response.failure.providerMessage).toBe('connect ECONNREFUSED');
    expect(response.failure.status).toBeUndefined();
  });

  it('U486: a configuration that cannot produce a request never reaches the transport', async () => {
    const { transport, sent } = stubTransport({ kind: 'http', response: { status: 200, body: '{}' } });
    const response = await runLlmRequest(
      transport,
      { kind: 'custom', apiKey: KEY, model: 'm', baseUrl: 'not-a-url' },
      ask(),
    );
    expect(response).toEqual({
      ok: false,
      failure: { kind: 'invalid-config', message: INVALID_BASE_URL_MESSAGE },
    });
    expect(sent).toEqual([]);
  });
});

describe('PRD 011 Req 7 — the key never leaves the request headers', () => {
  it('U487: redactKey removes the key from any text the seam is about to hand back', () => {
    expect(redactKey(`bad key: ${KEY}`, KEY)).toBe('bad key: [redacted]');
    expect(redactKey('nothing to hide', KEY)).toBe('nothing to hide');
    expect(redactKey('empty key is a no-op', '')).toBe('empty key is a no-op');
  });

  it('U488: no failure path of any provider leaks the key into a message or a serialized failure', async () => {
    const fake = createFakeLlm();
    const kinds = ['bad-key', 'unknown-model', 'rate-limited', 'unreachable-host', 'unexpected'] as const;
    for (const config of EVERY_CONFIG) {
      for (const kind of kinds) {
        // The provider quotes the key straight back at us, as a careless one might.
        fake.respondWith({ outcome: 'failure', kind, providerMessage: `key ${KEY} refused` });
        const response = await runLlmRequest(fake.transport, config, ask());
        expect(response.ok).toBe(false);
        if (response.ok) continue;
        expect(JSON.stringify(response.failure)).not.toContain(KEY);
        expect(response.failure.message).not.toContain(KEY);
        expect(response.failure.providerMessage ?? '').not.toContain(KEY);
      }
    }
    // And the same for a malformed request that never left: its message is ours.
    const invalid = await runLlmRequest(
      fake.transport,
      { kind: 'custom', apiKey: KEY, model: 'm', baseUrl: 'https://[bad' },
      ask(),
    );
    expect(JSON.stringify(invalid)).not.toContain(KEY);
  });

  it('U489: no built URL carries the key, for any provider kind', async () => {
    const fake = createFakeLlm();
    for (const config of EVERY_CONFIG) await runLlmRequest(fake.transport, config, ask());
    for (const call of fake.calls) {
      expect(call.url).not.toContain(KEY);
      expect(call.url).toMatch(/^https:\/\//);
      expect(call.request.body).not.toContain(KEY);
    }
    // The Gemini key in particular is a header, never the `?key=` query param.
    const geminiCall = fake.calls.find((call) => call.providerKind === 'gemini');
    expect(geminiCall?.url.startsWith(GEMINI_BASE)).toBe(true);
    expect(geminiCall?.url).not.toContain('key=');
    expect(geminiCall?.request.headers['x-goog-api-key']).toBe(KEY);
  });
});

// PRD 011 Reqs 11+12: the source-level guarantees — one definition of each
// shape, and no network call site anywhere in src/.
const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

/**
 * The file's code with its comments dropped, so a doc comment that *names* a
 * forbidden token (this module's own "no `fetch(`" promise) is not read as one.
 * Only whole-line and block comments go: a URL literal's `//` stays put.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

describe('PRD 011 Req 11 — one shape, and no transport in src/', () => {
  it('U490: exactly one module declares the LLM request and response types', () => {
    const declarations = sourceFiles(SRC).filter((file) => {
      const text = readFileSync(file, 'utf8');
      return /\b(interface|type)\s+Llm(Request|Response)\b/.test(text);
    });
    expect(declarations.map((file) => path.relative(SRC, file))).toEqual(['lib/llmSeam.ts']);
  });

  it('U491: the seam adds no network call site — its modules contain none', () => {
    const forbidden = /\bfetch\s*\(|XMLHttpRequest|new WebSocket|sendBeacon|new EventSource/;
    const offenders = sourceFiles(SRC)
      .filter((file) => /llm/i.test(path.basename(file)))
      .filter((file) => forbidden.test(codeOnly(readFileSync(file, 'utf8'))));
    expect(offenders).toEqual([]);
  });
});
