import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { createLlmApi, type FetchLike } from '../../server/llm';
import { createMockAuthProvider } from '../../server/providers/mock/auth';
import { createMockDirectoryProvider } from '../../server/providers/mock/directory';
import { createFakeLlm, FAKE_UNREACHABLE_DETAIL, type FakeLlm } from '../../src/lib/llmFake';
import { NO_LLM_CONFIGURED_MESSAGE } from '../../src/lib/llmDeployment';
import { OPENAI_ENDPOINT } from '../../src/lib/llmProviders';
import type { LlmFailureKind, LlmProviderConfig, LlmResponse } from '../../src/lib/llmSeam';
import { createMemoryStorage } from './storage-contract';

// PRD 011 Req 8+13: the hosted LLM proxy, proven at the HTTP layer — createApp
// on a loopback port with the mock auth provider and an in-memory storage
// seam, exactly like tests/unit/server-workspaces.test.ts. NO test here
// contacts a real provider: the server's outbound transport is the fake from
// src/lib/llmFake.ts, bridged into the injectable `fetchImpl`, so the real
// provider adapters run and only the sending is replaced. Provider host
// strings appear only as inert data compared against a built descriptor.

/** PRD 011 Req 7: the key the server is configured with. It may appear NOWHERE a browser can see. */
const SENTINEL_KEY = 'sk-sentinel-DO-NOT-LEAK-8f3c';

const OPERATOR_CONFIG: LlmProviderConfig = {
  kind: 'openai',
  apiKey: SENTINEL_KEY,
  model: 'gpt-4o-mini',
};

/** Every failure the taxonomy can arrive as from a provider exchange. */
const SCRIPTABLE_FAILURES = [
  'bad-key',
  'unknown-model',
  'rate-limited',
  'unreachable-host',
  'unexpected',
] as const satisfies readonly LlmFailureKind[];

/**
 * The fake as the server's injected `fetchImpl`: the descriptor the provider
 * built goes into the fake, and the reply comes back as a real `Response`, so
 * `httpTransport` — status, body and lower-cased headers — is under test too.
 * A `no-response` outcome rejects, which is what a dead host really does.
 */
function fetchImplOf(fake: FakeLlm): FetchLike {
  return async (url, init = {}) => {
    const result = await fake.transport({
      method: 'POST',
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: String(init.body ?? ''),
    });
    if (result.kind === 'no-response') throw new Error(FAKE_UNREACHABLE_DETAIL);
    return new Response(result.response.body, {
      status: result.response.status,
      headers: result.response.headers,
    });
  };
}

describe('PRD 011 Req 8+13 — the hosted LLM proxy', () => {
  const auth = createMockAuthProvider();
  const configured = createFakeLlm();
  const unconfigured = createFakeLlm();
  /** Two deployments side by side: one with an operator's LLM, one with none. */
  let withLlm: Server;
  let withoutLlm: Server;
  let base = '';
  let baseNoLlm = '';
  let token = '';

  const start = async (api: ReturnType<typeof createLlmApi>): Promise<[Server, string]> => {
    const { provider } = createMemoryStorage();
    const server = createServer(
      createApp(
        '/nonexistent-static',
        { auth, storage: provider, directory: createMockDirectoryProvider() },
        'local',
        api,
      ),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return [server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`];
  };

  beforeAll(async () => {
    [withLlm, base] = await start(
      createLlmApi({ config: OPERATOR_CONFIG, fetchImpl: fetchImplOf(configured) }),
    );
    [withoutLlm, baseNoLlm] = await start(createLlmApi({ fetchImpl: fetchImplOf(unconfigured) }));
    const result = await auth.signIn({ username: 'ada' });
    if (result?.kind !== 'token') throw new Error('mock sign-in failed');
    token = result.token;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => withLlm.close(() => resolve()));
    await new Promise<void>((resolve) => withoutLlm.close(() => resolve()));
  });

  beforeEach(() => {
    configured.reset();
    unconfigured.reset();
  });

  const call = (method: string, path: string, body?: unknown, origin = base): Promise<Response> =>
    fetch(`${origin}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });

  /** A well-formed seam request, as the client capability sends it. */
  const REQUEST = { trigger: 'summarize', prompt: 'Summarize this section.', maxOutputTokens: 256 };

  const post = (body: unknown, origin = base): Promise<Response> =>
    call('POST', '/api/llm/request', body, origin);

  it('U527: every route is behind the same 401 as the rest of /api/, before any provider is contacted', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/llm', undefined],
      ['POST', '/api/llm/request', JSON.stringify(REQUEST)],
    ] as const) {
      const res = await fetch(`${base}${path}`, { method, ...(body === undefined ? {} : { body }) });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(((await res.json()) as { error: string }).error).toBe('authentication required');
    }
    // A bad token is the same answer, and neither reached the transport.
    const bogus = await fetch(`${base}/api/llm`, { headers: { Authorization: 'Bearer nope' } });
    expect(bogus.status).toBe(401);
    expect(configured.calls).toHaveLength(0);
  });

  it('U528: the GET says which provider and model this deployment uses, carries no key, and calls nothing', async () => {
    const res = await call('GET', '/api/llm');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ configured: true, provider: 'openai', model: 'gpt-4o-mini' });
    // PRD 011 Req 7: not the key, and not a field that could carry one.
    expect(JSON.stringify(body)).not.toContain(SENTINEL_KEY);
    expect(Object.keys(body)).not.toContain('apiKey');
    // PRD 011 Req 16: availability is an answer about configuration, not a call.
    expect(configured.calls).toHaveLength(0);
  });

  it('U529: a deployment with no LLM configured says so, and refuses a request legibly and typed', async () => {
    const availability = await call('GET', '/api/llm', undefined, baseNoLlm);
    expect(await availability.json()).toEqual({ configured: false });

    const res = await post(REQUEST, baseNoLlm);
    // Not a bare 500 and not a generic 404: a named status plus the seam's own
    // response shape, so #116's availability copy has something honest to say.
    expect(res.status).toBe(409);
    const answer = (await res.json()) as LlmResponse;
    expect(answer.ok).toBe(false);
    if (answer.ok) throw new Error('expected a refusal');
    expect(answer.failure.kind).toBe('invalid-config');
    expect(answer.failure.message).toBe(NO_LLM_CONFIGURED_MESSAGE);
    expect(unconfigured.calls).toHaveLength(0);
  });

  it('U530: a POST runs the seam server-side and answers its success — text plus usage', async () => {
    configured.respondWith({ outcome: 'text', text: 'A short summary.', usage: { inputTokens: 40, outputTokens: 9 } });
    const res = await post(REQUEST);
    expect(res.status).toBe(200);
    const answer = (await res.json()) as LlmResponse;
    expect(answer).toEqual({
      ok: true,
      text: 'A short summary.',
      usage: { known: true, inputTokens: 40, outputTokens: 9 },
    });
    // The provider descriptor was built from the OPERATOR's config — the
    // client named neither the model nor the endpoint.
    expect(configured.calls).toHaveLength(1);
    expect(configured.calls[0].model).toBe('gpt-4o-mini');
    expect(configured.calls[0].prompt).toBe(REQUEST.prompt);
    expect(configured.calls[0].url).toBe(OPENAI_ENDPOINT);
  });

  it('U531: each provider failure comes back as its own typed failure from the taxonomy', async () => {
    for (const kind of SCRIPTABLE_FAILURES) {
      configured.respondWith({ outcome: 'failure', kind });
      const answer = (await (await post(REQUEST)).json()) as LlmResponse;
      if (answer.ok) throw new Error(`expected ${kind} to fail`);
      expect(answer.failure.kind, kind).toBe(kind);
      expect(answer.failure.message.length, kind).toBeGreaterThan(0);
    }
    // A rate limit keeps its retry hint through the real HTTP hop.
    configured.respondWith({ outcome: 'failure', kind: 'rate-limited', retryAfterSeconds: 30 });
    const limited = (await (await post(REQUEST)).json()) as LlmResponse;
    if (limited.ok) throw new Error('expected a rate limit');
    expect(limited.failure.retryAfterSeconds).toBe(30);
  });

  it('U532: the sentinel key appears nowhere in a reply — success or any failure kind', async () => {
    // A provider that echoes the key back is the case redaction exists for.
    const outcomes = [
      { outcome: 'text', text: `here is your key ${SENTINEL_KEY}` },
      ...SCRIPTABLE_FAILURES.map((kind) => ({
        outcome: 'failure' as const,
        kind,
        providerMessage: `Incorrect API key provided: ${SENTINEL_KEY}.`,
      })),
    ] as const;
    for (const outcome of outcomes) {
      configured.respondWith(outcome);
      const raw = await (await post(REQUEST)).text();
      expect(raw, JSON.stringify(outcome)).not.toContain(SENTINEL_KEY);
    }
    // …and neither does availability, on a deployment configured with it.
    expect(await (await call('GET', '/api/llm')).text()).not.toContain(SENTINEL_KEY);
  });

  it('U533: a body that is not the seam’s request is a 400, and no provider call is made', async () => {
    const bad: [string, unknown][] = [
      ['malformed JSON', '{not json'],
      ['no body at all', undefined],
      ['not an object', '"just a string"'],
      ['missing prompt', { trigger: 'summarize', maxOutputTokens: 256 }],
      ['empty prompt', { ...REQUEST, prompt: '' }],
      ['missing trigger', { prompt: 'x', maxOutputTokens: 256 }],
      ['unrecognized trigger', { ...REQUEST, trigger: 'background-refresh' }],
      ['missing maxOutputTokens', { trigger: 'summarize', prompt: 'x' }],
      ['non-integer maxOutputTokens', { ...REQUEST, maxOutputTokens: 1.5 }],
      ['a system that is not a string', { ...REQUEST, system: 7 }],
    ];
    for (const [what, body] of bad) {
      const res = await post(body);
      expect(res.status, what).toBe(400);
      expect(((await res.json()) as { error: string }).error.length, what).toBeGreaterThan(0);
    }
    // PRD 011 Req 16: nothing widened the trigger set, and nothing defaulted one.
    expect(configured.calls).toHaveLength(0);
  });

  it('U534: Req 16 — the transport records zero calls for everything but an explicit POST carrying a trigger', async () => {
    // Server start, sign-in, page load and availability: all already happened
    // above (beforeAll signs in; this deployment has been serving since).
    await call('GET', '/api/me');
    await call('GET', '/api/llm');
    await fetch(`${base}/`); // a page load, on the static path
    await post({ ...REQUEST, trigger: undefined });
    expect(configured.calls).toHaveLength(0);

    await post(REQUEST);
    expect(configured.calls).toHaveLength(1);
    expect(configured.calls.map((c) => c.prompt)).toEqual([REQUEST.prompt]);
  });

  it('U535: a client cannot change the credential — no route takes a key, kind, model or base URL', async () => {
    const smuggled = {
      ...REQUEST,
      apiKey: 'sk-attacker-key',
      kind: 'anthropic',
      provider: 'anthropic',
      model: 'attacker-model',
      baseUrl: 'https://attacker.example/v1',
    };
    expect((await post(smuggled)).status).toBe(200);
    // The descriptor is still the operator's provider, model and endpoint.
    expect(configured.calls[0].providerKind).toBe('openai');
    expect(configured.calls[0].model).toBe('gpt-4o-mini');
    expect(configured.calls[0].url).toBe(OPENAI_ENDPOINT);
    expect(configured.calls[0].request.body).not.toContain('attacker');
    // And the deployment still reports what the operator configured.
    expect(await (await call('GET', '/api/llm')).json()).toEqual({
      configured: true,
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    // Every other method and sub-path under the prefix is a plain 404 — there
    // is no third route to reach for.
    for (const [method, path] of [
      ['PUT', '/api/llm'],
      ['POST', '/api/llm'],
      ['GET', '/api/llm/request'],
      ['POST', '/api/llm/config'],
    ] as const) {
      expect((await call(method, path, method === 'POST' ? {} : undefined)).status, path).toBe(404);
    }
  });
});
