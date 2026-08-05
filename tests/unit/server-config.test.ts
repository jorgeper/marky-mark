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
