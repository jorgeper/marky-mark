/**
 * PRD 011 Req 5: the custom OpenAI-compatible endpoint's URL normalizer, and
 * the one sentence that reports an unusable base URL.
 *
 * PRD 011 Req 14 (SPEC11 §3.2, amended by issue #114) is why this is its own
 * module rather than two more exports of `llmProviders.ts`. The settings area
 * validates a user-typed base URL (`llmSettings.ts`), and settings reach every
 * flavor — including the static web build, which must have **no LLM path at
 * all**. Importing the validator from `llmProviders.ts` would pull that
 * module's four provider hosts into the single-file page along with it
 * (`tests/unit/static-web-no-llm.test.ts` U558 fails the moment they land
 * there). This file names no provider and reaches no network: it is safe for
 * anything to import, and `llmProviders.ts` re-exports both names so the seam
 * still has exactly one custom-endpoint implementation.
 */

import type { LlmFailure } from './llmSeam.ts';

/** PRD 011 Req 5: the reader-facing sentence for a base URL the seam cannot use. */
export const INVALID_BASE_URL_MESSAGE =
  'The custom endpoint must be an absolute http:// or https:// URL.';

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
