// PRD 007 Req 1: all configuration arrives via environment variables so the
// same code starts locally and on Azure App Service (Linux) unchanged. Req 4:
// MM_MODE selects the provider wiring — 'local' (Azurite storage + mock
// auth/directory, the offline dev mode) or 'azure' (Entra ID + Blob Storage +
// Graph). Pure parsing, no I/O, so the unit suite can pin every branch.

import { GITHUB_API_BASE, normalizeGitHubPrivateKey } from './providers/github/auth.ts';

export type ServerMode = 'local' | 'azure';

/**
 * PRD 010 Req 1: which storage backend the deployment defaults to, read from
 * `MM_STORAGE_BACKEND`. Deliberately ORTHOGONAL to {@link ServerMode}: mode
 * picks auth + directory (mock vs Entra/Graph), this picks where bytes live,
 * and all four combinations are legal — a local developer may point at a
 * GitHub repo, and an azure deployment may stay on Blob Storage.
 */
export type StorageBackend = 'blob' | 'github';

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
  /** PRD 010 Req 1: the deployment-default storage backend. */
  storageBackend: StorageBackend;
  /** Port to listen on. App Service supplies PORT; local default is 4924. */
  port: number;
  /** Directory the built SPA is served from. */
  staticDir: string;
  storage: {
    /**
     * Blob Storage (or Azurite) connection string. PRD 010 Req 1: absent on
     * the github backend — a deployment with no Azure storage account at all
     * carries no fabricated connection string, it carries none.
     */
    connectionString?: string;
    /** Container all files live in. */
    container: string;
  };
  /** Entra ID + Graph settings — present only in azure mode. */
  azure?: {
    tenantId: string;
    clientId: string;
  };
  /**
   * PRD 010 Req 4: the deployment's GitHub App credentials. Optional in
   * every mode — no mode requires them; only `storageBackend: 'github'`
   * does (Req 1). Present only when configured.
   */
  github?: {
    appId: string;
    /** PEM private key, newlines already un-escaped. */
    privateKey: string;
    apiBase: string;
    /**
     * PRD 010 Req 5: the deployment-default repo — where workspaces the
     * operator has not connected elsewhere are stored. Present only when
     * configured; required when the backend knob says `github`.
     */
    defaultRepo?: GitHubRepoTarget;
  };
}

/** PRD 010 Req 5: one repo branch (and optional prefix) to store under. */
export interface GitHubRepoTarget {
  owner: string;
  repo: string;
  branch: string;
  /** Repo-relative prefix; absent means the repo root. */
  root?: string;
}

/** Env vars azure mode cannot start without, whatever the storage backend. */
const AZURE_REQUIRED = ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID'] as const;

/** …plus the storage account, which only the blob backend needs (Req 1). */
const AZURE_BLOB_REQUIRED = [...AZURE_REQUIRED, 'AZURE_STORAGE_CONNECTION_STRING'] as const;

/**
 * PRD 010 Req 1: what the github backend cannot start without — the App
 * credentials of Req 4 and the default repo of Req 5. Named all at once when
 * any are missing, the way `AZURE_REQUIRED` is.
 */
const GITHUB_BACKEND_REQUIRED = ['MM_GITHUB_APP_ID', 'MM_GITHUB_PRIVATE_KEY', 'MM_GITHUB_DEFAULT_REPO'] as const;

/** `owner/repo` — exactly one pair, no URL, no third segment (Req 5). */
const OWNER_REPO_RE = /^[^/\s]+\/[^/\s]+$/;

/**
 * PRD 010 Req 5: the deployment-default repo, configured as `owner/repo` and
 * NEVER as a URL — the host of the API lives in exactly one place
 * (`GITHUB_API_BASE`), and U370 fails the build if a second appears.
 */
function loadDefaultRepo(env: Record<string, string | undefined>): GitHubRepoTarget | undefined {
  const target = env.MM_GITHUB_DEFAULT_REPO?.trim();
  const branch = env.MM_GITHUB_DEFAULT_BRANCH?.trim();
  const root = env.MM_GITHUB_DEFAULT_ROOT?.trim().replace(/^\/+|\/+$/g, '');
  if (!target) {
    if (branch || root) {
      throw new Error('MM_GITHUB_DEFAULT_BRANCH/MM_GITHUB_DEFAULT_ROOT need MM_GITHUB_DEFAULT_REPO');
    }
    return undefined;
  }
  if (!OWNER_REPO_RE.test(target)) {
    throw new Error(`MM_GITHUB_DEFAULT_REPO must be one 'owner/repo' pair, got '${target}'`);
  }
  const [owner, repo] = target.split('/');
  // PRD 010 Req 5: one branch for the whole deployment — no per-workspace
  // branch anywhere in this backend.
  return { owner, repo, branch: branch || 'main', ...(root ? { root } : {}) };
}

/**
 * PRD 010 Req 1: where bytes live. The blob backend is today's rule exactly —
 * Azurite's dev connection string as the local default, azure mode supplying
 * its own (a missing one is `loadConfig`'s named refusal below). The github
 * backend needs no Azure storage account at all, so the config carries no
 * connection string rather than a fabricated one.
 */
function loadStorage(
  env: Record<string, string | undefined>,
  mode: ServerMode,
  backend: StorageBackend,
): ServerConfig['storage'] {
  const container = env.MM_STORAGE_CONTAINER ?? 'marky-mark';
  if (backend === 'github') return { container };
  const fallback = mode === 'local' ? AZURITE_CONNECTION_STRING : undefined;
  return { connectionString: env.AZURE_STORAGE_CONNECTION_STRING ?? fallback, container };
}

/**
 * PRD 010 Req 4: the optional GitHub App section. App ID + private key are
 * the ONLY credential inputs — no PAT and no long-lived repo token is read
 * here or anywhere else in `server/`. Absent unless configured; malformed
 * when present is rejected by name, and never by echoing the key material.
 */
function loadGitHubConfig(env: Record<string, string | undefined>): ServerConfig['github'] {
  const appId = env.MM_GITHUB_APP_ID?.trim();
  const privateKey = env.MM_GITHUB_PRIVATE_KEY;
  const apiBase = env.MM_GITHUB_API_BASE?.trim();
  // PRD 010 Req 5: the default repo is part of this section — naming it
  // without the credentials is the same "incomplete" refusal below.
  const defaultRepo = loadDefaultRepo(env);
  if (!appId && !privateKey && !apiBase && !defaultRepo) return undefined;

  if (!appId || !privateKey) {
    const missing = [
      ...(appId ? [] : ['MM_GITHUB_APP_ID']),
      ...(privateKey ? [] : ['MM_GITHUB_PRIVATE_KEY']),
    ];
    throw new Error(`GitHub App configuration is incomplete, missing: ${missing.join(', ')}`);
  }
  if (!/^\d+$/.test(appId)) {
    throw new Error(`MM_GITHUB_APP_ID must be the numeric GitHub App id, got '${appId}'`);
  }
  let key: string;
  try {
    key = normalizeGitHubPrivateKey(privateKey);
  } catch (err) {
    // The message names the variable and the expected shape — never the value.
    throw new Error(`MM_GITHUB_PRIVATE_KEY is ${(err as Error).message}`);
  }
  if (apiBase) {
    try {
      new URL(apiBase);
    } catch {
      throw new Error(`MM_GITHUB_API_BASE must be an absolute URL, got '${apiBase}'`);
    }
  }
  return {
    appId,
    privateKey: key,
    apiBase: apiBase || GITHUB_API_BASE,
    ...(defaultRepo ? { defaultRepo } : {}),
  };
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

  // PRD 010 Req 1: the backend knob — its own variable, parsed on its own,
  // with no bearing on `mode` and no opinion from it.
  const storageBackend = env.MM_STORAGE_BACKEND ?? 'blob';
  if (storageBackend !== 'blob' && storageBackend !== 'github') {
    throw new Error(`MM_STORAGE_BACKEND must be 'blob' or 'github', got '${storageBackend}'`);
  }
  if (storageBackend === 'github') {
    // Named all at once, before the per-variable format checks below, so an
    // operator sees every gap in one run rather than one per restart.
    const absent = GITHUB_BACKEND_REQUIRED.filter((name) => !env[name]?.trim());
    if (absent.length) {
      throw new Error(`MM_STORAGE_BACKEND=github requires environment variables: ${absent.join(', ')}`);
    }
  }

  const staticDir = env.MM_STATIC_DIR ?? 'dist';
  // PRD 010 Req 4: parsed in both modes, required in neither.
  const github = loadGitHubConfig(env);
  const storage = loadStorage(env, mode, storageBackend);

  if (mode === 'local') {
    return { mode, storageBackend, port, staticDir, storage, ...(github ? { github } : {}) };
  }

  // PRD 010 Req 1: Entra stays required in azure mode whatever the backend;
  // the storage account is required only by the backend that uses it.
  const required = storageBackend === 'blob' ? AZURE_BLOB_REQUIRED : AZURE_REQUIRED;
  const missing = required.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`MM_MODE=azure requires environment variables: ${missing.join(', ')}`);
  }
  return {
    mode,
    storageBackend,
    port,
    staticDir,
    storage,
    azure: { tenantId: env.ENTRA_TENANT_ID!, clientId: env.ENTRA_CLIENT_ID! },
    ...(github ? { github } : {}),
  };
}
