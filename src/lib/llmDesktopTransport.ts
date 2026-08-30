/**
 * PRD 011 Req 12: the desktop half of the seam's transport, as pure logic. On
 * desktop the request leaves from the Rust shell — webview → IPC → Rust →
 * provider, exactly as the updater plugin already reaches its endpoint from the
 * host side — so the webview never opens an outbound connection and its CSP
 * keeps allowing only `ipc: http://ipc.localhost`.
 *
 * This module is the mapping and nothing else: `LlmHttpRequest` in, the Rust
 * command's argument shape out, the command's answer back into
 * `LlmTransportResult`. The `invoke` that carries it is injected, so per
 * `.sandcastle/CODING_STANDARDS.md` there is no `react`, no `@tauri-apps/*` and
 * no `src/components/` import here, and no network call site of any kind — the
 * real `invoke` is wired in `src/platform/tauri.ts`, the only file in `src/`
 * allowed to import Tauri.
 *
 * It defines no request or response type: `src/lib/llmSeam.ts` owns those and
 * they are exactly what crosses the IPC boundary.
 */

import type { LlmHttpResponse, LlmTransport } from './llmSeam.ts';

/** PRD 011 Req 12: the Rust command (`src-tauri/src/lib.rs`) that sends it. */
export const LLM_REQUEST_COMMAND = 'llm_request';

/**
 * PRD 011 Req 12: the shape of Tauri's `invoke`, taken as an argument so this
 * module is unit-testable with a fake and needs no Tauri runtime.
 */
export type LlmInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * PRD 011 Req 10: an answer that is not the exchange the command promised is
 * no exchange at all — the same unreachable host as a rejected invoke, never a
 * status invented on the provider's behalf.
 */
export const MALFORMED_ANSWER_DETAIL = 'The desktop shell returned an unreadable reply.';

/**
 * PRD 011 Req 12: build the desktop `LlmTransport` from an `invoke`. A non-2xx
 * status is not a failure here — it comes back as `{ kind: 'http' }` with its
 * status and body so the provider adapters can classify it (401/403 → bad key,
 * 404 → unknown model, 429 → rate limited). Only a call where no HTTP exchange
 * happened — DNS, connection refused, TLS, timeout, a refused input — rejects,
 * and that is `{ kind: 'no-response' }`, Req 10's unreachable host.
 *
 * PRD 011 Req 7: the request is passed through untouched and nothing is kept:
 * no header, no body and no key is stored, logged or copied anywhere.
 */
export function createDesktopLlmTransport(invoke: LlmInvoke): LlmTransport {
  return async (request) => {
    let answer: unknown;
    try {
      answer = await invoke(LLM_REQUEST_COMMAND, {
        request: {
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: request.body,
        },
      });
    } catch (error) {
      const detail = errorDetail(error);
      return { kind: 'no-response', ...(detail ? { detail } : {}) };
    }
    const response = asHttpResponse(answer);
    return response
      ? { kind: 'http', response }
      : { kind: 'no-response', detail: MALFORMED_ANSWER_DETAIL };
  };
}

/**
 * The command's answer read defensively: a status, a body, and the header names
 * lower-cased again on this side so `llmProviders.ts`'s `retry-after` lookup
 * holds however the value crossed the boundary.
 */
function asHttpResponse(answer: unknown): LlmHttpResponse | undefined {
  if (typeof answer !== 'object' || answer === null) return undefined;
  const { status, body, headers } = answer as Record<string, unknown>;
  if (typeof status !== 'number' || !Number.isFinite(status)) return undefined;
  if (typeof body !== 'string') return undefined;
  return { status, body, headers: lowerCased(headers) };
}

function lowerCased(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof headers !== 'object' || headers === null) return out;
  for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof value === 'string') out[name.toLowerCase()] = value;
  }
  return out;
}

/** A rejected invoke's reason as a short string, without assuming an Error. */
function errorDetail(error: unknown): string | undefined {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return undefined;
}
