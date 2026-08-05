// PRD 007 Req 5: the SPA side of the single-tenant Entra ID auth-code + PKCE
// sign-in flow — verifier/challenge generation (S256), authorize-redirect
// construction, callback parsing with a state check, and the code-for-token
// exchange against the tenant's token endpoint as a public client. Pure
// logic: the network is an injected `fetchFn`, so every branch is
// unit-testable with a mocked fetch and no Entra tenant.

/** Base64url without padding (RFC 7636 §4.1/§4.2 encoding). */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A fresh code verifier (also used for the CSRF `state`): 32 random bytes,
 * base64url — 43 chars of the RFC 7636 §4.1 unreserved charset.
 */
export function createCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** S256 code challenge: BASE64URL(SHA-256(ASCII(verifier))), RFC 7636 §4.2. */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** The tenant + client id an Entra authorize URL pins. */
export interface EntraAppInfo {
  tenantId: string;
  clientId: string;
}

/**
 * Extract tenant and client id from the authorize URL the server answered
 * with (`POST /api/auth/sign-in` → `{kind:'redirect', authorizeUrl}`) — the
 * token exchange needs both, and the URL is the one place the server states
 * them. Null when the URL is not a login.microsoftonline.com authorize URL.
 */
export function parseAuthorizeUrl(authorizeUrl: string): EntraAppInfo | null {
  let url: URL;
  try {
    url = new URL(authorizeUrl);
  } catch {
    return null;
  }
  const match = url.pathname.match(/^\/([^/]+)\/oauth2\/v2\.0\/authorize$/);
  const clientId = url.searchParams.get('client_id');
  if (url.origin !== 'https://login.microsoftonline.com' || !match || !clientId) return null;
  return { tenantId: match[1], clientId };
}

/**
 * The full URL to redirect the browser to: the server's authorize URL
 * (client_id, response_type, scope, S256 method already pinned) plus the
 * parts only the SPA knows — its redirect_uri, the CSRF state, and the PKCE
 * code challenge.
 */
export function buildAuthorizeRedirect(
  authorizeUrl: string,
  opts: { redirectUri: string; state: string; codeChallenge: string },
): string {
  const url = new URL(authorizeUrl);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('state', opts.state);
  url.searchParams.set('code_challenge', opts.codeChallenge);
  return url.toString();
}

/** The v2.0 token endpoint for a single-tenant app registration. */
export function tokenEndpoint(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

export type AuthCallback =
  | { kind: 'none' }
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string };

/**
 * Interpret the query string Entra redirected back with. `none` when it is
 * not a sign-in callback at all; an error when Entra reported one or when
 * `state` does not match the value stored before the redirect (a mismatch is
 * a forged or replayed callback and the code must not be redeemed).
 */
export function parseAuthCallback(search: string, expectedState: string | null): AuthCallback {
  const params = new URLSearchParams(search);
  const error = params.get('error');
  if (error) return { kind: 'error', message: params.get('error_description') ?? error };
  const code = params.get('code');
  if (!code) return { kind: 'none' };
  if (!expectedState || params.get('state') !== expectedState) {
    return { kind: 'error', message: 'Sign-in state mismatch — please try signing in again.' };
  }
  return { kind: 'code', code };
}

export interface TokenExchange {
  tenantId: string;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

/** The exact request the code-for-token exchange POSTs (public client: PKCE verifier, no secret). */
export function buildTokenRequest(opts: TokenExchange): { url: string; body: string } {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
    scope: 'openid profile email',
  }).toString();
  return { url: tokenEndpoint(opts.tenantId), body };
}

/**
 * Redeem the auth code. Returns the id_token: with the scaffold's
 * `openid profile email` scopes it is the token whose issuer and audience
 * are pinned to the tenant and client id — exactly what the server's JWKS
 * validation checks (server/providers/azure/entra.ts). Throws with the
 * endpoint's error description on any failure.
 */
export async function exchangeCodeForToken(fetchFn: typeof fetch, opts: TokenExchange): Promise<string> {
  const { url, body } = buildTokenRequest(opts);
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  let payload: Record<string, unknown> = {};
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON body — fall through to the status-based error below
  }
  if (!res.ok || typeof payload.id_token !== 'string') {
    const message =
      typeof payload.error_description === 'string'
        ? payload.error_description
        : typeof payload.error === 'string'
          ? payload.error
          : `The token endpoint answered ${res.status}.`;
    throw new Error(message);
  }
  return payload.id_token;
}
