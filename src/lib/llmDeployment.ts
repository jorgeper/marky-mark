/**
 * PRD 011 Req 8+13: what a *deployment's* LLM configuration looks like from
 * outside the server. Two values live here and nowhere else, because both the
 * server route (`server/llm.ts`) and the hosted client capability
 * (`src/platform/hostedLlm.ts`) have to agree on them exactly:
 *
 *  - {@link LlmAvailability} — everything a member is allowed to know: whether
 *    this deployment has an LLM at all and, if so, which provider kind and
 *    model. Deliberately NOT the credential, and deliberately not a shape a
 *    key could be added to later without an obvious diff (PRD 011 Req 7).
 *  - {@link noLlmConfiguredResponse} — the honest, typed refusal a request
 *    gets when the operator configured no provider, so the settings area
 *    (#116) can render a sentence rather than guess at a 404.
 *
 * It also holds {@link parseLlmRequest}: turning an untrusted JSON body back
 * into the seam's `LlmRequest` is the other half of the same boundary, and
 * doing it here keeps it pure and keeps the route handler thin.
 *
 * It declares no request, response or provider-config shape of its own: those
 * are the seam's (`llmSeam.ts`), imported here and re-used as they are.
 *
 * PRD 011 Req 16: importing this module does nothing — it holds one type, two
 * strings and two pure functions.
 */

import type { LlmProviderKind, LlmRequest, LlmResponse, LlmTrigger } from './llmSeam';

/**
 * PRD 011 Req 13: the availability answer. `configured: false` is a first-class
 * state, not an error: a deployment whose operator set no `MM_LLM_*` variables
 * says so plainly and every LLM affordance stays off.
 */
export type LlmAvailability =
  | { configured: false }
  | { configured: true; provider: LlmProviderKind; model: string };

/** The absent-LLM availability value, stated once so no caller invents one. */
export const LLM_UNCONFIGURED: LlmAvailability = { configured: false };

/**
 * PRD 011 Req 13: the sentence a reader sees when there is no provider to
 * call. It names what is missing (an operator's configuration) and who can fix
 * it, and it never mentions a variable's value.
 */
export const NO_LLM_CONFIGURED_MESSAGE =
  'This deployment has no LLM provider configured, so nothing can be summarized. ' +
  'Ask an operator to configure one.';

/**
 * PRD 011 Reqs 10+13: the unconfigured refusal as the seam's own response —
 * a typed `invalid-config` failure, the same value shape a real provider error
 * arrives as, so a caller has exactly one thing to render.
 */
export function noLlmConfiguredResponse(): LlmResponse {
  return { ok: false, failure: { kind: 'invalid-config', message: NO_LLM_CONFIGURED_MESSAGE } };
}

/**
 * PRD 011 Req 16: the allowed triggers, as values. A `Record` keyed by the
 * seam's own union rather than a hand-written array, so adding a trigger to
 * `LlmTrigger` fails to compile until it is named here, and naming one the
 * seam does not have fails too. Nothing else may widen the set.
 */
const TRIGGERS: Record<LlmTrigger, true> = { 'test-connection': true, summarize: true };

/** PRD 011 Req 16: is this untrusted value one of the seam's triggers? */
export function isLlmTrigger(value: unknown): value is LlmTrigger {
  return typeof value === 'string' && Object.hasOwn(TRIGGERS, value);
}

/**
 * PRD 011 Req 13+16: one untrusted JSON value read back as the seam's request,
 * or the sentence naming why it is not one. Every field is checked — an
 * unattributable request (no `trigger`, or one outside {@link TRIGGERS}) and a
 * request with nothing to act on are both refused HERE, before a provider is
 * ever reached, so no default silently supplies either.
 */
export function parseLlmRequest(value: unknown): LlmRequest | { error: string } {
  if (typeof value !== 'object' || value === null) return { error: 'expected a JSON object body' };
  const body = value as Record<string, unknown>;
  if (!isLlmTrigger(body.trigger)) {
    return { error: `'trigger' must be one of ${Object.keys(TRIGGERS).join(', ')}` };
  }
  if (typeof body.prompt !== 'string' || !body.prompt) return { error: "'prompt' must be a non-empty string" };
  const maxOutputTokens = body.maxOutputTokens;
  if (typeof maxOutputTokens !== 'number' || !Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) {
    return { error: "'maxOutputTokens' must be a positive integer" };
  }
  if (body.system !== undefined && typeof body.system !== 'string') {
    return { error: "'system' must be a string when present" };
  }
  return {
    trigger: body.trigger,
    prompt: body.prompt,
    maxOutputTokens,
    ...(body.system === undefined ? {} : { system: body.system }),
  };
}
