// PRD 011 Req 8+13: the hosted deployment's LLM surface — the ONLY place in a
// hosted install where a provider is contacted. The browser never holds the
// key and never sees a provider host: it posts the seam's `LlmRequest` to this
// app's own origin and reads back the seam's `LlmResponse`, and the whole of
// `runLlmRequest` (src/lib/llmSeam.ts) runs here, server-side, with the
// operator's configuration.
//
// The surface is two routes and no more:
//
//   GET  /api/llm          — is an LLM configured, and if so which provider
//                            kind and model? Makes no outbound request.
//   POST /api/llm/request  — run one attributable request; answer the seam's
//                            response, success or one typed failure.
//
// PRD 011 Req 7: no route accepts a key, a provider kind, a model or a base
// URL from a client — the configuration is read-only to the browser, and the
// key value appears in no payload, no message and no log line here.
//
// PRD 011 Req 16: nothing in this module runs on import, on server start or on
// sign-in. The only outbound call is the one a POST carrying a `trigger` asks
// for, and the transport is injected (`fetchImpl` below) so no test performs
// real network I/O.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, sendJson } from './http.ts';
import {
  LLM_UNCONFIGURED,
  noLlmConfiguredResponse,
  parseLlmRequest,
  type LlmAvailability,
} from '../src/lib/llmDeployment.ts';
import {
  redactKey,
  runLlmRequest,
  type LlmProviderConfig,
  type LlmResponse,
  type LlmTransport,
  type LlmTransportResult,
} from '../src/lib/llmSeam.ts';

/** A `fetch`-shaped transport, injectable so tests never touch the network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** The route prefix this module owns. */
export const LLM_PREFIX = '/api/llm';

/** The sub-path one attributable request is posted to. */
export const LLM_REQUEST_PATH = '/request';

export interface LlmApiOptions {
  /**
   * PRD 011 Req 8: the operator's configuration, straight from
   * `loadConfig(...).llm`. Absent ⇒ this deployment has no LLM, which every
   * route below answers honestly rather than 500ing.
   */
  config?: LlmProviderConfig;
  /** PRD 011 Req 13: the injected send; defaults to the platform `fetch`. */
  fetchImpl?: FetchLike;
}

export interface LlmApi {
  /** PRD 011 Req 13: what a member may know about the deployment's LLM. */
  availability(): LlmAvailability;
  /** Handle a request under {@link LLM_PREFIX}. */
  handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void>;
}

/**
 * PRD 011 Req 13: the seam's transport, over real HTTP. The descriptor a
 * provider built is sent verbatim and the reply is handed back as data — no
 * status is interpreted here, because classifying one is the provider
 * adapter's job and this must behave the same as the fake tests drive.
 */
function httpTransport(fetchImpl: FetchLike): LlmTransport {
  return async (request): Promise<LlmTransportResult> => {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    const headers: Record<string, string> = {};
    // The seam reads a couple of headers (`retry-after`) by lower-cased name.
    response.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    return { kind: 'http', response: { status: response.status, body: await response.text(), headers } };
  };
}

/**
 * PRD 011 Req 7: the last thing a response passes on its way to a browser that
 * — unlike the desktop's — does NOT hold the key and must never learn it. The
 * seam already redacts every failure it builds; this covers the one path it
 * deliberately leaves alone, a *success* whose generated text quoted the key
 * back (a model shown a key in its own error context can do exactly that). One
 * choke point, so "nothing leaving this route carries the key" is checkable at
 * a single line rather than argued per field.
 */
function withoutKey(response: LlmResponse, apiKey: string): LlmResponse {
  return response.ok ? { ...response, text: redactKey(response.text, apiKey) } : response;
}

export function createLlmApi(options: LlmApiOptions = {}): LlmApi {
  const { config } = options;
  // PRD 011 Req 16: built once, called never until a POST asks for it.
  const transport = httpTransport(options.fetchImpl ?? ((url, init) => fetch(url, init)));

  /**
   * PRD 011 Req 7: the availability payload is assembled field by field from
   * the config — never spread from it — so the key cannot ride along, today or
   * after a field is added to `LlmProviderConfig`.
   */
  const availability = (): LlmAvailability =>
    config ? { configured: true, provider: config.kind, model: config.model } : LLM_UNCONFIGURED;

  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const rest = url.pathname.slice(LLM_PREFIX.length);

    // PRD 011 Req 13: availability answers whatever the deployment looks like,
    // and contacts nothing to do it.
    if (rest === '' && req.method === 'GET') {
      sendJson(res, 200, availability());
      return;
    }

    if (rest === LLM_REQUEST_PATH && req.method === 'POST') {
      let body: unknown;
      try {
        body = JSON.parse((await readBody(req)) || 'null');
      } catch {
        sendJson(res, 400, { error: 'malformed JSON body' });
        return;
      }
      // PRD 011 Req 16: an unattributable or incomplete request is refused
      // before anything is sent — the provider is not contacted at all.
      const parsed = parseLlmRequest(body);
      if ('error' in parsed) {
        sendJson(res, 400, { error: parsed.error });
        return;
      }
      if (!config) {
        // PRD 011 Req 13: legible and typed, so #116 has something honest to
        // render — a named refusal in the seam's own response shape, not a
        // bare 500 and not a generic 404.
        sendJson(res, 409, noLlmConfiguredResponse());
        return;
      }
      // PRD 011 Req 11: the seam answers success or a typed failure and never
      // throws, so the response IS the payload — at 200 either way.
      sendJson(res, 200, withoutKey(await runLlmRequest(transport, config, parsed), config.apiKey));
      return;
    }

    sendJson(res, 404, { error: 'no such endpoint' });
  }

  return { availability, handle };
}
