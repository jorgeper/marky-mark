import { describe, expect, it } from 'vitest';
import { AZURITE_CONNECTION_STRING, loadConfig } from '../../server/config';

// PRD 007 Req 1+4: env-var configuration and the MM_MODE mode switch — pure
// parsing, so every branch is pinned here without starting a server.
describe('PRD 007 Req 1+4 server config', () => {
  it('U216: defaults to local mode with the Azurite dev endpoint, port 4924, dist static dir', () => {
    const config = loadConfig({});
    expect(config.mode).toBe('local');
    expect(config.port).toBe(4924);
    expect(config.staticDir).toBe('dist');
    expect(config.storage.container).toBe('marky-mark');
    expect(config.storage.connectionString).toBe(AZURITE_CONNECTION_STRING);
    expect(config.storage.connectionString).toContain('http://127.0.0.1:10000/devstoreaccount1');
    expect(config.azure).toBeUndefined();
  });

  it('U217: rejects an unknown MM_MODE and a non-port PORT by naming the bad value', () => {
    expect(() => loadConfig({ MM_MODE: 'aws' })).toThrowError(/MM_MODE must be 'local' or 'azure'.*'aws'/);
    expect(() => loadConfig({ PORT: 'banana' })).toThrowError(/PORT must be a TCP port number.*'banana'/);
    expect(() => loadConfig({ PORT: '0' })).toThrowError(/PORT/);
  });

  it('U218: azure mode names every missing required variable at once', () => {
    expect(() => loadConfig({ MM_MODE: 'azure' })).toThrowError(
      /ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, AZURE_STORAGE_CONNECTION_STRING/,
    );
    // Partially configured: only the still-missing ones are named.
    expect(() => loadConfig({ MM_MODE: 'azure', ENTRA_TENANT_ID: 't' })).toThrowError(
      /requires environment variables: ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, AZURE_STORAGE_CONNECTION_STRING/,
    );
  });

  it('U219: a fully configured azure mode carries tenant, client, client secret, connection string, and PORT override', () => {
    const config = loadConfig({
      MM_MODE: 'azure',
      PORT: '8080',
      ENTRA_TENANT_ID: 'tenant-1',
      ENTRA_CLIENT_ID: 'client-1',
      ENTRA_CLIENT_SECRET: 'secret-1',
      AZURE_STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=prod;',
      MM_STORAGE_CONTAINER: 'docs',
    });
    expect(config.mode).toBe('azure');
    expect(config.port).toBe(8080);
    expect(config.azure).toEqual({ tenantId: 'tenant-1', clientId: 'client-1', clientSecret: 'secret-1' });
    expect(config.storage).toEqual({
      connectionString: 'DefaultEndpointsProtocol=https;AccountName=prod;',
      container: 'docs',
    });
  });

  it('U802: the confidential-client secret is refused by name when missing, and its value never appears in a refusal', () => {
    // PRD 007 Req 6 (issue #180): the OBO exchange's credential is required
    // in azure mode with the same all-gaps-at-once refusal style…
    expect(() =>
      loadConfig({
        MM_MODE: 'azure',
        ENTRA_TENANT_ID: 't',
        ENTRA_CLIENT_ID: 'c',
        AZURE_STORAGE_CONNECTION_STRING: 'conn',
      }),
    ).toThrowError(/requires environment variables: ENTRA_CLIENT_SECRET$/);
    // …and never required in local mode, which starts with no config at all.
    expect(loadConfig({}).azure).toBeUndefined();
    // The refusal for OTHER gaps names variables, never the secret's value —
    // the same rule MM_LLM_API_KEY follows.
    const SECRET = 'entra-secret-DO-NOT-LEAK-4b1d';
    let message = '';
    try {
      loadConfig({ MM_MODE: 'azure', ENTRA_CLIENT_SECRET: SECRET });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/ENTRA_TENANT_ID/);
    expect(message).not.toContain(SECRET);
  });
});

// PRD 011 Req 8: the deployment-wide LLM credential, configured by the
// operator at deploy time. Absent unless configured, refused by name when
// half-configured — with one extra rule of its own: no refusal may quote
// the key.
describe('PRD 011 Req 8 the operator-configured LLM section', () => {
  /** A sentinel no message, payload or log line may ever contain. */
  const SENTINEL = 'sk-sentinel-DO-NOT-LEAK-8f3c';

  const openai = {
    MM_LLM_PROVIDER: 'openai',
    MM_LLM_MODEL: 'gpt-4o-mini',
    MM_LLM_API_KEY: SENTINEL,
  };

  it('U522: a deployment that sets none of the variables has no LLM at all', () => {
    // Not a default provider, not a fabricated model, not an empty object:
    // absent, which is what makes "this deployment has no LLM" a real state.
    expect(loadConfig({}).llm).toBeUndefined();
    expect(loadConfig({ MM_MODE: 'local' }).llm).toBeUndefined();
    // …and everything else about that deployment is exactly as it was.
    expect(loadConfig({})).toEqual(loadConfig({}));
    expect(Object.keys(loadConfig({}))).not.toContain('llm');
  });

  it('U523: a complete section parses into the seam’s own provider config, for each of the five kinds', () => {
    for (const kind of ['openai', 'anthropic', 'gemini', 'openrouter'] as const) {
      // The parsed value IS an LlmProviderConfig — assignability is checked by
      // the type of `llm`, the values here.
      expect(loadConfig({ ...openai, MM_LLM_PROVIDER: kind }).llm).toEqual({
        kind,
        model: 'gpt-4o-mini',
        apiKey: SENTINEL,
      });
    }
    expect(
      loadConfig({
        ...openai,
        MM_LLM_PROVIDER: 'custom',
        MM_LLM_MODEL: 'local-llama',
        MM_LLM_BASE_URL: 'https://llm.internal.example/v1 ',
      }).llm,
    ).toEqual({ kind: 'custom', model: 'local-llama', apiKey: SENTINEL, baseUrl: 'https://llm.internal.example/v1' });
    // It rides in both modes, and is required by neither.
    const azure = loadConfig({
      ...openai,
      MM_MODE: 'azure',
      ENTRA_TENANT_ID: 't',
      ENTRA_CLIENT_ID: 'c',
      ENTRA_CLIENT_SECRET: 's',
      AZURE_STORAGE_CONNECTION_STRING: 'conn',
    });
    expect(azure.llm?.kind).toBe('openai');
  });

  it('U524: a partial section names every missing variable at once, and never the key', () => {
    expect(() => loadConfig({ MM_LLM_PROVIDER: 'openai' })).toThrowError(
      /LLM configuration is incomplete, missing: MM_LLM_MODEL, MM_LLM_API_KEY/,
    );
    expect(() => loadConfig({ MM_LLM_API_KEY: SENTINEL })).toThrowError(
      /LLM configuration is incomplete, missing: MM_LLM_PROVIDER, MM_LLM_MODEL/,
    );
    // PRD 011 Req 7: the refusal names the variable that is missing, never the
    // value of the one that was set.
    for (const env of [{ MM_LLM_API_KEY: SENTINEL }, { ...openai, MM_LLM_PROVIDER: 'hal9000' }]) {
      let message = '';
      try {
        loadConfig(env);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).not.toBe('');
      expect(message).not.toContain(SENTINEL);
    }
  });

  it('U525: an unknown provider kind is refused by name, with the value it got', () => {
    expect(() => loadConfig({ ...openai, MM_LLM_PROVIDER: 'hal9000' })).toThrowError(
      /MM_LLM_PROVIDER must be one of openai, anthropic, gemini, openrouter, custom, got 'hal9000'/,
    );
  });

  it('U526: the custom kind needs an absolute http(s) base URL, and no other kind may name one', () => {
    const custom = { ...openai, MM_LLM_PROVIDER: 'custom' };
    expect(() => loadConfig(custom)).toThrowError(
      /MM_LLM_PROVIDER=custom requires environment variables: MM_LLM_BASE_URL/,
    );
    for (const bad of ['not-a-url', '/v1/chat', 'ftp://llm.example/v1']) {
      expect(() => loadConfig({ ...custom, MM_LLM_BASE_URL: bad })).toThrowError(
        new RegExp(`MM_LLM_BASE_URL must be an absolute http\\(s\\) URL, got '${bad.replace('/', '\\/')}`),
      );
    }
    // A base URL against a hosted provider would silently do nothing, so it is
    // a refusal rather than an ignored setting.
    expect(() => loadConfig({ ...openai, MM_LLM_BASE_URL: 'https://llm.example/v1' })).toThrowError(
      /MM_LLM_BASE_URL applies only to MM_LLM_PROVIDER=custom, got 'openai'/,
    );
  });
});
