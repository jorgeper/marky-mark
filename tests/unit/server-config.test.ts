import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AZURITE_CONNECTION_STRING, loadConfig } from '../../server/config';
import { GITHUB_API_BASE } from '../../server/providers/github/auth';

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
// the only credential inputs, no mode newly requires them, and no backend
// selection knob is added here (that is #101).
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
    expect(config.github).toEqual({ appId: '424242', privateKey: PEM.trim(), apiBase: GITHUB_API_BASE });

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
