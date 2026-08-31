import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/config';
import { createProviders } from '../../server/providers/index';
import {
  apiScope,
  buildAuthorizeUrl,
  createEntraAuthProvider,
  entraIssuer,
  sessionUserFromClaims,
} from '../../server/providers/azure/entra';
import { createGraphDirectoryProvider } from '../../server/providers/azure/graph';
import {
  createOboTokenSource,
  GRAPH_OBO_SCOPE,
  OBO_EXPIRY_MARGIN_SECONDS,
} from '../../server/providers/azure/obo';

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
        ENTRA_CLIENT_SECRET: 'secret-1',
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
  it('U225: sign-in answers a redirect to the tenant authorize endpoint pinning client, S256 PKCE, and the app-API scope', async () => {
    const provider = createEntraAuthProvider('tenant-1', 'client-1');
    const result = await provider.signIn({});
    if (result?.kind !== 'redirect') throw new Error('expected a redirect sign-in');
    const url = new URL(result.authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // Issue #184: the pinned scopes include the app's own API scope, so the
    // exchange mints the access token the OBO assertion requires. This URL
    // is the single place the scope string is stated.
    expect(url.searchParams.get('scope')).toBe('openid profile email api://client-1/access_as_user');
    expect(apiScope('client-1')).toBe('api://client-1/access_as_user');
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

  it('U962: only a bearer whose scp includes access_as_user is a session — an id_token (no scp) is a clean 401', () => {
    // Issue #184: the claims→user mapping behind validateToken, after the
    // signature/iss/aud pinning. An access token for the app's own API
    // carries scp; the pre-#184 id_token bearer never does, so an old tab
    // gets null → the same 401 as any rejected token, never a 500.
    const claims = { oid: 'oid-1', preferred_username: 'ada@contoso.com', name: 'Ada' };
    expect(sessionUserFromClaims({ ...claims, scp: 'access_as_user' })).toEqual({
      id: 'oid-1',
      username: 'ada@contoso.com',
      displayName: 'Ada',
    });
    // Multi-scope scp still matches on the whole word, and users are still
    // identified by oid.
    expect(sessionUserFromClaims({ ...claims, scp: 'profile access_as_user email' })?.id).toBe('oid-1');
    expect(sessionUserFromClaims(claims)).toBeNull(); // id_token: no scp at all
    expect(sessionUserFromClaims({ ...claims, scp: 'User.Read' })).toBeNull();
    expect(sessionUserFromClaims({ ...claims, scp: 'access_as_user_extra' })).toBeNull();
  });
});

describe('PRD 007 Req 3 Graph directory provider', () => {
  const auth = { token: 'session-id-token', user: { id: 'u1', username: 'ada', displayName: 'Ada' } };
  // Issue #180: the provider's token comes from the injected source (the OBO
  // exchange in production) — never from auth.token, whose audience is the
  // app itself and which Graph rejects.
  const exchanged = async () => 'graph-token';

  it('U227: search calls Graph /users with $search, the exchanged Graph token, and the eventual ConsistencyLevel, mapping results', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const provider = createGraphDirectoryProvider(async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          value: [
            { id: 'g1', displayName: 'Grace Hopper', userPrincipalName: 'grace@contoso.com', userType: 'Member' },
            { id: 'g3', displayName: 'Guest Gwen', userPrincipalName: 'gwen@fabrikam.com', userType: 'Guest' },
          ],
        }),
        { status: 200 },
      );
    }, exchanged);
    const users = await provider.search('grace', auth);
    expect(users).toEqual([
      {
        id: 'g1',
        displayName: 'Grace Hopper',
        username: 'grace@contoso.com',
        // PRD 007 Req 6: results carry the same-origin avatar URL, never a Graph URL.
        avatarUrl: '/api/directory/users/g1/photo',
        isGuest: false,
      },
      // Issue #180: Graph's userType marks guests for the People UI's badge.
      {
        id: 'g3',
        displayName: 'Guest Gwen',
        username: 'gwen@fabrikam.com',
        avatarUrl: '/api/directory/users/g3/photo',
        isGuest: true,
      },
    ]);
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe('https://graph.microsoft.com/v1.0/users');
    expect(url.searchParams.get('$search')).toContain('displayName:grace');
    expect(url.searchParams.get('$select')).toContain('userType');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer graph-token');
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
      exchanged,
    );
    expect(await provider.getUser('g2', auth)).toEqual({
      id: 'g2',
      displayName: 'Alan Turing',
      username: '',
      avatarUrl: '/api/directory/users/g2/photo',
      // No userType in the response reads as a regular member, not a guest.
      isGuest: false,
    });
    status = 404;
    expect(await provider.getUser('gone', auth)).toBeNull();
    status = 500;
    await expect(provider.getUser('g2', auth)).rejects.toThrowError(/Graph user lookup failed: 500/);
  });

  it('U974: listUsers pages /users through @odata.nextLink with the exchanged token, concatenating pages; a non-OK page throws', async () => {
    // PRD 017 Req 19: the Management People tab's tenant listing — the first
    // page is the PRD's pinned URL, every nextLink is followed verbatim, and
    // a failed page is an error, never a truncated tenant.
    const calls: { url: string; init?: RequestInit }[] = [];
    const nextLink = 'https://graph.microsoft.com/v1.0/users?$skiptoken=page2';
    const provider = createGraphDirectoryProvider(async (url, init) => {
      calls.push({ url, init });
      const page =
        calls.length === 1
          ? {
              value: [
                { id: 'g1', displayName: 'Grace Hopper', userPrincipalName: 'grace@contoso.com', userType: 'Member' },
              ],
              '@odata.nextLink': nextLink,
            }
          : {
              value: [
                { id: 'g3', displayName: 'Guest Gwen', userPrincipalName: 'gwen@fabrikam.com', userType: 'Guest' },
              ],
            };
      return new Response(JSON.stringify(page), { status: 200 });
    }, exchanged);
    const users = await provider.listUsers(auth);
    expect(users.map((u) => ({ id: u.id, isGuest: u.isGuest }))).toEqual([
      { id: 'g1', isGuest: false },
      { id: 'g3', isGuest: true },
    ]);
    expect(calls).toHaveLength(2);
    const first = new URL(calls[0].url);
    expect(first.origin + first.pathname).toBe('https://graph.microsoft.com/v1.0/users');
    expect(first.searchParams.get('$select')).toBe(
      'id,displayName,userPrincipalName,userType,externalUserState',
    );
    expect(first.searchParams.get('$top')).toBe('999');
    expect(calls[1].url).toBe(nextLink);
    for (const call of calls) {
      expect((call.init?.headers as Record<string, string>).Authorization).toBe('Bearer graph-token');
    }

    const failing = createGraphDirectoryProvider(async () => new Response('', { status: 503 }), exchanged);
    await expect(failing.listUsers(auth)).rejects.toThrowError(/Graph user listing failed: 503/);
  });

  it('U825: getUserPhoto calls Graph /users/{id}/photo/$value with the exchanged token and yields the bytes and media type', async () => {
    // PRD 007 Req 6: the photo proxy's upstream — URL shape, bearer, bytes.
    const calls: { url: string; init?: RequestInit }[] = [];
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const provider = createGraphDirectoryProvider(async (url, init) => {
      calls.push({ url, init });
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    }, exchanged);
    const photo = await provider.getUserPhoto('g1/odd id', auth);
    expect(calls[0].url).toBe('https://graph.microsoft.com/v1.0/users/g1%2Fodd%20id/photo/$value');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer graph-token');
    expect(photo).toEqual({ contentType: 'image/jpeg', data: bytes });
  });

  it('U244: a missing photo (404) is null — no photo, not an error — while other failures surface', async () => {
    // PRD 007 Req 6: Graph answers 404 both for "no photo" and "unknown
    // user"; either way the client renders the initials fallback.
    let status = 404;
    const provider = createGraphDirectoryProvider(async () => new Response('', { status }), exchanged);
    expect(await provider.getUserPhoto('no-photo', auth)).toBeNull();
    status = 503;
    await expect(provider.getUserPhoto('g1', auth)).rejects.toThrowError(/Graph photo fetch failed: 503/);
  });

  it('U991: invite POSTs /invitations with the exchanged token and the pinned body, mapping the answer to a pending guest', async () => {
    // PRD 017 Req 29 (issue #190): the request shape Graph receives and the
    // success mapping — the invited user comes back a pending guest.
    const calls: { url: string; init?: RequestInit }[] = [];
    const provider = createGraphDirectoryProvider(async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ invitedUser: { id: 'guest-1' }, invitedUserDisplayName: 'friend@example.com' }),
        { status: 201 },
      );
    }, exchanged);
    const invitation = {
      email: 'friend@example.com',
      redirectUrl: 'https://markymark.example.com/',
      message: 'Ada has invited you to collaborate in Marky Mark.',
    };
    expect(await provider.invite(invitation, auth)).toEqual({
      ok: true,
      user: {
        id: 'guest-1',
        displayName: 'friend@example.com',
        username: 'friend@example.com',
        avatarUrl: '/api/directory/users/guest-1/photo',
        isGuest: true,
        pending: true,
      },
    });
    expect(calls[0].url).toBe('https://graph.microsoft.com/v1.0/invitations');
    expect(calls[0].init?.method).toBe('POST');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer graph-token');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      invitedUserEmailAddress: 'friend@example.com',
      inviteRedirectUrl: 'https://markymark.example.com/',
      sendInvitationMessage: true,
      invitedUserMessageInfo: { customizedMessageBody: 'Ada has invited you to collaborate in Marky Mark.' },
    });
  });

  it("U992: an invite refusal is data — Graph's error.code and message — and a non-JSON or id-less answer still refuses by name", async () => {
    // PRD 017 Req 29: the 502 lane's payload comes from Graph verbatim,
    // never a silent success.
    const invitation = { email: 'x@example.com', redirectUrl: 'https://m.example.com/', message: 'm' };
    const refusing = createGraphDirectoryProvider(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 'invitedUserAlreadyExists', message: 'Already a member.' } }),
          { status: 400 },
        ),
      exchanged,
    );
    expect(await refusing.invite(invitation, auth)).toEqual({
      ok: false,
      code: 'invitedUserAlreadyExists',
      message: 'Already a member.',
    });
    const nonJson = createGraphDirectoryProvider(async () => new Response('gateway woe', { status: 503 }), exchanged);
    expect(await nonJson.invite(invitation, auth)).toEqual({
      ok: false,
      code: '',
      message: 'Graph refused the invitation (503)',
    });
    const idless = createGraphDirectoryProvider(async () => new Response('{}', { status: 201 }), exchanged);
    expect(await idless.invite(invitation, auth)).toEqual({
      ok: false,
      code: '',
      message: 'Graph answered without an invitedUser.id',
    });
  });
});

// PRD 007 Req 6 (issue #180): the on-behalf-of exchange — the session bearer
// (the access token for the app's own API, issue #184) traded at the tenant
// token endpoint for a delegated Graph access token, cached per user for its
// validity window. The token-endpoint fetch is injected, so every branch
// here runs offline.
describe('issue #180 on-behalf-of Graph token exchange', () => {
  const authFor = (id: string, token = `access-token-${id}`) => ({
    token,
    user: { id, username: `${id}@contoso.com`, displayName: id },
  });

  const tokenResponse = (token: string, expiresIn = 3600) =>
    new Response(JSON.stringify({ token_type: 'Bearer', access_token: token, expires_in: expiresIn }), {
      status: 200,
    });

  it('U799: the exchange POSTs the jwt-bearer grant with the caller assertion, delegated Graph scope, and the client credential', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const getToken = createOboTokenSource({
      tenantId: 'tenant-1',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return tokenResponse('graph-token');
      },
    });
    expect(await getToken(authFor('u1', 'the-session-access-token'))).toBe('graph-token');
    expect(calls[0].url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    expect(calls[0].init?.method).toBe('POST');
    const body = new URLSearchParams(String(calls[0].init?.body));
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(body.get('client_id')).toBe('client-1');
    expect(body.get('client_secret')).toBe('secret-1');
    // Issue #184: the assertion is the validated session bearer exactly as
    // received — the access token for the app's own API, never an id_token.
    expect(body.get('assertion')).toBe('the-session-access-token');
    // Delegated permissions only — never an application permission. PRD 017
    // Req 29 (issue #190): the set grew by User.Invite.All for invitations.
    expect(body.get('scope')).toBe(GRAPH_OBO_SCOPE);
    expect(GRAPH_OBO_SCOPE).toBe(
      'https://graph.microsoft.com/User.ReadBasic.All https://graph.microsoft.com/User.Invite.All',
    );
    expect(body.get('requested_token_use')).toBe('on_behalf_of');
  });

  it('U800: tokens are cached per user for expires_in minus the safety margin — and concurrent first calls share one exchange', async () => {
    let nowMs = 0;
    let exchanges = 0;
    const getToken = createOboTokenSource({
      tenantId: 't',
      clientId: 'c',
      clientSecret: 's',
      now: () => nowMs,
      fetchImpl: async (_url, init) => {
        exchanges++;
        const user = new URLSearchParams(String(init?.body)).get('assertion');
        return tokenResponse(`graph-${user}-${exchanges}`, 3600);
      },
    });
    // Two users, interleaved: one exchange each, cached per user.
    const [a1, b1] = await Promise.all([getToken(authFor('ada')), getToken(authFor('bob'))]);
    expect(await getToken(authFor('ada'))).toBe(a1);
    expect(await getToken(authFor('bob'))).toBe(b1);
    expect(a1).not.toBe(b1);
    expect(exchanges).toBe(2);
    // Concurrent calls before the first resolves share the in-flight exchange.
    const [c1, c2] = await Promise.all([getToken(authFor('cyd')), getToken(authFor('cyd'))]);
    expect(c1).toBe(c2);
    expect(exchanges).toBe(3);
    // Inside the validity window the cache answers; past expires_in minus
    // the margin, the exchange runs again.
    nowMs = (3600 - OBO_EXPIRY_MARGIN_SECONDS) * 1000 - 1;
    expect(await getToken(authFor('ada'))).toBe(a1);
    expect(exchanges).toBe(3);
    nowMs = (3600 - OBO_EXPIRY_MARGIN_SECONDS) * 1000;
    expect(await getToken(authFor('ada'))).not.toBe(a1);
    expect(exchanges).toBe(4);
  });

  it('U801: a refused exchange names the status, OAuth code, and AADSTS error_description — never the secret or assertion — and is not cached', async () => {
    let status = 400;
    let exchanges = 0;
    const getToken = createOboTokenSource({
      tenantId: 't',
      clientId: 'c',
      clientSecret: 'obo-secret-DO-NOT-LEAK',
      fetchImpl: async () => {
        exchanges++;
        return status === 200
          ? tokenResponse('graph-token')
          : new Response(
              JSON.stringify({
                error: 'invalid_request',
                error_description: "AADSTS240002: Input id_token cannot be used as 'urn:ietf:params:oauth:grant-type:jwt-bearer' grant.",
              }),
              { status },
            );
      },
    });
    const auth = authFor('u1', 'assertion-DO-NOT-LEAK');
    let message = '';
    await getToken(auth).catch((err: Error) => {
      message = err.message;
    });
    // Issue #184: the AADSTS line is the diagnosis — the operator reads the
    // actual cause, not a bare invalid_request. Secret and assertion stay out.
    expect(message).toBe(
      "Graph token exchange failed: 400 (invalid_request): AADSTS240002: Input id_token cannot be used as 'urn:ietf:params:oauth:grant-type:jwt-bearer' grant.",
    );
    expect(message).not.toContain('DO-NOT-LEAK');
    // The failure was evicted, so the next call retries — and can succeed.
    status = 200;
    expect(await getToken(auth)).toBe('graph-token');
    expect(exchanges).toBe(2);
    // A 200 with no access_token is a refusal too, not an empty bearer.
    const broken = createOboTokenSource({
      tenantId: 't',
      clientId: 'c',
      clientSecret: 's',
      fetchImpl: async () => new Response(JSON.stringify({ token_type: 'Bearer' }), { status: 200 }),
    });
    await expect(broken(auth)).rejects.toThrowError(/answered without an access_token/);
  });
});
