/**
 * PRD 011 Req 5: the five provider implementations — OpenAI, Anthropic, Google
 * Gemini, OpenRouter and a custom OpenAI-compatible endpoint — behind the one
 * seam in `llmSeam.ts`. Each turns the seam's single request shape into the
 * body its provider actually accepts, and each turns that provider's own reply
 * (or its own error vocabulary) back into the seam's single response shape.
 *
 * PRD 011 Req 11: nothing public is declared here but the implementations
 * themselves. Every type crossing the boundary is the seam's, so a sixth
 * provider is a new entry in `PROVIDERS` and no change to callers.
 *
 * PRD 011 Req 7: the API key travels in a request header and nowhere else —
 * never in a URL, never in a query string, never in a body.
 *
 * There is no I/O in this file: a provider builds a request descriptor and
 * reads a response that someone else fetched.
 */

import type {
  LlmFailure,
  LlmFailureKind,
  LlmHttpRequest,
  LlmHttpResponse,
  LlmProvider,
  LlmProviderKind,
  LlmRequest,
  LlmResponse,
  LlmUsage,
} from './llmSeam';
import { USAGE_UNKNOWN } from './llmSeam';

/** PRD 011 Req 5: where each hosted provider lives. Only `custom` is user-supplied. */
export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** The Anthropic API version header; required on every request to `/v1/messages`. */
export const ANTHROPIC_VERSION = '2023-06-01';

/** PRD 011 Reqs 10+27: the reader-facing sentence for each failure kind. */
export const BAD_KEY_MESSAGE = 'The provider rejected the API key. Check the key in settings.';
export const UNKNOWN_MODEL_MESSAGE =
  'The provider does not recognise that model id. Check the model in settings.';
export const RATE_LIMITED_MESSAGE = 'The provider is rate limiting requests. Try again in a moment.';
export const MALFORMED_MESSAGE = 'The provider returned a reply the app could not read.';
export const INVALID_BASE_URL_MESSAGE =
  'The custom endpoint must be an absolute http:// or https:// URL.';

const JSON_HEADERS = { 'content-type': 'application/json' };

// ---------------------------------------------------------------------------
// OpenAI-compatible family: OpenAI, OpenRouter, and the custom endpoint
// ---------------------------------------------------------------------------

/**
 * PRD 011 Req 5: the chat/completions body all three OpenAI-shaped providers
 * send. `maxTokensField` is the one true divergence: OpenAI's own API has
 * renamed the cap to `max_completion_tokens`, while the compatible ecosystem
 * (OpenRouter, llama.cpp, vLLM, Ollama, …) reads `max_tokens`.
 */
function openAiBody(
  model: string,
  request: LlmRequest,
  maxTokensField: 'max_tokens' | 'max_completion_tokens',
): string {
  const messages = [
    ...(request.system ? [{ role: 'system', content: request.system }] : []),
    { role: 'user', content: request.prompt },
  ];
  return JSON.stringify({ model, messages, [maxTokensField]: request.maxOutputTokens });
}

/** PRD 011 Req 7: the key rides in `Authorization: Bearer`, never in the URL. */
function openAiCompatibleRequest(
  url: string,
  apiKey: string,
  model: string,
  request: LlmRequest,
  maxTokensField: 'max_tokens' | 'max_completion_tokens',
): LlmHttpRequest {
  return {
    method: 'POST',
    url,
    headers: { ...JSON_HEADERS, authorization: `Bearer ${apiKey}` },
    body: openAiBody(model, request, maxTokensField),
  };
}

function readOpenAiCompatibleResponse(response: LlmHttpResponse): LlmResponse {
  const payload = parseJson(response.body);
  if (response.status < 200 || response.status >= 300) {
    return failed(classifyOpenAiStatus(response, payload));
  }
  if (!payload) return failed(malformed(response));
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = asRecord(asRecord(choices[0])?.message);
  const text = message?.content;
  if (typeof text !== 'string') return failed(malformed(response));
  const usage = asRecord(payload.usage);
  return {
    ok: true,
    text,
    // PRD 011 Req 32: OpenAI-shaped usage is `prompt_tokens` /
    // `completion_tokens`. A provider that sends neither (several
    // OpenAI-compatible servers do not) yields the absent value, not a zero.
    usage: countedUsage(usage?.prompt_tokens, usage?.completion_tokens),
  };
}

/**
 * PRD 011 Req 10: OpenAI and its compatible peers answer 401/403 for a bad
 * key, 404 for a model that does not exist, 429 when rate limiting. The body's
 * `error.code` is checked too, since some compatible servers report
 * `model_not_found` under a 400.
 */
function classifyOpenAiStatus(
  response: LlmHttpResponse,
  payload: Record<string, unknown> | undefined,
): LlmFailure {
  const error = asRecord(payload?.error);
  const providerMessage = asString(error?.message);
  if (error?.code === 'model_not_found') {
    return failure('unknown-model', UNKNOWN_MODEL_MESSAGE, response, providerMessage);
  }
  return classifyByStatus(response, providerMessage);
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

function readAnthropicResponse(response: LlmHttpResponse): LlmResponse {
  const payload = parseJson(response.body);
  if (response.status < 200 || response.status >= 300) {
    return failed(classifyAnthropicStatus(response, payload));
  }
  if (!payload) return failed(malformed(response));
  // Anthropic replies with a list of content blocks; the text ones concatenate.
  const blocks = Array.isArray(payload.content) ? payload.content : [];
  const parts = blocks
    .map((block) => asRecord(block))
    .filter((block) => block?.type === 'text')
    .map((block) => asString(block?.text))
    .filter((text): text is string => text !== undefined);
  if (parts.length === 0) return failed(malformed(response));
  const usage = asRecord(payload.usage);
  return {
    ok: true,
    text: parts.join(''),
    // PRD 011 Req 32: Anthropic names them `input_tokens` / `output_tokens`.
    usage: countedUsage(usage?.input_tokens, usage?.output_tokens),
  };
}

/** PRD 011 Req 10: Anthropic types its errors — `not_found_error` is the unknown model. */
function classifyAnthropicStatus(
  response: LlmHttpResponse,
  payload: Record<string, unknown> | undefined,
): LlmFailure {
  const error = asRecord(payload?.error);
  const providerMessage = asString(error?.message);
  if (error?.type === 'not_found_error') {
    return failure('unknown-model', UNKNOWN_MODEL_MESSAGE, response, providerMessage);
  }
  if (error?.type === 'authentication_error' || error?.type === 'permission_error') {
    return failure('bad-key', BAD_KEY_MESSAGE, response, providerMessage);
  }
  return classifyByStatus(response, providerMessage);
}

// ---------------------------------------------------------------------------
// Google Gemini
// ---------------------------------------------------------------------------

/**
 * PRD 011 Req 5+7: `generateContent` for the configured model, with the key in
 * the `x-goog-api-key` header — never as the `?key=` query parameter Google's
 * quickstarts use, so the key cannot end up in a URL, a log or a referrer.
 */
function geminiRequest(apiKey: string, model: string, request: LlmRequest): LlmHttpRequest {
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
    generationConfig: { maxOutputTokens: request.maxOutputTokens },
  };
  if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };
  return {
    method: 'POST',
    url: `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`,
    headers: { ...JSON_HEADERS, 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  };
}

function readGeminiResponse(response: LlmHttpResponse): LlmResponse {
  const payload = parseJson(response.body);
  if (response.status < 200 || response.status >= 300) {
    return failed(classifyGeminiStatus(response, payload));
  }
  if (!payload) return failed(malformed(response));
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const parts = asRecord(asRecord(candidates[0])?.content)?.parts;
  const texts = (Array.isArray(parts) ? parts : [])
    .map((part) => asString(asRecord(part)?.text))
    .filter((text): text is string => text !== undefined);
  if (texts.length === 0) return failed(malformed(response));
  const meta = asRecord(payload.usageMetadata);
  return {
    ok: true,
    text: texts.join(''),
    // PRD 011 Req 32: Gemini names them `promptTokenCount` / `candidatesTokenCount`.
    usage: countedUsage(meta?.promptTokenCount, meta?.candidatesTokenCount),
  };
}

/**
 * PRD 011 Req 10: Gemini answers 400 INVALID_ARGUMENT for a bad key and 404
 * NOT_FOUND for an unknown model, and puts its retry hint in the error body's
 * `RetryInfo` detail rather than in a `retry-after` header.
 */
function classifyGeminiStatus(
  response: LlmHttpResponse,
  payload: Record<string, unknown> | undefined,
): LlmFailure {
  const error = asRecord(payload?.error);
  const providerMessage = asString(error?.message);
  if (error?.status === 'NOT_FOUND') {
    return failure('unknown-model', UNKNOWN_MODEL_MESSAGE, response, providerMessage);
  }
  if (error?.status === 'INVALID_ARGUMENT' && /api key/i.test(providerMessage ?? '')) {
    return failure('bad-key', BAD_KEY_MESSAGE, response, providerMessage);
  }
  const base = classifyByStatus(response, providerMessage);
  if (base.kind !== 'rate-limited' || base.retryAfterSeconds !== undefined) return base;
  const retry = geminiRetryDelay(error);
  return retry === undefined ? base : { ...base, retryAfterSeconds: retry };
}

/** `error.details[].retryDelay` reads as `"30s"`; anything else is no hint. */
function geminiRetryDelay(error: Record<string, unknown> | undefined): number | undefined {
  const details = Array.isArray(error?.details) ? error.details : [];
  for (const entry of details) {
    const delay = asString(asRecord(entry)?.retryDelay);
    if (delay && /^\d+(\.\d+)?s$/.test(delay)) return Number.parseFloat(delay);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The custom OpenAI-compatible endpoint
// ---------------------------------------------------------------------------

/**
 * PRD 011 Req 5: normalize a user-typed base URL so `https://host/v1` and
 * `https://host/v1/` produce the same endpoint. A URL that is not an absolute
 * http(s) one is a configuration failure, not a request; any credentials,
 * query or fragment the user pasted are dropped, so nothing secret can be
 * carried into the URL.
 */
export function customEndpoint(baseUrl: string): string | LlmFailure {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    return { kind: 'invalid-config', message: INVALID_BASE_URL_MESSAGE };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'invalid-config', message: INVALID_BASE_URL_MESSAGE };
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${path}/chat/completions`;
}

// ---------------------------------------------------------------------------
// The five implementations
// ---------------------------------------------------------------------------

const openai: LlmProvider = {
  buildRequest: (config, request) =>
    openAiCompatibleRequest(
      OPENAI_ENDPOINT,
      config.apiKey,
      config.model,
      request,
      'max_completion_tokens',
    ),
  readResponse: readOpenAiCompatibleResponse,
};

const openrouter: LlmProvider = {
  buildRequest: (config, request) =>
    openAiCompatibleRequest(
      OPENROUTER_ENDPOINT,
      config.apiKey,
      config.model,
      request,
      'max_tokens',
    ),
  readResponse: readOpenAiCompatibleResponse,
};

const custom: LlmProvider = {
  // `PROVIDERS` only ever routes a `custom` config here; the guard is what says
  // so to the type checker, and any other kind answers the same
  // invalid-config failure an unusable base URL would.
  buildRequest: (config, request) => {
    const endpoint = customEndpoint(config.kind === 'custom' ? config.baseUrl : '');
    if (typeof endpoint !== 'string') return endpoint;
    return openAiCompatibleRequest(endpoint, config.apiKey, config.model, request, 'max_tokens');
  },
  readResponse: readOpenAiCompatibleResponse,
};

const anthropic: LlmProvider = {
  buildRequest: (config, request) => ({
    method: 'POST',
    url: ANTHROPIC_ENDPOINT,
    // PRD 011 Req 7: `x-api-key`, alongside the required version header.
    headers: {
      ...JSON_HEADERS,
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: request.maxOutputTokens,
      ...(request.system ? { system: request.system } : {}),
      messages: [{ role: 'user', content: request.prompt }],
    }),
  }),
  readResponse: readAnthropicResponse,
};

const gemini: LlmProvider = {
  buildRequest: (config, request) => geminiRequest(config.apiKey, config.model, request),
  readResponse: readGeminiResponse,
};

/** PRD 011 Req 5+11: the whole provider set. A sixth provider is one more entry. */
const PROVIDERS: Record<LlmProviderKind, LlmProvider> = {
  openai,
  anthropic,
  gemini,
  openrouter,
  custom,
};

/** PRD 011 Req 11: the seam's lookup of the single active provider's implementation. */
export function providerFor(kind: LlmProviderKind): LlmProvider {
  return PROVIDERS[kind];
}

// ---------------------------------------------------------------------------
// Shared classification and reading helpers
// ---------------------------------------------------------------------------

/**
 * PRD 011 Req 10: the status rules every provider shares — 401/403 is the key,
 * 404 is the model, 429 is rate limiting (honouring a `retry-after` hint), and
 * anything else is the catch-all with its status kept for the UI.
 */
function classifyByStatus(
  response: LlmHttpResponse,
  providerMessage: string | undefined,
): LlmFailure {
  const status = response.status;
  if (status === 401 || status === 403) {
    return failure('bad-key', BAD_KEY_MESSAGE, response, providerMessage);
  }
  if (status === 404) {
    return failure('unknown-model', UNKNOWN_MODEL_MESSAGE, response, providerMessage);
  }
  if (status === 429) {
    const retryAfter = retryAfterSeconds(response.headers);
    return {
      ...failure('rate-limited', RATE_LIMITED_MESSAGE, response, providerMessage),
      ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
    };
  }
  const unexpected = `The provider returned an unexpected reply (HTTP ${status}).`;
  return failure('unexpected', unexpected, response, providerMessage);
}

/**
 * A `retry-after` header in the delta-seconds form. The HTTP-date form is
 * deliberately ignored: reading it would need a clock, and this module has
 * none — a missing hint is honest, a clock-derived one would be untestable.
 */
function retryAfterSeconds(headers: Record<string, string> | undefined): number | undefined {
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (!raw || !/^\s*\d+(\.\d+)?\s*$/.test(raw)) return undefined;
  return Number.parseFloat(raw);
}

/** PRD 011 Req 27: the catch-all for a 200 whose body is not the promised shape. */
function malformed(response: LlmHttpResponse): LlmFailure {
  return failure('unexpected', MALFORMED_MESSAGE, response, undefined);
}

/**
 * One failure, however it was classified: the seam's kind and our own sentence,
 * the status that produced it, and the provider's own words when it gave any.
 */
function failure(
  kind: LlmFailureKind,
  message: string,
  response: LlmHttpResponse,
  providerMessage: string | undefined,
): LlmFailure {
  return {
    kind,
    message,
    status: response.status,
    ...(providerMessage ? { providerMessage } : {}),
  };
}

function failed(reason: LlmFailure): LlmResponse {
  return { ok: false, failure: reason };
}

/** PRD 011 Req 32: two counts make usage known; anything else is the absent value. */
function countedUsage(input: unknown, output: unknown): LlmUsage {
  const counted = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
  if (!counted(input) || !counted(output)) return USAGE_UNKNOWN;
  return { known: true, inputTokens: input, outputTokens: output };
}

function parseJson(body: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(body));
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
