/**
 * PRD 011 Req 35: the local fake every LLM test runs against. No test contacts
 * a real provider: the fake is an `LlmTransport`, so a test drives the seam's
 * real entry point and the real provider adapters and only the *sending* is
 * replaced. Provider host strings therefore appear in a test only as inert data
 * compared against a built descriptor.
 *
 * It is scriptable — canned successes with usage present or absent, and each
 * failure kind — and it records what was asked, so a test can assert how many
 * calls were made, against which provider kind, model and prompt.
 *
 * PRD 011 Req 16: importing this file starts nothing. It reads no clock and
 * uses no randomness, so a test that scripts an outcome gets that outcome.
 *
 * It lives in `src/lib/` rather than under `tests/` so the later siblings —
 * test connection, summaries, and the e2e matrix driving it through the desktop
 * shim — reach it without it moving.
 */

import { OPENAI_ENDPOINT, OPENROUTER_ENDPOINT } from './llmProviders';
import { runLlmRequest } from './llmSeam';
import type {
  LlmFailureKind,
  LlmHttpRequest,
  LlmProviderConfig,
  LlmProviderKind,
  LlmRequest,
  LlmResponse,
  LlmTransport,
  LlmTransportResult,
  LlmTrigger,
} from './llmSeam';

/**
 * PRD 011 Req 35: what a test scripts. `invalid-config` is absent on purpose —
 * a request that cannot be built never reaches a transport.
 */
export type FakeLlmOutcome =
  | { outcome: 'text'; text: string; usage?: { inputTokens: number; outputTokens: number } }
  | {
      outcome: 'failure';
      kind: Exclude<LlmFailureKind, 'invalid-config'>;
      providerMessage?: string;
      retryAfterSeconds?: number;
    };

/** PRD 011 Req 35: what the fake recorded about one request. */
export interface FakeLlmCall {
  providerKind: LlmProviderKind;
  model: string;
  prompt: string;
  system?: string;
  /** Present when the call went through `run`, which sees the seam's request. */
  trigger?: LlmTrigger;
  url: string;
  request: LlmHttpRequest;
}

/** PRD 011 Req 35: the fake's surface — a transport, a seam call, and a log. */
export interface FakeLlm {
  /** Hand this to `runLlmRequest` (or to anything that takes an `LlmTransport`). */
  transport: LlmTransport;
  /** The seam's entry point bound to this fake — the shape a caller will use. */
  run(config: LlmProviderConfig, request: LlmRequest): Promise<LlmResponse>;
  /** Every request the fake was asked to send, oldest first. */
  calls: FakeLlmCall[];
  /** The outcome for any call the queue does not cover. */
  respondWith(outcome: FakeLlmOutcome): void;
  /** Outcomes for the next N calls, in order; then the default resumes. */
  queue(...outcomes: FakeLlmOutcome[]): void;
  /** Forget the calls and the queue, and restore the default outcome. */
  reset(): void;
}

/** The reply a fake gives when a test scripted nothing: a success with usage. */
export const DEFAULT_FAKE_OUTCOME: FakeLlmOutcome = {
  outcome: 'text',
  text: 'A fake summary.',
  usage: { inputTokens: 12, outputTokens: 7 },
};

/** What a fake transport says when it is standing in for an unreachable host. */
export const FAKE_UNREACHABLE_DETAIL = 'fake transport: no route to host';

/** PRD 011 Req 35: build a fresh fake. Nothing is shared between two of them. */
export function createFakeLlm(initial: FakeLlmOutcome = DEFAULT_FAKE_OUTCOME): FakeLlm {
  const calls: FakeLlmCall[] = [];
  const queued: FakeLlmOutcome[] = [];
  let fallback = initial;
  // `run` sets this immediately before calling the seam, and the transport
  // takes it on the same synchronous turn (the seam builds the descriptor
  // without awaiting), so concurrent runs cannot swap triggers.
  let pendingTrigger: LlmTrigger | undefined;

  const transport: LlmTransport = (request) => {
    const trigger = pendingTrigger;
    pendingTrigger = undefined;
    calls.push(describeCall(request, trigger));
    const outcome = queued.shift() ?? fallback;
    return Promise.resolve(synthesize(wireStyleOf(request), outcome));
  };

  return {
    transport,
    calls,
    run(config, request) {
      pendingTrigger = request.trigger;
      return runLlmRequest(transport, config, request);
    },
    respondWith(outcome) {
      fallback = outcome;
    },
    queue(...outcomes) {
      queued.push(...outcomes);
    },
    reset() {
      calls.length = 0;
      queued.length = 0;
      fallback = initial;
      pendingTrigger = undefined;
    },
  };
}

/** The three wire dialects the five providers speak. */
type WireStyle = 'openai' | 'anthropic' | 'gemini';

/**
 * Which provider built this descriptor, read off the descriptor itself — the
 * fake keeps no configuration state, so it behaves the same whether a test
 * drives it through `run` or hands the transport to the seam directly.
 */
function providerKindOf(request: LlmHttpRequest): LlmProviderKind {
  if (request.headers['anthropic-version']) return 'anthropic';
  if (request.headers['x-goog-api-key']) return 'gemini';
  if (request.url === OPENAI_ENDPOINT) return 'openai';
  if (request.url === OPENROUTER_ENDPOINT) return 'openrouter';
  return 'custom';
}

function wireStyleOf(request: LlmHttpRequest): WireStyle {
  const kind = providerKindOf(request);
  if (kind === 'anthropic') return 'anthropic';
  if (kind === 'gemini') return 'gemini';
  return 'openai';
}

/** PRD 011 Req 35: the model, prompt and system text, read back out of the body. */
function describeCall(request: LlmHttpRequest, trigger: LlmTrigger | undefined): FakeLlmCall {
  const kind = providerKindOf(request);
  const body = JSON.parse(request.body) as Record<string, never>;
  const sent = readSent(wireStyleOf(request), body, request.url);
  return {
    providerKind: kind,
    url: request.url,
    request,
    ...(trigger ? { trigger } : {}),
    ...sent,
  };
}

function readSent(
  style: WireStyle,
  body: Record<string, unknown>,
  url: string,
): { model: string; prompt: string; system?: string } {
  if (style === 'gemini') {
    // Gemini carries the model in the path: `…/models/<model>:generateContent`.
    const model = decodeURIComponent(url.split('/').pop()?.split(':')[0] ?? '');
    const contents = body.contents as { parts: { text: string }[] }[] | undefined;
    const system = body.systemInstruction as { parts: { text: string }[] } | undefined;
    return {
      model,
      prompt: contents?.[0]?.parts?.[0]?.text ?? '',
      ...(system ? { system: system.parts[0]?.text ?? '' } : {}),
    };
  }
  const model = typeof body.model === 'string' ? body.model : '';
  if (style === 'anthropic') {
    const messages = body.messages as { role: string; content: string }[] | undefined;
    return {
      model,
      prompt: messages?.[0]?.content ?? '',
      ...(typeof body.system === 'string' ? { system: body.system } : {}),
    };
  }
  const messages = (body.messages as { role: string; content: string }[] | undefined) ?? [];
  const system = messages.find((m) => m.role === 'system');
  return {
    model,
    prompt: messages.find((m) => m.role === 'user')?.content ?? '',
    ...(system ? { system: system.content } : {}),
  };
}

/**
 * PRD 011 Req 35: turn a scripted outcome into a reply shaped like the real
 * provider's, so the adapters under test do the same parsing and classification
 * they would against the live service.
 */
function synthesize(style: WireStyle, outcome: FakeLlmOutcome): LlmTransportResult {
  if (outcome.outcome === 'text') {
    return { kind: 'http', response: { status: 200, body: successBody(style, outcome) } };
  }
  const kind = outcome.kind;
  if (kind === 'unreachable-host') {
    return { kind: 'no-response', detail: FAKE_UNREACHABLE_DETAIL };
  }
  if (kind === 'unexpected') {
    // The catch-all as it actually happens: a 200 whose body is not the shape
    // the provider promised, never a silent empty summary.
    return { kind: 'http', response: { status: 200, body: '<html>bad gateway</html>' } };
  }
  return { kind: 'http', response: errorResponse(style, { ...outcome, kind }) };
}

function successBody(
  style: WireStyle,
  outcome: { text: string; usage?: { inputTokens: number; outputTokens: number } },
): string {
  const { text, usage } = outcome;
  if (style === 'anthropic') {
    return JSON.stringify({
      type: 'message',
      content: [{ type: 'text', text }],
      ...(usage
        ? { usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens } }
        : {}),
    });
  }
  if (style === 'gemini') {
    return JSON.stringify({
      candidates: [{ content: { role: 'model', parts: [{ text }] } }],
      ...(usage
        ? {
            usageMetadata: {
              promptTokenCount: usage.inputTokens,
              candidatesTokenCount: usage.outputTokens,
            },
          }
        : {}),
    });
  }
  return JSON.stringify({
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    ...(usage
      ? { usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens } }
      : {}),
  });
}

function errorResponse(
  style: WireStyle,
  outcome: { kind: 'bad-key' | 'unknown-model' | 'rate-limited'; providerMessage?: string; retryAfterSeconds?: number },
): { status: number; body: string; headers?: Record<string, string> } {
  const message = outcome.providerMessage ?? DEFAULT_PROVIDER_MESSAGE[outcome.kind];
  const retry = outcome.retryAfterSeconds;
  if (style === 'anthropic') {
    const type =
      outcome.kind === 'bad-key'
        ? 'authentication_error'
        : outcome.kind === 'unknown-model'
          ? 'not_found_error'
          : 'rate_limit_error';
    return {
      status: STATUS[outcome.kind],
      body: JSON.stringify({ type: 'error', error: { type, message } }),
      ...(retry === undefined ? {} : { headers: { 'retry-after': String(retry) } }),
    };
  }
  if (style === 'gemini') {
    const status =
      outcome.kind === 'bad-key'
        ? 'INVALID_ARGUMENT'
        : outcome.kind === 'unknown-model'
          ? 'NOT_FOUND'
          : 'RESOURCE_EXHAUSTED';
    // Gemini answers 400 for a rejected key, and puts its retry hint in the body.
    const httpStatus = outcome.kind === 'bad-key' ? 400 : STATUS[outcome.kind];
    return {
      status: httpStatus,
      body: JSON.stringify({
        error: {
          code: httpStatus,
          status,
          message,
          ...(retry === undefined ? {} : { details: [{ retryDelay: `${retry}s` }] }),
        },
      }),
    };
  }
  const code =
    outcome.kind === 'bad-key'
      ? 'invalid_api_key'
      : outcome.kind === 'unknown-model'
        ? 'model_not_found'
        : 'rate_limit_exceeded';
  return {
    status: STATUS[outcome.kind],
    body: JSON.stringify({ error: { message, type: 'invalid_request_error', code } }),
    ...(retry === undefined ? {} : { headers: { 'retry-after': String(retry) } }),
  };
}

const STATUS = { 'bad-key': 401, 'unknown-model': 404, 'rate-limited': 429 } as const;

const DEFAULT_PROVIDER_MESSAGE = {
  'bad-key': 'Incorrect API key provided.',
  'unknown-model': 'The model does not exist.',
  'rate-limited': 'Rate limit reached for requests.',
} as const;
