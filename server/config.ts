// PRD 007 Req 1: all configuration arrives via environment variables so the
// same code starts locally and on Azure App Service (Linux) unchanged. Req 4:
// MM_MODE selects the provider wiring — 'local' (Azurite storage + mock
// auth/directory, the offline dev mode) or 'azure' (Entra ID + Blob Storage +
// Graph). Pure parsing, no I/O, so the unit suite can pin every branch.

import type { LlmProviderConfig, LlmProviderKind } from '../src/lib/llmSeam.ts';

export type ServerMode = 'local' | 'azure';

/**
 * Azurite's well-known dev-storage connection string (the documented
 * devstoreaccount1 account every Azure tool ships): the local mode default,
 * so `npm run server:local` needs zero configuration.
 */
export const AZURITE_CONNECTION_STRING =
  'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;' +
  'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;' +
  'BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;';

export interface ServerConfig {
  mode: ServerMode;
  /** Port to listen on. App Service supplies PORT; local default is 4924. */
  port: number;
  /** Directory the built SPA is served from. */
  staticDir: string;
  storage: {
    /** Blob Storage (or Azurite) connection string. */
    connectionString: string;
    /** Container all files live in. */
    container: string;
  };
  /** Entra ID + Graph settings — present only in azure mode. */
  azure?: {
    tenantId: string;
    clientId: string;
    /**
     * PRD 007 Req 6 (issue #180): the confidential-client credential the
     * on-behalf-of Graph token exchange authenticates with. Like
     * MM_LLM_API_KEY, its value never appears in any log line, error
     * message, or HTTP response — refusals name the variable, never its
     * content.
     */
    clientSecret: string;
  };
  /**
   * PRD 011 Req 8: the deployment-wide LLM credential, configured by the
   * operator at deploy time. Optional in every mode and absent unless
   * configured — a deployment that names none of the `MM_LLM_*` variables
   * simply has no LLM features. It is the seam's own `LlmProviderConfig`
   * (src/lib/llmSeam.ts), not a second copy of it: exactly one provider is
   * active, structurally.
   */
  llm?: LlmProviderConfig;
  /**
   * PRD 017 Req 1: the deployment admins' user ids, parsed from `MM_ADMINS`.
   * Empty means the deployment has no admins and every admin surface in PRD
   * 017 is simply absent. Ids are not secrets but are never logged either —
   * startup output reports only the count.
   */
  admins: readonly string[];
}

/** Env vars azure mode cannot start without (PRD 007 Req 1). */
const AZURE_REQUIRED = [
  'ENTRA_TENANT_ID',
  'ENTRA_CLIENT_ID',
  'ENTRA_CLIENT_SECRET',
  'AZURE_STORAGE_CONNECTION_STRING',
] as const;

/**
 * PRD 007 Req 1: where bytes live — Azurite's dev connection string as the
 * local default, azure mode supplying its own (a missing one is `loadConfig`'s
 * named refusal below).
 */
function loadStorage(env: Record<string, string | undefined>, mode: ServerMode): ServerConfig['storage'] {
  const container = env.MM_STORAGE_CONTAINER ?? 'marky-mark';
  const fallback = mode === 'local' ? AZURITE_CONNECTION_STRING : '';
  return { connectionString: env.AZURE_STORAGE_CONNECTION_STRING ?? fallback, container };
}

/**
 * PRD 011 Req 8: the LLM section's environment variables — the whole set, in
 * the order an operator meets them. Exported so the hosting guide's drift
 * guard (U536) can assert the document still names every one of them.
 */
export const LLM_ENV_VARS = [
  'MM_LLM_PROVIDER',
  'MM_LLM_MODEL',
  'MM_LLM_API_KEY',
  'MM_LLM_BASE_URL',
] as const;

/** …of which these three are what any configured LLM section cannot omit. */
export const LLM_REQUIRED = ['MM_LLM_PROVIDER', 'MM_LLM_MODEL', 'MM_LLM_API_KEY'] as const;

/** PRD 011 Req 5: the five kinds, as values, for parsing one out of the env. */
const LLM_PROVIDER_KINDS: readonly LlmProviderKind[] = [
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'custom',
];

/**
 * PRD 011 Req 8: the optional LLM section — absent unless configured, and
 * refused BY NAME when it is half-configured or malformed. Two rules hold
 * throughout:
 *
 *  - no default provider, no default model, no default key. A deployment that
 *    sets none of {@link LLM_ENV_VARS} gets `undefined`, which is what makes
 *    "this deployment has no LLM" a real state rather than a broken one.
 *  - PRD 011 Req 7: no message here — and no log line anywhere in `server/` —
 *    contains the key value. Refusals name the *variable*, never its content,
 *    which is why the unparseable-key branch below quotes the provider kind
 *    and the base URL but never `MM_LLM_API_KEY`.
 */
function loadLlmConfig(env: Record<string, string | undefined>): LlmProviderConfig | undefined {
  const kind = env.MM_LLM_PROVIDER?.trim();
  const model = env.MM_LLM_MODEL?.trim();
  const apiKey = env.MM_LLM_API_KEY?.trim();
  const baseUrl = env.MM_LLM_BASE_URL?.trim();
  if (!kind && !model && !apiKey && !baseUrl) return undefined;

  // Every gap at once, so an operator sees the whole list in one restart.
  const missing = LLM_REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(`LLM configuration is incomplete, missing: ${missing.join(', ')}`);
  }
  if (!isLlmProviderKind(kind)) {
    throw new Error(
      `MM_LLM_PROVIDER must be one of ${LLM_PROVIDER_KINDS.join(', ')}, got '${kind}'`,
    );
  }
  // PRD 011 Req 5: the custom kind is the ONLY one with an endpoint to point
  // at; naming a base URL for a hosted provider would silently do nothing.
  if (kind !== 'custom') {
    if (baseUrl) throw new Error(`MM_LLM_BASE_URL applies only to MM_LLM_PROVIDER=custom, got '${kind}'`);
    return { kind, apiKey: apiKey!, model: model! };
  }
  if (!baseUrl) throw new Error('MM_LLM_PROVIDER=custom requires environment variables: MM_LLM_BASE_URL');
  if (!isAbsoluteHttpUrl(baseUrl)) {
    throw new Error(`MM_LLM_BASE_URL must be an absolute http(s) URL, got '${baseUrl}'`);
  }
  return { kind, apiKey: apiKey!, model: model!, baseUrl };
}

function isLlmProviderKind(value: string | undefined): value is LlmProviderKind {
  return LLM_PROVIDER_KINDS.includes(value as LlmProviderKind);
}

/** An absolute `http(s)` URL and nothing else — no relative path, no other scheme. */
function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * PRD 017 Req 1+25: the optional `MM_ADMINS` — a comma-separated list of user
 * ids (Entra object ids in azure mode, mock ids in local mode). Entries are
 * trimmed and empty entries dropped; an entry with interior whitespace is a
 * refusal naming the variable and every bad entry at once (a user id never
 * contains whitespace, so one flags a wrong separator, not an odd id). Local
 * mode defaults an UNSET variable to mock-katherine so `npm run server:local`
 * and the e2e lane have exactly one admin; setting `MM_ADMINS` — even to
 * empty — overrides that. Azure mode has no default: unset means no admins.
 */
function loadAdmins(env: Record<string, string | undefined>, mode: ServerMode): readonly string[] {
  const raw = env.MM_ADMINS;
  if (raw === undefined) return mode === 'local' ? ['mock-katherine'] : [];
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  const malformed = entries.filter((entry) => /\s/.test(entry));
  if (malformed.length) {
    throw new Error(
      `MM_ADMINS must be comma-separated user ids without whitespace, got: ${malformed
        .map((entry) => JSON.stringify(entry))
        .join(', ')}`,
    );
  }
  return entries;
}

/**
 * Parse a config from an environment. Throws with an actionable message —
 * naming the offending variable and every missing one at once — rather than
 * failing later with a vendor error.
 */
export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  const mode = env.MM_MODE ?? 'local';
  if (mode !== 'local' && mode !== 'azure') {
    throw new Error(`MM_MODE must be 'local' or 'azure', got '${mode}'`);
  }

  const rawPort = env.PORT ?? '4924';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a TCP port number, got '${rawPort}'`);
  }

  const staticDir = env.MM_STATIC_DIR ?? 'dist';
  // PRD 011 Req 8: parsed in both modes, required in neither.
  const llm = loadLlmConfig(env);
  const storage = loadStorage(env, mode);
  // PRD 017 Req 1: parsed in both modes; only local mode has a default.
  const admins = loadAdmins(env, mode);

  if (mode === 'local') {
    return { mode, port, staticDir, storage, admins, ...(llm ? { llm } : {}) };
  }

  const missing = AZURE_REQUIRED.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`MM_MODE=azure requires environment variables: ${missing.join(', ')}`);
  }
  return {
    mode,
    port,
    staticDir,
    storage,
    azure: {
      tenantId: env.ENTRA_TENANT_ID!,
      clientId: env.ENTRA_CLIENT_ID!,
      clientSecret: env.ENTRA_CLIENT_SECRET!,
    },
    admins,
    ...(llm ? { llm } : {}),
  };
}
