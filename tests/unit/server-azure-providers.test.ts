import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/config';
import { createProviders } from '../../server/providers/index';
import { buildAuthorizeUrl, createEntraAuthProvider, entraIssuer } from '../../server/providers/azure/entra';
import { createGraphDirectoryProvider } from '../../server/providers/azure/graph';

// PRD 007 Req 3: provider selection and the Azure implementations' offline-
// verifiable logic (URL shapes, token rejection, Graph request mapping) — the
// Entra/Graph seam is covered by typecheck + these tests, never cloud calls.
describe('PRD 007 Req 3 provider selection', () => {
  it('U224: local mode wires mock auth/directory around the real Azure blob storage code; azure mode wires Entra + Graph', () => {
    const local = createProviders(loadConfig({}));
    expect([local.auth.kind, local.storage.kind, local.directory.kind]).toEqual([
      'mock',
      'azure-blob',
      'mock',
    ]);
    const azure = createProviders(
      loadConfig({
        MM_MODE: 'azure',
        ENTRA_TENANT_ID: 'tenant-1',
        ENTRA_CLIENT_ID: 'client-1',
        AZURE_STORAGE_CONNECTION_STRING:
          'DefaultEndpointsProtocol=https;AccountName=prod;AccountKey=eA==;EndpointSuffix=core.windows.net',
      }),
    );
    expect([azure.auth.kind, azure.storage.kind, azure.directory.kind]).toEqual([
      'entra',
      'azure-blob',
      'graph',
    ]);
  });
});

describe('PRD 007 Req 3 Entra ID auth provider', () => {
  it('U225: sign-in answers a redirect to the tenant authorize endpoint pinning client and S256 PKCE', async () => {
    const provider = createEntraAuthProvider('tenant-1', 'client-1');
    const result = await provider.signIn({});
    if (result?.kind !== 'redirect') throw new Error('expected a redirect sign-in');
    const url = new URL(result.authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(buildAuthorizeUrl('t', 'c')).toContain('login.microsoftonline.com/t/');
    expect(entraIssuer('tenant-1')).toBe('https://login.microsoftonline.com/tenant-1/v2.0');
  });

  it('U226: a malformed bearer token is rejected as null without any network fetch', async () => {
    const provider = createEntraAuthProvider('tenant-1', 'client-1');
    // Not a compact JWS at all — jose fails structural parsing before it
    // would ever consult the remote JWKS, so this stays offline.
    expect(await provider.validateToken('not-a-jwt')).toBeNull();
    expect(await provider.validateToken('')).toBeNull();
  });
});

describe('PRD 007 Req 3 Graph directory provider', () => {
  const auth = { token: 'caller-token', user: { id: 'u1', username: 'ada', displayName: 'Ada' } };

  it('U227: search calls Graph /users with $search, the caller token, and the eventual ConsistencyLevel, mapping results', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const provider = createGraphDirectoryProvider(async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ value: [{ id: 'g1', displayName: 'Grace Hopper', userPrincipalName: 'grace@contoso.com' }] }),
        { status: 200 },
      );
    });
    const users = await provider.search('grace', auth);
    expect(users).toEqual([
      {
        id: 'g1',
        displayName: 'Grace Hopper',
        username: 'grace@contoso.com',
        // PRD 007 Req 6: results carry the same-origin avatar URL, never a Graph URL.
        avatarUrl: '/api/directory/users/g1/photo',
      },
    ]);
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe('https://graph.microsoft.com/v1.0/users');
    expect(url.searchParams.get('$search')).toContain('displayName:grace');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer caller-token');
    expect(headers.ConsistencyLevel).toBe('eventual');
    // A blank query never leaves the process.
    expect(await provider.search('   ', auth)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('U228: getUser maps a hit, returns null on 404 (user left the tenant), and surfaces other failures', async () => {
    let status = 200;
    const provider = createGraphDirectoryProvider(async () =>
      status === 200
        ? new Response(JSON.stringify({ id: 'g2', displayName: 'Alan Turing' }), { status })
        : new Response('', { status }),
    );
    expect(await provider.getUser('g2', auth)).toEqual({
      id: 'g2',
      displayName: 'Alan Turing',
      username: '',
      avatarUrl: '/api/directory/users/g2/photo',
    });
    status = 404;
    expect(await provider.getUser('gone', auth)).toBeNull();
    status = 500;
    await expect(provider.getUser('g2', auth)).rejects.toThrowError(/Graph user lookup failed: 500/);
  });

  it('U243: getUserPhoto calls Graph /users/{id}/photo/$value as the caller and yields the bytes and media type', async () => {
    // PRD 007 Req 6: the photo proxy's upstream — URL shape, bearer, bytes.
    const calls: { url: string; init?: RequestInit }[] = [];
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const provider = createGraphDirectoryProvider(async (url, init) => {
      calls.push({ url, init });
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    });
    const photo = await provider.getUserPhoto('g1/odd id', auth);
    expect(calls[0].url).toBe('https://graph.microsoft.com/v1.0/users/g1%2Fodd%20id/photo/$value');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer caller-token');
    expect(photo).toEqual({ contentType: 'image/jpeg', data: bytes });
  });

  it('U244: a missing photo (404) is null — no photo, not an error — while other failures surface', async () => {
    // PRD 007 Req 6: Graph answers 404 both for "no photo" and "unknown
    // user"; either way the client renders the initials fallback.
    let status = 404;
    const provider = createGraphDirectoryProvider(async () => new Response('', { status }));
    expect(await provider.getUserPhoto('no-photo', auth)).toBeNull();
    status = 503;
    await expect(provider.getUserPhoto('g1', auth)).rejects.toThrowError(/Graph photo fetch failed: 503/);
  });
});
