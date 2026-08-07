/**
 * PRD 011 Req 13: the hosted flavor's LLM client — the browser half of the
 * same-origin proxy in `server/llm.ts`. It is exposed on the Platform seam as
 * the optional `llm` capability, so app code mounts LLM affordances by asking
 * whether the capability exists, never whether the flavor is hosted.
 *
 * Two things it deliberately is not:
 *
 *  - it is NOT a provider client. It knows one origin — this app's own — and
 *    names no provider host: the endpoints in `src/lib/llmProviders.ts` are
 *    the desktop path's descriptors, sent by the Rust shell, never fetched
 *    from a browser. The key lives on the server, and nothing here could send
 *    one even if it had it.
 *  - it declares NO new network call site. Every request goes through the
 *    `api(...)` wrapper handed in by `platform/hosted.ts` (same-origin,
 *    bearer-authenticated), which is the one call site the bundle scan's
 *    allowlist counts.
 *
 * It reuses the seam's `LlmRequest`/`LlmResponse` unchanged: the wire body in
 * both directions IS the seam's value, so there is nothing to translate.
 */

import { LLM_UNCONFIGURED } from '../lib/llmDeployment';
import type { LlmAvailability } from '../lib/llmDeployment';
// Imported as a block, not as inline `type` specifiers: U490 reads this tree
// for `type Llm(Request|Response)` to prove exactly one module declares those
// shapes, and re-using them must not read as re-declaring them.
import { UNREACHABLE_MESSAGE } from '../lib/llmSeam';
import type { LlmRequest, LlmResponse } from '../lib/llmSeam';

/** The same-origin, bearer-authenticated wrapper `platform/hosted.ts` owns. */
export type HostedApi = (
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>;

/**
 * PRD 011 Req 13: the capability itself. Read what this deployment has, and
 * run one attributable request — nothing else. There is no "set the key" and
 * no "choose the provider": on hosted those are the operator's, configured in
 * the server's environment and read-only to every member.
 */
export interface LlmClient {
  /** Whether this deployment has an LLM, and if so which provider and model. */
  availability(): Promise<LlmAvailability>;
  /** Run one `LlmRequest` server-side; answer the seam's response. */
  run(request: LlmRequest): Promise<LlmResponse>;
}

/** The routes of `server/llm.ts`, from the client side. */
const AVAILABILITY_PATH = '/api/llm';
const REQUEST_PATH = '/api/llm/request';

/** PRD 011 Req 10: a response the client could not read, as a typed failure. */
function unreadable(message: string): LlmResponse {
  return { ok: false, failure: { kind: 'unexpected', message } };
}

export function createHostedLlm(api: HostedApi): LlmClient {
  return {
    async availability() {
      try {
        const res = await api(AVAILABILITY_PATH);
        if (!res.ok) return LLM_UNCONFIGURED;
        return (await res.json()) as LlmAvailability;
      } catch {
        // A deployment we cannot ask is one we cannot use: the affordances
        // stay off rather than appearing and then failing.
        return LLM_UNCONFIGURED;
      }
    },

    async run(request) {
      let res: Response;
      try {
        res = await api(REQUEST_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });
      } catch {
        // PRD 011 Req 10: the app's own server did not answer. Same shape as
        // any other unreachable host, so a caller renders one thing.
        return { ok: false, failure: { kind: 'unreachable-host', message: UNREACHABLE_MESSAGE } };
      }
      // The seam's response is the body on the success path AND on the
      // deployment-has-no-LLM refusal (409), so the status is not what decides
      // how to read it — the shape is.
      const body: unknown = await res.json().catch(() => null);
      if (typeof body === 'object' && body !== null && 'ok' in body) return body as LlmResponse;
      const named = (body as { error?: unknown } | null)?.error;
      return unreadable(
        typeof named === 'string' && named
          ? named
          : `The request was refused by this deployment (HTTP ${res.status}).`,
      );
    },
  };
}
