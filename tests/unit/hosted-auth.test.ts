import { describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizeRedirect,
  buildTokenRequest,
  codeChallengeS256,
  createCodeVerifier,
  exchangeCodeForToken,
  parseAuthCallback,
  parseAuthorizeUrl,
  tokenEndpoint,
} from '../../src/lib/hostedAuth';

// PRD 007 Req 5: the SPA's Entra ID auth-code + PKCE flow — pure logic,
// verified with a mocked fetch only. No tenant, no network.
describe('PRD 007 Req 5 Entra PKCE flow', () => {
  const AUTHORIZE_URL =
    'https://login.microsoftonline.com/my-tenant/oauth2/v2.0/authorize' +
    '?client_id=my-client&response_type=code&scope=openid+profile+email&code_challenge_method=S256';

  it('U229: code verifiers are 43-char base64url strings and unique per call', () => {
    const a = createCodeVerifier();
    const b = createCodeVerifier();
    // 32 random bytes → 43 base64url chars, all in the RFC 7636 §4.1 charset.
    expect(a).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    expect(b).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    expect(a).not.toBe(b);
  });

  it('U230: the S256 challenge matches the RFC 7636 appendix B vector', async () => {
    // The worked example from RFC 7636 appendix B — pins the exact
    // SHA-256 + base64url (no padding) transform.
    const challenge = await codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('U231: the authorize redirect appends redirect_uri, state and code_challenge, preserving the server-pinned params', () => {
    const redirect = buildAuthorizeRedirect(AUTHORIZE_URL, {
      redirectUri: 'https://app.example/',
      state: 'the-state',
      codeChallenge: 'the-challenge',
    });
    const url = new URL(redirect);
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/my-tenant/oauth2/v2.0/authorize');
    expect(url.searchParams.get('client_id')).toBe('my-client');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/');
    expect(url.searchParams.get('state')).toBe('the-state');
    expect(url.searchParams.get('code_challenge')).toBe('the-challenge');
  });

  it('U232: tenant and client id come out of the authorize URL; anything else is rejected', () => {
    expect(parseAuthorizeUrl(AUTHORIZE_URL)).toEqual({ tenantId: 'my-tenant', clientId: 'my-client' });
    // Wrong host, wrong path shape, missing client_id, and garbage all → null.
    expect(parseAuthorizeUrl('https://evil.example/my-tenant/oauth2/v2.0/authorize?client_id=x')).toBeNull();
    expect(parseAuthorizeUrl('https://login.microsoftonline.com/common/other?client_id=x')).toBeNull();
    expect(parseAuthorizeUrl('https://login.microsoftonline.com/my-tenant/oauth2/v2.0/authorize')).toBeNull();
    expect(parseAuthorizeUrl('not a url')).toBeNull();
  });

  it('U233: callback parsing — not-a-callback, Entra error, state mismatch, and the happy path', () => {
    expect(parseAuthCallback('', 'expected')).toEqual({ kind: 'none' });
    expect(parseAuthCallback('?window=settings', 'expected')).toEqual({ kind: 'none' });
    expect(parseAuthCallback('?error=access_denied&error_description=nope', 'expected')).toEqual({
      kind: 'error',
      message: 'nope',
    });
    expect(parseAuthCallback('?error=access_denied', 'expected')).toEqual({
      kind: 'error',
      message: 'access_denied',
    });
    // A code with the wrong state — or with no stored state at all — is a
    // forged/replayed callback and must not be redeemed.
    expect(parseAuthCallback('?code=abc&state=wrong', 'expected').kind).toBe('error');
    expect(parseAuthCallback('?code=abc&state=expected', null).kind).toBe('error');
    expect(parseAuthCallback('?code=abc&state=expected', 'expected')).toEqual({ kind: 'code', code: 'abc' });
  });

  it('U234: the token request is a public-client form POST to the tenant token endpoint', () => {
    const { url, body } = buildTokenRequest({
      tenantId: 'my-tenant',
      clientId: 'my-client',
      code: 'the-code',
      redirectUri: 'https://app.example/',
      codeVerifier: 'the-verifier',
    });
    expect(url).toBe('https://login.microsoftonline.com/my-tenant/oauth2/v2.0/token');
    expect(url).toBe(tokenEndpoint('my-tenant'));
    const params = new URLSearchParams(body);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('client_id')).toBe('my-client');
    expect(params.get('code')).toBe('the-code');
    expect(params.get('redirect_uri')).toBe('https://app.example/');
    expect(params.get('code_verifier')).toBe('the-verifier');
    // Public client: PKCE verifier stands in for a secret — none is sent.
    expect(params.get('client_secret')).toBeNull();
  });

  it('U235: a successful exchange POSTs the form body and yields the id_token', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ id_token: 'the-jwt', access_token: 'graph-token' }), { status: 200 }),
    ) as unknown as typeof fetch;
    const token = await exchangeCodeForToken(fetchFn, {
      tenantId: 'my-tenant',
      clientId: 'my-client',
      code: 'the-code',
      redirectUri: 'https://app.example/',
      codeVerifier: 'the-verifier',
    });
    expect(token).toBe('the-jwt');
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://login.microsoftonline.com/my-tenant/oauth2/v2.0/token');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(String(init.body)).toContain('code_verifier=the-verifier');
  });

  it('U236: exchange failures throw the endpoint error description, or the status when the body is opaque', async () => {
    const opts = {
      tenantId: 'my-tenant',
      clientId: 'my-client',
      code: 'bad-code',
      redirectUri: 'https://app.example/',
      codeVerifier: 'v',
    };
    const denied = (async () =>
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'AADSTS70008: expired' }), {
        status: 400,
      })) as unknown as typeof fetch;
    await expect(exchangeCodeForToken(denied, opts)).rejects.toThrow('AADSTS70008: expired');
    const html = (async () => new Response('<html>gateway error</html>', { status: 502 })) as unknown as typeof fetch;
    await expect(exchangeCodeForToken(html, opts)).rejects.toThrow('502');
    // A 200 without an id_token is still a failure — never store undefined.
    const empty = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(exchangeCodeForToken(empty, opts)).rejects.toThrow('200');
  });
});
