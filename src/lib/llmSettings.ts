/**
 * PRD 011 Reqs 5+6+9+10: everything the LLM providers settings area decides,
 * as pure data and pure functions. The React panel (`components/LlmSettings`)
 * renders what this module answers and holds no rules of its own, so the
 * "which providers exist", "what is configured", "is it available and why not"
 * and "what does a test connection send" questions are all unit-testable
 * without a DOM, a platform or a network.
 *
 * It declares no request, response, provider-config or availability shape of
 * its own: those belong to the seam (`llmSeam.ts`) and the deployment boundary
 * (`llmDeployment.ts`), and are imported and re-used as they are.
 *
 * PRD 011 Req 16: importing this module does nothing — one record, two
 * constants and pure functions. Nothing here performs I/O; the single request
 * it describes is only sent when a caller passes a runner to
 * {@link testConnection} on behalf of a user action.
 */

import { NO_LLM_CONFIGURED_MESSAGE, type LlmAvailability } from './llmDeployment';
import { customEndpoint } from './llmProviders';
import type {
  LlmFailure,
  LlmProviderConfig,
  LlmProviderKind,
  LlmRequest,
  LlmResponse,
} from './llmSeam';

/**
 * PRD 011 Reqs 5+6: the provider chooser's data, keyed by the seam's own union.
 * Exhaustive by construction — adding a kind to `LlmProviderKind` fails the
 * typecheck until it is named here, and naming one the seam does not have fails
 * too. This is the ONLY list of provider kinds in `src/` outside the seam.
 *
 * `models` is a SHORT curated list of known-good ids per provider, not a
 * catalogue: it is a starting point beside the free-text field, never a
 * constraint (PRD 011 Req 6 — a new model must never require an app release).
 */
export const LLM_PROVIDERS: Record<
  LlmProviderKind,
  { label: string; models: readonly string[] }
> = {
  anthropic: {
    label: 'Anthropic',
    // Current ids, taken from the `claude-api` skill rather than from memory.
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-opus-4-8'],
  },
  openai: {
    label: 'OpenAI',
    models: ['gpt-5.1', 'gpt-5', 'gpt-4.1', 'gpt-4o-mini'],
  },
  gemini: {
    label: 'Google Gemini',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  },
  openrouter: {
    label: 'OpenRouter',
    // OpenRouter addresses models as `vendor/model` slugs.
    models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-4.1', 'google/gemini-2.5-pro'],
  },
  custom: {
    // PRD 011 Req 5: a base URL the user points at themselves, so there is no
    // catalogue to curate — the endpoint decides which ids it accepts.
    label: 'Custom (OpenAI-compatible)',
    models: [],
  },
};

/** The five kinds as values, in the order the chooser offers them. */
export const LLM_PROVIDER_KINDS = Object.keys(LLM_PROVIDERS) as LlmProviderKind[];

/** PRD 011 Req 5: is this untrusted value one of the seam's provider kinds? */
export function isLlmProviderKind(value: unknown): value is LlmProviderKind {
  return typeof value === 'string' && Object.hasOwn(LLM_PROVIDERS, value);
}

/**
 * PRD 011 Req 5: the persisted shape the area reads and writes — the four
 * `Settings` keys, named structurally so this module stays independent of
 * `settings.ts` (which imports the validator above).
 */
export interface LlmSettingsValues {
  llmProvider: LlmProviderKind;
  llmModel: string;
  llmApiKey: string;
  llmBaseUrl: string;
}

/**
 * PRD 011 Req 5: what the settings resolve to — exactly ONE active provider
 * config, never a set, list or map. Whitespace around a typed model id or base
 * URL is the user's typing, not their intent, so it is trimmed here; the raw
 * setting is stored unchanged so a round trip preserves what was entered.
 */
export function resolveLlmProvider(values: LlmSettingsValues): LlmProviderConfig {
  const apiKey = values.llmApiKey;
  const model = values.llmModel.trim();
  switch (values.llmProvider) {
    case 'custom':
      return { kind: 'custom', apiKey, model, baseUrl: values.llmBaseUrl.trim() };
    default:
      return { kind: values.llmProvider, apiKey, model };
  }
}

/**
 * PRD 011 Req 9: what the two platform capabilities say, as plain data. The
 * area branches on THESE — never on `platform.kind` — so the static web build
 * (neither capability) and a desktop build without a transport reach the same
 * "no LLM path" answer by the same route.
 */
export interface LlmCapabilities {
  /** Desktop: a transport exists in the window that owns it (`llmTransport`). */
  transport: boolean;
  /** Hosted: what the deployment answered, or null when there is no `llm` client. */
  hosted: LlmAvailability | null;
}

/** PRD 011 Req 9: why a desktop configuration cannot be used yet. */
export type LlmMissing = 'key' | 'model' | 'base-url';

/**
 * PRD 011 Req 9: the area's availability, and its reason, in the reader's
 * words. Every state carries the sentence it renders, so the panel never
 * composes a second one and a test can assert the wording as data.
 */
export type LlmAreaState =
  /** Neither capability — the static web build. No control can work here. */
  | { state: 'no-path'; message: string }
  /** Hosted, `configured: false` — the operator's job, not the reader's. */
  | { state: 'operator-unconfigured'; message: string }
  /** Hosted, `configured: true` — the operator's provider and model, read-only. */
  | { state: 'hosted'; provider: LlmProviderKind; model: string; message: string }
  /** Desktop, something still missing. */
  | { state: 'unconfigured'; missing: LlmMissing; message: string }
  /** Desktop, configured — the one active config, ready to send. */
  | { state: 'ready'; config: LlmProviderConfig; message: string };

/** PRD 011 Req 9: the static-web sentence. Stated once so no caller invents one. */
export const NO_LLM_PLATFORM_MESSAGE =
  'LLM features are unavailable on this platform. Use the desktop app, or a hosted deployment whose operator has configured a provider.';

/** PRD 011 Req 9: the desktop sentences — each says what to do next. */
export const NO_KEY_MESSAGE = 'No API key configured. Paste a key for this provider to enable LLM features.';
export const NO_MODEL_MESSAGE = 'No model chosen. Pick one from the list, or type any model id this provider accepts.';
export const READY_MESSAGE = 'Ready. Test the connection to confirm the key and model work.';

/** PRD 011 Req 9: the hosted-and-configured sentence, naming what is in use. */
export function hostedReadyMessage(provider: LlmProviderKind, model: string): string {
  return `This deployment's operator configured ${LLM_PROVIDERS[provider].label} (${model}). The provider and key are theirs, not yours.`;
}

/**
 * PRD 011 Req 9: availability from plain inputs. Hosted wins when a hosted
 * client exists (the credential is the operator's and the reader has no key to
 * supply); otherwise a desktop transport plus a complete configuration is the
 * only path to `ready`.
 *
 * PRD 011 Req 5: an empty or whitespace-only model is NOT a valid
 * configuration — it reports unavailable rather than sending a request that
 * cannot work. Same for a `custom` base URL the seam cannot turn into an
 * endpoint, which is reported through the seam's own `customEndpoint` /
 * `INVALID_BASE_URL_MESSAGE` rather than a second URL validator.
 */
export function llmAreaState(capabilities: LlmCapabilities, values: LlmSettingsValues): LlmAreaState {
  const { transport, hosted } = capabilities;
  if (hosted) {
    return hosted.configured
      ? {
          state: 'hosted',
          provider: hosted.provider,
          model: hosted.model,
          message: hostedReadyMessage(hosted.provider, hosted.model),
        }
      : { state: 'operator-unconfigured', message: NO_LLM_CONFIGURED_MESSAGE };
  }
  if (!transport) return { state: 'no-path', message: NO_LLM_PLATFORM_MESSAGE };

  const config = resolveLlmProvider(values);
  if (!config.apiKey) return { state: 'unconfigured', missing: 'key', message: NO_KEY_MESSAGE };
  if (!config.model) return { state: 'unconfigured', missing: 'model', message: NO_MODEL_MESSAGE };
  if (config.kind === 'custom') {
    const endpoint = customEndpoint(config.baseUrl);
    // `customEndpoint` answers the URL or the seam's own typed refusal; only
    // the failure carries a `kind`.
    if (typeof endpoint !== 'string') {
      return { state: 'unconfigured', missing: 'base-url', message: endpoint.message };
    }
  }
  return { state: 'ready', config, message: READY_MESSAGE };
}

/** PRD 011 Req 9: can a test connection run at all in this state? */
export function canTestConnection(state: LlmAreaState): boolean {
  return state.state === 'ready' || state.state === 'hosted';
}

/**
 * PRD 011 Req 10: the ONE test-connection request, built once. Every path —
 * desktop through the seam, hosted through the app's own server, the aux
 * window's round trip — sends exactly this, so there is no second
 * request-building path to keep in step.
 *
 * It is deliberately cheap: a one-word prompt and a tiny output cap, because
 * its only job is to prove the key, model and host answer at all.
 */
export const TEST_CONNECTION_REQUEST: LlmRequest = {
  trigger: 'test-connection',
  system: 'Reply with the single word OK.',
  prompt: 'ping',
  maxOutputTokens: 16,
};

/**
 * PRD 011 Req 10: what a test connection reports. A NARROWED `LlmResponse` —
 * the generated text is dropped, so what crosses the desktop aux bus is a
 * verdict plus the seam's already-redacted failure and never key material or
 * raw provider text (PRD 011 Req 7).
 */
export type LlmTestResult = { ok: true } | { ok: false; failure: LlmFailure };

/** Whoever actually sends the request: the seam on desktop, the client on hosted. */
export type LlmRunner = (request: LlmRequest) => Promise<LlmResponse>;

/**
 * PRD 011 Req 10: run exactly one request and narrow the answer. One call to
 * `run` per invocation — nothing retries, and nothing here fires on import, on
 * mount or on a settings change; only a caller acting on the user's click does.
 */
export async function testConnection(run: LlmRunner): Promise<LlmTestResult> {
  const response = await run(TEST_CONNECTION_REQUEST);
  return response.ok ? { ok: true } : { ok: false, failure: response.failure };
}

/**
 * PRD 011 Req 10: the failure sentence a reader sees — the seam's own message,
 * plus the provider's retry hint when it sent one. No call site writes a
 * sentence per failure kind.
 */
export function testFailureMessage(failure: LlmFailure): string {
  return failure.retryAfterSeconds === undefined
    ? failure.message
    : `${failure.message} (retry in ${failure.retryAfterSeconds}s)`;
}
