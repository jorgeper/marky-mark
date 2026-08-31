// PRD 007 Req 3: the Microsoft Entra ID implementation of the auth seam.
// Sign-in is an auth-code + PKCE flow the SPA drives (PRD Req 5, a sibling
// issue), so signIn answers with the tenant's authorize URL; token validation
// verifies incoming bearer JWTs against the tenant's published JWKS (issuer +
// audience pinned to the single-tenant app registration, scp pinned to the
// app's own access_as_user scope — issue #184). Verified by typecheck and
// unit tests only — no cloud calls in CI.

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AuthProvider, AuthUser, SignInResult } from '../types.ts';

/** The v2.0 issuer for a single-tenant app registration. */
export function entraIssuer(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/v2.0`;
}

/**
 * Issue #184: the delegated scope the registration exposes on its own API
 * (identifier URI `api://<client id>`). Requesting it makes Entra mint an
 * **access token audienced to this app** — the only kind the on-behalf-of
 * exchange accepts as its assertion; the id_token is not (AADSTS240002).
 */
export const API_SCOPE_NAME = 'access_as_user';

/** The full scope URI of the app's own API scope. */
export function apiScope(clientId: string): string {
  return `api://${clientId}/${API_SCOPE_NAME}`;
}

/**
 * The authorize endpoint the SPA redirects to. The SPA appends its own
 * redirect_uri and PKCE code_challenge; the server only pins tenant, client
 * and the S256 challenge method. This is the single place the session scopes
 * are stated — the SPA reads them back out of the URL for the token exchange
 * (parseAuthorizeUrl in src/lib/hostedAuth.ts), so they cannot drift.
 */
export function buildAuthorizeUrl(tenantId: string, clientId: string): string {
  const url = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', `openid profile email ${apiScope(clientId)}`);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/**
 * Issue #184: map a signature-verified session payload to its user — or null
 * when the token is not an access token for the app's own API. `scp` carries
 * the delegated scopes an access token was minted with; an id_token (the
 * pre-#184 session bearer an old tab may still hold) has no `scp`, so it
 * fails here and gets the same clean 401 as any other rejected bearer.
 */
export function sessionUserFromClaims(payload: JWTPayload): AuthUser | null {
  const scopes = typeof payload.scp === 'string' ? payload.scp.split(' ') : [];
  if (!scopes.includes(API_SCOPE_NAME)) return null;
  return {
    id: String(payload.oid ?? payload.sub ?? ''),
    username: String(payload.preferred_username ?? ''),
    displayName: String(payload.name ?? payload.preferred_username ?? ''),
  };
}

export function createEntraAuthProvider(tenantId: string, clientId: string): AuthProvider {
  // Lazy: createRemoteJWKSet fetches nothing until the first verification,
  // and caches keys after it, so constructing the provider is offline.
  const jwks = createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
  );

  return {
    kind: 'entra',
    async signIn(): Promise<SignInResult | null> {
      return { kind: 'redirect', authorizeUrl: buildAuthorizeUrl(tenantId, clientId) };
    },
    async validateToken(token: string): Promise<AuthUser | null> {
      try {
        // A v2 access token for the app's own API carries the bare client id
        // as `aud`, so the pinning is identical to the id_token's — the scp
        // check below is what tells the two apart (issue #184).
        const { payload } = await jwtVerify(token, jwks, {
          issuer: entraIssuer(tenantId),
          audience: clientId,
        });
        return sessionUserFromClaims(payload);
      } catch {
        return null; // malformed, expired, wrong tenant/audience — all just 401
      }
    },
  };
}
