// PRD 007 Req 3: the Microsoft Entra ID implementation of the auth seam.
// Sign-in is an auth-code + PKCE flow the SPA drives (PRD Req 5, a sibling
// issue), so signIn answers with the tenant's authorize URL; token validation
// verifies incoming bearer JWTs against the tenant's published JWKS (issuer +
// audience pinned to the single-tenant app registration). Verified by
// typecheck and unit tests only — no cloud calls in CI.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AuthProvider, AuthUser, SignInResult } from '../types.ts';

/** The v2.0 issuer for a single-tenant app registration. */
export function entraIssuer(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/v2.0`;
}

/**
 * The authorize endpoint the SPA redirects to. The SPA appends its own
 * redirect_uri and PKCE code_challenge; the server only pins tenant, client
 * and the S256 challenge method.
 */
export function buildAuthorizeUrl(tenantId: string, clientId: string): string {
  const url = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
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
        const { payload } = await jwtVerify(token, jwks, {
          issuer: entraIssuer(tenantId),
          audience: clientId,
        });
        return {
          id: String(payload.oid ?? payload.sub ?? ''),
          username: String(payload.preferred_username ?? ''),
          displayName: String(payload.name ?? payload.preferred_username ?? ''),
        };
      } catch {
        return null; // malformed, expired, wrong tenant/audience — all just 401
      }
    },
  };
}
