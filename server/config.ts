// PRD 007 Req 1: all configuration arrives via environment variables so the
// same code starts locally and on Azure App Service (Linux) unchanged. Req 4:
// MM_MODE selects the provider wiring — 'local' (Azurite storage + mock
// auth/directory, the offline dev mode) or 'azure' (Entra ID + Blob Storage +
// Graph). Pure parsing, no I/O, so the unit suite can pin every branch.

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
  };
}

/** Env vars azure mode cannot start without. */
const AZURE_REQUIRED = ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'AZURE_STORAGE_CONNECTION_STRING'] as const;

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
  const container = env.MM_STORAGE_CONTAINER ?? 'marky-mark';

  if (mode === 'local') {
    return {
      mode,
      port,
      staticDir,
      storage: {
        connectionString: env.AZURE_STORAGE_CONNECTION_STRING ?? AZURITE_CONNECTION_STRING,
        container,
      },
    };
  }

  const missing = AZURE_REQUIRED.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`MM_MODE=azure requires environment variables: ${missing.join(', ')}`);
  }
  return {
    mode,
    port,
    staticDir,
    storage: { connectionString: env.AZURE_STORAGE_CONNECTION_STRING!, container },
    azure: { tenantId: env.ENTRA_TENANT_ID!, clientId: env.ENTRA_CLIENT_ID! },
  };
}
