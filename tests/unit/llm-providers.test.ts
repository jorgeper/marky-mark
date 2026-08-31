import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_ENDPOINT,
  ANTHROPIC_VERSION,
  BAD_KEY_MESSAGE,
  customEndpoint,
  GEMINI_BASE,
  INVALID_BASE_URL_MESSAGE,
  MALFORMED_MESSAGE,
  OPENAI_ENDPOINT,
  OPENROUTER_ENDPOINT,
  providerFor,
  RATE_LIMITED_MESSAGE,
  UNKNOWN_MODEL_MESSAGE,
} from '../../src/lib/llmProviders';
import type {
  LlmHttpRequest,
  LlmHttpResponse,
  LlmProviderConfig,
  LlmProviderKind,
  LlmRequest,
} from '../../src/lib/llmSeam';

// PRD 011 Req 5: the five providers behind the one seam — the request each
// actually accepts, the usage each actually returns, and the errors each
// actually sends. Every payload below is real-shaped sample data, compared
// against a built descriptor; no host here is contacted.

const KEY = 'sk-SENTINEL-do-not-leak-0123456789';

const ASK: LlmRequest = {
  trigger: 'summarize',
  system: 'Summarize in two sentences.',
  prompt: 'The document body.',
  maxOutputTokens: 256,
};

const configs: Record<LlmProviderKind, LlmProviderConfig> = {
  openai: { kind: 'openai', apiKey: KEY, model: 'gpt-5' },
  anthropic: { kind: 'anthropic', apiKey: KEY, model: 'claude-opus-5' },
  gemini: { kind: 'gemini', apiKey: KEY, model: 'gemini-2.5-flash' },
  openrouter: { kind: 'openrouter', apiKey: KEY, model: 'meta-llama/llama-4' },
  custom: { kind: 'custom', apiKey: KEY, model: 'local-model', baseUrl: 'https://box.local/v1' },
};

const ALL_KINDS = Object.keys(configs) as LlmProviderKind[];

/** The descriptor a provider builds, with the build-failure case ruled out. */
function build(
  kind: LlmProviderKind,
  config: LlmProviderConfig = configs[kind],
  ask: LlmRequest = ASK,
): LlmHttpRequest {
  const built = providerFor(kind).buildRequest(config, ask);
  if ('kind' in built) throw new Error(`expected a request, got a ${built.kind} failure`);
  return built;
}

const body = (kind: LlmProviderKind, ask: LlmRequest = ASK): Record<string, unknown> =>
  JSON.parse(build(kind, configs[kind], ask).body) as Record<string, unknown>;

const reply = (kind: LlmProviderKind, response: LlmHttpResponse) =>
  providerFor(kind).readResponse(response);

const ok = (status: number, payload: unknown): LlmHttpResponse => ({
  status,
  body: JSON.stringify(payload),
});

describe('PRD 011 Req 5 — provider request descriptors', () => {
  it('U872: OpenAI sends a chat/completions body with the key as a bearer token', () => {
    const built = build('openai');
    expect(built.method).toBe('POST');
    expect(built.url).toBe(OPENAI_ENDPOINT);
    expect(built.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(built.headers['content-type']).toBe('application/json');
    expect(body('openai')).toEqual({
      model: 'gpt-5',
      messages: [
        { role: 'system', content: 'Summarize in two sentences.' },
        { role: 'user', content: 'The document body.' },
      ],
      max_completion_tokens: 256,
    });
  });

  it('U873: Anthropic sends a messages body with x-api-key and the required version header', () => {
    const built = build('anthropic');
    expect(built.url).toBe(ANTHROPIC_ENDPOINT);
    expect(built.headers['x-api-key']).toBe(KEY);
    expect(built.headers['anthropic-version']).toBe(ANTHROPIC_VERSION);
    expect(built.headers.authorization).toBeUndefined();
    expect(body('anthropic')).toEqual({
      model: 'claude-opus-5',
      max_tokens: 256,
      system: 'Summarize in two sentences.',
      messages: [{ role: 'user', content: 'The document body.' }],
    });
  });

  it('U874: Gemini calls generateContent for the model with the key in a header, never the URL', () => {
    const built = build('gemini');
    expect(built.url).toBe(`${GEMINI_BASE}/gemini-2.5-flash:generateContent`);
    expect(built.url).not.toContain('key');
    expect(built.headers['x-goog-api-key']).toBe(KEY);
    expect(body('gemini')).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'The document body.' }] }],
      generationConfig: { maxOutputTokens: 256 },
      systemInstruction: { parts: [{ text: 'Summarize in two sentences.' }] },
    });
  });

  it('U875: OpenRouter sends the OpenAI-compatible shape against its own base URL', () => {
    const built = build('openrouter');
    expect(built.url).toBe(OPENROUTER_ENDPOINT);
    expect(built.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(body('openrouter')).toMatchObject({ model: 'meta-llama/llama-4', max_tokens: 256 });
  });

  it('U876: the custom endpoint normalizes its base URL — trailing slash or not, same request', () => {
    const bare = build('custom');
    const slashed = build('custom', {
      ...configs.custom,
      kind: 'custom',
      baseUrl: 'https://box.local/v1/',
    });
    expect(bare.url).toBe('https://box.local/v1/chat/completions');
    expect(slashed.url).toBe(bare.url);
    expect(slashed.body).toBe(bare.body);
    expect(customEndpoint('http://127.0.0.1:11434/v1')).toBe(
      'http://127.0.0.1:11434/v1/chat/completions',
    );
    // A query or credential the user pasted is dropped rather than carried.
    expect(customEndpoint('https://box.local/v1?token=abc')).toBe(
      'https://box.local/v1/chat/completions',
    );
  });

  it('U877: a custom base URL that is not absolute http(s) is a configuration failure, not a request', () => {
    for (const bad of ['', '   ', '/v1', 'box.local/v1', 'ftp://box.local/v1', 'file:///etc']) {
      expect(customEndpoint(bad)).toEqual({
        kind: 'invalid-config',
        message: INVALID_BASE_URL_MESSAGE,
      });
    }
    const built = providerFor('custom').buildRequest(
      { kind: 'custom', apiKey: KEY, model: 'm', baseUrl: 'box.local' },
      ASK,
    );
    expect(built).toEqual({ kind: 'invalid-config', message: INVALID_BASE_URL_MESSAGE });
  });

  it('U878: no provider puts the key in a URL or a body — headers only', () => {
    for (const kind of ALL_KINDS) {
      const built = build(kind);
      expect(built.url).not.toContain(KEY);
      expect(built.body).not.toContain(KEY);
      expect(JSON.stringify(built.headers)).toContain(KEY);
    }
  });

  it('U879: a request with no system text omits it rather than sending an empty one', () => {
    const bare: LlmRequest = { trigger: 'test-connection', prompt: 'ping', maxOutputTokens: 8 };
    for (const kind of ALL_KINDS) {
      const sent = body(kind, bare);
      expect(sent.system).toBeUndefined();
      expect(sent.systemInstruction).toBeUndefined();
      expect(JSON.stringify(sent)).toContain('ping');
    }
  });
});

describe('PRD 011 Req 32 — provider-returned usage, and its stated absence', () => {
  const withUsage: Record<LlmProviderKind, unknown> = {
    openai: {
      choices: [{ message: { role: 'assistant', content: 'A summary.' } }],
      usage: { prompt_tokens: 41, completion_tokens: 12 },
    },
    openrouter: {
      choices: [{ message: { role: 'assistant', content: 'A summary.' } }],
      usage: { prompt_tokens: 41, completion_tokens: 12 },
    },
    custom: {
      choices: [{ message: { role: 'assistant', content: 'A summary.' } }],
      usage: { prompt_tokens: 41, completion_tokens: 12 },
    },
    anthropic: {
      type: 'message',
      content: [{ type: 'text', text: 'A summary.' }],
      usage: { input_tokens: 41, output_tokens: 12 },
    },
    gemini: {
      candidates: [{ content: { role: 'model', parts: [{ text: 'A summary.' }] } }],
      usageMetadata: { promptTokenCount: 41, candidatesTokenCount: 12 },
    },
  };

  const withoutUsage: Record<LlmProviderKind, unknown> = {
    openai: { choices: [{ message: { role: 'assistant', content: 'A summary.' } }] },
    openrouter: { choices: [{ message: { role: 'assistant', content: 'A summary.' } }] },
    custom: { choices: [{ message: { role: 'assistant', content: 'A summary.' } }] },
    anthropic: { type: 'message', content: [{ type: 'text', text: 'A summary.' }] },
    gemini: { candidates: [{ content: { role: 'model', parts: [{ text: 'A summary.' }] } }] },
  };

  it('U880: each provider’s own usage field names are read into the one usage shape', () => {
    for (const kind of ALL_KINDS) {
      expect(reply(kind, ok(200, withUsage[kind]))).toEqual({
        ok: true,
        text: 'A summary.',
        usage: { known: true, inputTokens: 41, outputTokens: 12 },
      });
    }
  });

  it('U881: a provider that returns no usage says so — not zero, and not a guess', () => {
    for (const kind of ALL_KINDS) {
      const response = reply(kind, ok(200, withoutUsage[kind]));
      expect(response).toEqual({ ok: true, text: 'A summary.', usage: { known: false } });
      if (!response.ok || response.usage.known) throw new Error('expected absent usage');
      expect(Object.values(response.usage)).not.toContain(0);
    }
  });

  it('U882: a partial or non-numeric usage block is absent usage, not half a count', () => {
    expect(
      reply(
        'openai',
        ok(200, {
          choices: [{ message: { content: 'A summary.' } }],
          usage: { prompt_tokens: 41, completion_tokens: null },
        }),
      ),
    ).toEqual({ ok: true, text: 'A summary.', usage: { known: false } });
  });

  it('U883: multi-part replies concatenate into the one text field', () => {
    expect(
      reply(
        'anthropic',
        ok(200, {
          content: [
            { type: 'text', text: 'First. ' },
            { type: 'thinking', thinking: 'ignored' },
            { type: 'text', text: 'Second.' },
          ],
          usage: { input_tokens: 1, output_tokens: 2 },
        }),
      ),
    ).toMatchObject({ ok: true, text: 'First. Second.' });
    expect(
      reply(
        'gemini',
        ok(200, { candidates: [{ content: { parts: [{ text: 'First. ' }, { text: 'Second.' }] } }] }),
      ),
    ).toMatchObject({ ok: true, text: 'First. Second.' });
  });
});

describe('PRD 011 Reqs 10+27 — the failure taxonomy, classified per provider', () => {
  it('U884: 401 and 403 are a bad key, with the provider’s own explanation kept', () => {
    expect(
      reply(
        'openai',
        ok(401, {
          error: { message: 'Incorrect API key provided.', code: 'invalid_api_key' },
        }),
      ),
    ).toEqual({
      ok: false,
      failure: {
        kind: 'bad-key',
        message: BAD_KEY_MESSAGE,
        status: 401,
        providerMessage: 'Incorrect API key provided.',
      },
    });
    expect(
      reply(
        'anthropic',
        ok(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
      ),
    ).toMatchObject({ ok: false, failure: { kind: 'bad-key', status: 401 } });
    // Gemini rejects a key with a 400 INVALID_ARGUMENT, not a 401.
    expect(
      reply(
        'gemini',
        ok(400, {
          error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' },
        }),
      ),
    ).toMatchObject({ ok: false, failure: { kind: 'bad-key', status: 400 } });
    expect(reply('openrouter', ok(403, { error: { message: 'forbidden' } }))).toMatchObject({
      ok: false,
      failure: { kind: 'bad-key', status: 403 },
    });
  });

  it('U885: 404 — and each provider’s model-not-found body — is an unknown model', () => {
    expect(
      reply('openai', ok(404, { error: { message: 'The model `gpt-9` does not exist', code: 'model_not_found' } })),
    ).toEqual({
      ok: false,
      failure: {
        kind: 'unknown-model',
        message: UNKNOWN_MODEL_MESSAGE,
        status: 404,
        providerMessage: 'The model `gpt-9` does not exist',
      },
    });
    // A compatible server that reports the same thing under a 400 is still an
    // unknown model, because its body says so.
    expect(
      reply('custom', ok(400, { error: { message: 'model not found', code: 'model_not_found' } })),
    ).toMatchObject({ ok: false, failure: { kind: 'unknown-model', status: 400 } });
    expect(
      reply('anthropic', ok(404, { type: 'error', error: { type: 'not_found_error', message: 'model: claude-9' } })),
    ).toMatchObject({ ok: false, failure: { kind: 'unknown-model', status: 404 } });
    expect(
      reply('gemini', ok(404, { error: { code: 404, status: 'NOT_FOUND', message: 'models/gemini-9 is not found' } })),
    ).toMatchObject({ ok: false, failure: { kind: 'unknown-model', status: 404 } });
  });

  it('U886: 429 is rate limited, honouring the retry hint each provider sends', () => {
    expect(
      providerFor('openai').readResponse({
        status: 429,
        body: JSON.stringify({ error: { message: 'Rate limit reached for gpt-5' } }),
        headers: { 'retry-after': '30' },
      }),
    ).toEqual({
      ok: false,
      failure: {
        kind: 'rate-limited',
        message: RATE_LIMITED_MESSAGE,
        status: 429,
        providerMessage: 'Rate limit reached for gpt-5',
        retryAfterSeconds: 30,
      },
    });
    // Gemini puts its hint in the body's RetryInfo instead of a header.
    expect(
      reply(
        'gemini',
        ok(429, {
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            message: 'Quota exceeded',
            details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '17s' }],
          },
        }),
      ),
    ).toMatchObject({ ok: false, failure: { kind: 'rate-limited', retryAfterSeconds: 17 } });
    // No usable hint is no hint — an HTTP-date form would need a clock.
    expect(
      providerFor('anthropic').readResponse({
        status: 429,
        body: JSON.stringify({ error: { type: 'rate_limit_error', message: 'slow down' } }),
        headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' },
      }),
    ).toEqual({
      ok: false,
      failure: {
        kind: 'rate-limited',
        message: RATE_LIMITED_MESSAGE,
        status: 429,
        providerMessage: 'slow down',
      },
    });
  });

  it('U887: a 200 whose body does not parse is the catch-all, never a silent empty summary', () => {
    for (const kind of ALL_KINDS) {
      expect(providerFor(kind).readResponse({ status: 200, body: '<html>oops</html>' })).toEqual({
        ok: false,
        failure: { kind: 'unexpected', message: MALFORMED_MESSAGE, status: 200 },
      });
      // Well-formed JSON of the wrong shape is the same catch-all.
      expect(providerFor(kind).readResponse(ok(200, { unexpected: true }))).toMatchObject({
        ok: false,
        failure: { kind: 'unexpected', status: 200 },
      });
    }
  });

  it('U888: any other status is the catch-all, carrying the status for the UI to render', () => {
    const response = reply('openrouter', ok(500, { error: { message: 'upstream exploded' } }));
    expect(response).toEqual({
      ok: false,
      failure: {
        kind: 'unexpected',
        message: 'The provider returned an unexpected reply (HTTP 500).',
        status: 500,
        providerMessage: 'upstream exploded',
      },
    });
    expect(reply('gemini', { status: 503, body: 'Service Unavailable' })).toMatchObject({
      ok: false,
      failure: { kind: 'unexpected', status: 503 },
    });
  });
});
