import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AZURITE_CONNECTION_STRING, loadConfig } from '../../server/config';
import { GITHUB_API_BASE, GITHUB_WEB_BASE } from '../../server/providers/github/auth';

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
      /ENTRA_TENANT_ID, ENTRA_CLIENT_ID, AZURE_STORAGE_CONNECTION_STRING/,
    );
    // Partially configured: only the still-missing ones are named.
    expect(() => loadConfig({ MM_MODE: 'azure', ENTRA_TENANT_ID: 't' })).toThrowError(
      /requires environment variables: ENTRA_CLIENT_ID, AZURE_STORAGE_CONNECTION_STRING/,
    );
  });

  it('U219: a fully configured azure mode carries tenant, client, connection string, and PORT override', () => {
    const config = loadConfig({
      MM_MODE: 'azure',
      PORT: '8080',
      ENTRA_TENANT_ID: 'tenant-1',
      ENTRA_CLIENT_ID: 'client-1',
      AZURE_STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=prod;',
      MM_STORAGE_CONTAINER: 'docs',
    });
    expect(config.mode).toBe('azure');
    expect(config.port).toBe(8080);
    expect(config.azure).toEqual({ tenantId: 'tenant-1', clientId: 'client-1' });
    expect(config.storage).toEqual({
      connectionString: 'DefaultEndpointsProtocol=https;AccountName=prod;',
      container: 'docs',
    });
  });
});

// PRD 010 Req 4: the optional GitHub App section — App ID + private key are
// the only credential inputs, and no mode newly requires them; only the
// backend knob below does.
describe('PRD 010 Req 4 GitHub App configuration', () => {
  const { privateKey: PEM } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  it('U371: is absent unless configured — neither mode newly requires it', () => {
    expect(loadConfig({}).github).toBeUndefined();
    expect(
      loadConfig({
        MM_MODE: 'azure',
        ENTRA_TENANT_ID: 't',
        ENTRA_CLIENT_ID: 'c',
        AZURE_STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=prod;',
      }).github,
    ).toBeUndefined();
  });

  it('U372: parses App id, PEM (literal or \\n-escaped newlines) and an optional API base defaulting to the public API', () => {
    const config = loadConfig({ MM_GITHUB_APP_ID: '424242', MM_GITHUB_PRIVATE_KEY: PEM });
    expect(config.mode).toBe('local'); // no backend knob: mode is untouched
    // PRD 010 Req 16 adds the web host the wizard's install URL is built on;
    // it defaults to the public one, like the API base beside it.
    expect(config.github).toEqual({
      appId: '424242',
      privateKey: PEM.trim(),
      apiBase: GITHUB_API_BASE,
      webBase: GITHUB_WEB_BASE,
    });

    // How a PEM survives an App Service app setting.
    const escaped = loadConfig({
      MM_GITHUB_APP_ID: '424242',
      MM_GITHUB_PRIVATE_KEY: PEM.replace(/\n/g, '\\n'),
      MM_GITHUB_API_BASE: 'https://ghe.example.test/api/v3',
    });
    expect(escaped.github).toEqual({
      appId: '424242',
      privateKey: PEM.trim(),
      apiBase: 'https://ghe.example.test/api/v3',
      webBase: GITHUB_WEB_BASE,
    });
  });

  it('U373: rejects a partial, non-numeric or unparsable configuration by name — never echoing the key material', () => {
    expect(() => loadConfig({ MM_GITHUB_APP_ID: '424242' })).toThrowError(
      /incomplete, missing: MM_GITHUB_PRIVATE_KEY/,
    );
    expect(() => loadConfig({ MM_GITHUB_PRIVATE_KEY: PEM })).toThrowError(
      /incomplete, missing: MM_GITHUB_APP_ID/,
    );
    expect(() => loadConfig({ MM_GITHUB_API_BASE: 'https://ghe.example.test' })).toThrowError(
      /MM_GITHUB_APP_ID, MM_GITHUB_PRIVATE_KEY/,
    );
    expect(() => loadConfig({ MM_GITHUB_APP_ID: 'app-42', MM_GITHUB_PRIVATE_KEY: PEM })).toThrowError(
      /MM_GITHUB_APP_ID must be the numeric GitHub App id, got 'app-42'/,
    );
    expect(() =>
      loadConfig({ MM_GITHUB_APP_ID: '424242', MM_GITHUB_PRIVATE_KEY: PEM, MM_GITHUB_API_BASE: 'nope' }),
    ).toThrowError(/MM_GITHUB_API_BASE must be an absolute URL, got 'nope'/);

    try {
      // A truncated key: real key material, no END line — unparsable.
      loadConfig({ MM_GITHUB_APP_ID: '424242', MM_GITHUB_PRIVATE_KEY: PEM.split('\n').slice(0, 3).join('\n') });
      throw new Error('expected an unparsable PEM to be rejected');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/MM_GITHUB_PRIVATE_KEY is not a readable PEM private key/);
      expect(message).not.toContain(PEM.split('\n')[1]);
    }
  });
});

// PRD 010 Req 1: the storage-backend knob — a variable of its own, orthogonal
// to MM_MODE, defaulting to today's blob behaviour, and (on github) needing no
// Azure storage account at all.
describe('PRD 010 Req 1 storage backend knob', () => {
  const { privateKey: PEM } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  /** The github backend's minimum: App credentials plus the default repo. */
  const GITHUB_ENV = {
    MM_STORAGE_BACKEND: 'github',
    MM_GITHUB_APP_ID: '424242',
    MM_GITHUB_PRIVATE_KEY: PEM,
    MM_GITHUB_DEFAULT_REPO: 'contoso/marky-store',
  };
  const AZURE_ENV = { MM_MODE: 'azure', ENTRA_TENANT_ID: 't', ENTRA_CLIENT_ID: 'c' };
  const CONNECTION = 'DefaultEndpointsProtocol=https;AccountName=prod;';

  it('U401: defaults to blob, refuses any other value by name, and parses independently of MM_MODE', () => {
    expect(loadConfig({}).storageBackend).toBe('blob');
    expect(loadConfig({ MM_STORAGE_BACKEND: 'blob' }).storageBackend).toBe('blob');
    expect(() => loadConfig({ MM_STORAGE_BACKEND: 's3' })).toThrowError(
      /MM_STORAGE_BACKEND must be 'blob' or 'github', got 's3'/,
    );
    // All four MM_MODE × backend combinations are legal: mode picks auth and
    // directory, the knob picks where bytes live.
    const combinations = [
      [loadConfig({}), 'local', 'blob'],
      [loadConfig({ ...GITHUB_ENV }), 'local', 'github'],
      [loadConfig({ ...AZURE_ENV, AZURE_STORAGE_CONNECTION_STRING: CONNECTION }), 'azure', 'blob'],
      [loadConfig({ ...AZURE_ENV, ...GITHUB_ENV }), 'azure', 'github'],
    ] as const;
    for (const [config, mode, backend] of combinations) {
      expect([config.mode, config.storageBackend]).toEqual([mode, backend]);
    }
    // Blob reproduces today's config exactly, Azurite default included.
    expect(loadConfig({ MM_STORAGE_BACKEND: 'blob' }).storage).toEqual(loadConfig({}).storage);
  });

  it('U402: the github backend names every missing variable at once and pins the repo to one owner/repo pair', () => {
    expect(() => loadConfig({ MM_STORAGE_BACKEND: 'github' })).toThrowError(
      /MM_STORAGE_BACKEND=github requires environment variables: MM_GITHUB_APP_ID, MM_GITHUB_PRIVATE_KEY, MM_GITHUB_DEFAULT_REPO/,
    );
    expect(() => loadConfig({ MM_STORAGE_BACKEND: 'github', MM_GITHUB_APP_ID: '424242' })).toThrowError(
      /requires environment variables: MM_GITHUB_PRIVATE_KEY, MM_GITHUB_DEFAULT_REPO/,
    );
    for (const bad of ['https://github.example/contoso/marky-store', 'contoso', 'contoso/marky/store']) {
      expect(() => loadConfig({ ...GITHUB_ENV, MM_GITHUB_DEFAULT_REPO: bad })).toThrowError(
        `MM_GITHUB_DEFAULT_REPO must be one 'owner/repo' pair, got '${bad}'`,
      );
    }
    // Branch defaults to main; the root is optional and slash-trimmed.
    expect(loadConfig(GITHUB_ENV).github?.defaultRepo).toEqual({
      owner: 'contoso',
      repo: 'marky-store',
      branch: 'main',
    });
    expect(
      loadConfig({ ...GITHUB_ENV, MM_GITHUB_DEFAULT_BRANCH: 'store', MM_GITHUB_DEFAULT_ROOT: '/data/' }).github
        ?.defaultRepo,
    ).toEqual({ owner: 'contoso', repo: 'marky-store', branch: 'store', root: 'data' });
    // A repo-less branch/root is a typo, not a silent no-op.
    expect(() => loadConfig({ MM_GITHUB_DEFAULT_BRANCH: 'store' })).toThrowError(/need MM_GITHUB_DEFAULT_REPO/);
  });

  it('U403: an azure-mode github deployment starts with no storage connection string and fabricates none', () => {
    // No AZURE_STORAGE_CONNECTION_STRING anywhere in the environment: the
    // account is not merely unused, it does not exist.
    const config = loadConfig({ ...AZURE_ENV, ...GITHUB_ENV });
    expect(config.storage.connectionString).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain('AccountKey');
    expect(config.azure).toEqual({ tenantId: 't', clientId: 'c' });
    // The Entra half is still required — only the storage account was dropped.
    expect(() => loadConfig({ MM_MODE: 'azure', ...GITHUB_ENV })).toThrowError(
      /requires environment variables: ENTRA_TENANT_ID, ENTRA_CLIENT_ID/,
    );
  });

  it('U454: the App\u2019s web-side identity is optional, validated, and never configurable by halves', () => {
    // PRD 010 Req 16: without a slug the section parses exactly as before —
    // the wizard then reports the choice unavailable rather than dead-ending.
    expect(loadConfig({ MM_GITHUB_APP_ID: '424242', MM_GITHUB_PRIVATE_KEY: PEM }).github?.appSlug).toBeUndefined();
    const configured = loadConfig({
      MM_GITHUB_APP_ID: '424242',
      MM_GITHUB_PRIVATE_KEY: PEM,
      MM_GITHUB_APP_SLUG: 'marky-mark',
      MM_GITHUB_WEB_BASE: 'https://ghe.example.test/',
    }).github;
    expect(configured?.appSlug).toBe('marky-mark');
    // Trailing slashes are trimmed, so the install URL never doubles one.
    expect(configured?.webBase).toBe('https://ghe.example.test');

    // Named refusals, never the key material and never a silent no-op.
    expect(() =>
      loadConfig({ MM_GITHUB_APP_ID: '424242', MM_GITHUB_PRIVATE_KEY: PEM, MM_GITHUB_APP_SLUG: 'not a slug' }),
    ).toThrowError(/MM_GITHUB_APP_SLUG must be the App's URL slug/);
    expect(() =>
      loadConfig({
        MM_GITHUB_APP_ID: '424242',
        MM_GITHUB_PRIVATE_KEY: PEM,
        MM_GITHUB_APP_SLUG: 'marky-mark',
        MM_GITHUB_WEB_BASE: 'nope',
      }),
    ).toThrowError(/MM_GITHUB_WEB_BASE must be an absolute URL, got 'nope'/);
    expect(() => loadConfig({ MM_GITHUB_WEB_BASE: 'https://ghe.example.test' })).toThrowError(
      /GitHub App configuration is incomplete, missing: MM_GITHUB_APP_ID, MM_GITHUB_PRIVATE_KEY/,
    );
    expect(() =>
      loadConfig({
        MM_GITHUB_APP_ID: '424242',
        MM_GITHUB_PRIVATE_KEY: PEM,
        MM_GITHUB_WEB_BASE: 'https://ghe.example.test',
      }),
    ).toThrowError(/MM_GITHUB_WEB_BASE needs MM_GITHUB_APP_SLUG/);
    // A slug named without the credentials is the same incomplete refusal.
    expect(() => loadConfig({ MM_GITHUB_APP_SLUG: 'marky-mark' })).toThrowError(
      /GitHub App configuration is incomplete/,
    );
  });
});