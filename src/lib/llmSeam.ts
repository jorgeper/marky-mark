/**
 * PRD 011 Req 11: the one seam every LLM feature calls through. This module
 * holds the *only* definition of the LLM request shape, the LLM response
 * shape, the token-usage report and the failure taxonomy; provider code
 * (`llmProviders.ts`) declares no public request/response types of its own, so
 * adding a sixth provider is a new implementation behind this seam and no
 * change here or to callers.
 *
 * PRD 011 Req 12+13: the seam is transport-agnostic. A provider turns
 * (config + request) into a plain HTTP *descriptor* and turns a plain HTTP
 * *response* back into `LlmResponse`; actually sending it is injected as an
 * `LlmTransport`, so the desktop path (Rust shell) and the hosted path (the
 * app's own same-origin server) each supply their own without touching
 * provider code. Nothing in this file performs I/O, so the repository's
 * no-network-call-site rule stands: this seam adds no browser network API
 * call site of any kind, and the gate's allowlist counters stay where they
 * are (re-pinning them belongs to issue #114).
 *
 * PRD 011 Req 16: importing this module does nothing. No timer, no listener,
 * no startup hook, no request — every call starts at `runLlmRequest`, named by
 * a caller, on behalf of a user action the request itself has to state.
 */

import { providerFor } from './llmProviders';

/**
 * PRD 011 Req 5: the five provider kinds, and only these. The custom kind is
 * an OpenAI-compatible endpoint the user points at themselves.
 */
export type LlmProviderKind = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'custom';

/**
 * PRD 011 Req 5: "exactly one provider is active at a time", made structural.
 * This is a single active-provider value — a discriminated union on `kind` —
 * not a list, set or map of enabled providers, so a configuration with two
 * live providers cannot be represented.
 *
 * PRD 011 Req 6: `model` is free text on every kind, so a model the provider
 * accepts never needs an app release. Curated suggestion lists are a settings
 * concern layered on top of this, not a constraint on it.
 */
export type LlmProviderConfig =
  | { kind: 'openai'; apiKey: string; model: string }
  | { kind: 'anthropic'; apiKey: string; model: string }
  | { kind: 'gemini'; apiKey: string; model: string }
  | { kind: 'openrouter'; apiKey: string; model: string }
  | { kind: 'custom'; apiKey: string; model: string; baseUrl: string };

/**
 * PRD 011 Req 16: the user action a request is attributable to. The field is
 * required and has no default, so an unattributable request — a background,
 * speculative or startup one — cannot be constructed. New callers add a value
 * here rather than omitting one.
 */
export type LlmTrigger = 'test-connection' | 'summarize';

/**
 * PRD 011 Req 11: the single request shape. Every provider builds its own wire
 * format from exactly this; callers never see a provider's own vocabulary.
 */
export interface LlmRequest {
  /** PRD 011 Req 16: the user action that caused this request. Required. */
  trigger: LlmTrigger;
  /** Instructions for the model — the app's, not user-editable. */
  system?: string;
  /** The text to act on. */
  prompt: string;
  /** Upper bound on generated tokens; every provider carries it in its own field. */
  maxOutputTokens: number;
}

/**
 * PRD 011 Req 32: what the provider said it spent — or, distinguishably, that
 * it said nothing. `known: false` is not `0` and not a guess, so a later
 * usage report can say "no usage data" rather than inventing a number.
 */
export type LlmUsage =
  | { known: true; inputTokens: number; outputTokens: number }
  | { known: false };

/** PRD 011 Req 32: the absent-usage value, stated once so no caller invents it. */
export const USAGE_UNKNOWN: LlmUsage = { known: false };

/**
 * PRD 011 Reqs 10+27: the failure taxonomy the settings area's test-connection
 * and the per-section summary failures both render. The first four are the
 * named kinds; `invalid-config` is a request that could not even be built
 * (a custom base URL that is not an absolute http(s) URL); `unexpected` is the
 * catch-all for anything else — an unexpected status, or a 200 whose body does
 * not parse into the shape the provider promised.
 */
export type LlmFailureKind =
  | 'bad-key'
  | 'unknown-model'
  | 'unreachable-host'
  | 'rate-limited'
  | 'invalid-config'
  | 'unexpected';

/**
 * PRD 011 Reqs 10+27: a failure as a value, never a thrown string. It carries a
 * short reader-facing sentence plus enough detail for a UI to say more.
 *
 * PRD 011 Req 7: no field here holds key material. `providerMessage` is passed
 * through the seam's redaction before it lands, so a provider that echoed the
 * key back cannot leak it into a message, a notice or a crash draft.
 */
export interface LlmFailure {
  kind: LlmFailureKind;
  /** One sentence, phrased for the reader. */
  message: string;
  /** The HTTP status, when there was a response at all. */
  status?: number;
  /** The provider's own explanation, redacted; absent when it gave none. */
  providerMessage?: string;
  /** PRD 011 Req 10: a `retry-after`-style hint, in seconds, when one was sent. */
  retryAfterSeconds?: number;
}

/**
 * PRD 011 Req 11: the single response shape. Success is text plus usage;
 * failure is one typed value from the taxonomy above. There is no third state
 * and no thrown alternative.
 */
export type LlmResponse =
  | { ok: true; text: string; usage: LlmUsage }
  | { ok: false; failure: LlmFailure };

/**
 * PRD 011 Req 12: a plain HTTP request, as data. Whoever sends it — the Rust
 * shell on desktop, the app's own server on hosted, a fake in tests — reads
 * these four fields and needs nothing else from the seam.
 */
export interface LlmHttpRequest {
  method: 'POST';
  /** Absolute `https://…` URL. PRD 011 Req 7: never carries the key. */
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** A plain HTTP response, as data: what a transport hands back. */
export interface LlmHttpResponse {
  status: number;
  body: string;
  /** Lower-cased header names; only the few a provider reads need be present. */
  headers?: Record<string, string>;
}

/**
 * PRD 011 Req 10: what a transport answers. `no-response` is a transport-level
 * failure — DNS, connection refused, timeout — where no HTTP exchange happened
 * at all; it classifies as an unreachable host rather than as a status.
 */
export type LlmTransportResult =
  | { kind: 'http'; response: LlmHttpResponse }
  | { kind: 'no-response'; detail?: string };

/**
 * PRD 011 Req 12+13: the injected send. Issue #112 supplies a Rust-backed one,
 * issue #113 a same-origin-proxy one, tests the local fake. A transport that
 * rejects is treated exactly like `no-response`.
 */
export type LlmTransport = (request: LlmHttpRequest) => Promise<LlmTransportResult>;

/**
 * PRD 011 Req 11: what a provider implementation is. Two pure functions —
 * build the wire request, read the wire response — and nothing public beyond
 * the seam's own types.
 */
export interface LlmProvider {
  /** Either the request to send, or the reason no request could be built. */
  buildRequest(config: LlmProviderConfig, request: LlmRequest): LlmHttpRequest | LlmFailure;
  /** Turn one HTTP response into the seam's response, success or typed failure. */
  readResponse(response: LlmHttpResponse): LlmResponse;
}

/**
 * PRD 011 Req 7: the key appears only in request headers. Anything the seam
 * hands back to a human goes through here first, so a provider that quoted the
 * key in its error body cannot put it in a message, and a serialized failure
 * cannot carry it either.
 */
export function redactKey(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join('[redacted]');
}

/** PRD 011 Req 10: the sentence a reader sees when the transport never got a reply. */
export const UNREACHABLE_MESSAGE = 'Could not reach the provider. Check your network connection.';

/**
 * PRD 011 Req 11: the seam's one entry point. It takes the transport, the
 * active provider config and a request, and answers the single response type —
 * success or a typed failure, never a throw.
 *
 * PRD 011 Req 16: nothing calls this but a caller acting on `request.trigger`.
 */
export async function runLlmRequest(
  transport: LlmTransport,
  config: LlmProviderConfig,
  request: LlmRequest,
): Promise<LlmResponse> {
  // PRD 011 Req 7: no failure leaves here unredacted, whichever step produced it.
  const fail = (failure: LlmFailure): LlmResponse => ({
    ok: false,
    failure: redactFailure(failure, config.apiKey),
  });

  const provider = providerFor(config.kind);
  // A provider answers either the descriptor to send or the reason it could
  // not build one; only the failure carries a `kind`.
  const built = provider.buildRequest(config, request);
  if ('kind' in built) return fail(built);

  let result: LlmTransportResult;
  try {
    result = await transport(built);
  } catch (error) {
    // PRD 011 Req 10: a transport that rejects reported no HTTP response, so
    // it is the same unreachable host as an explicit `no-response`.
    result = { kind: 'no-response', detail: errorDetail(error) };
  }

  if (result.kind === 'no-response') {
    return fail({
      kind: 'unreachable-host',
      message: UNREACHABLE_MESSAGE,
      ...(result.detail ? { providerMessage: result.detail } : {}),
    });
  }

  const response = provider.readResponse(result.response);
  return response.ok ? response : fail(response.failure);
}

/** PRD 011 Req 7: every human-readable field of a failure, redacted. */
function redactFailure(failure: LlmFailure, apiKey: string): LlmFailure {
  return {
    ...failure,
    message: redactKey(failure.message, apiKey),
    ...(failure.providerMessage === undefined
      ? {}
      : { providerMessage: redactKey(failure.providerMessage, apiKey) }),
  };
}

/** A rejected transport's reason as a short string, without assuming an Error. */
function errorDetail(error: unknown): string | undefined {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return undefined;
}
