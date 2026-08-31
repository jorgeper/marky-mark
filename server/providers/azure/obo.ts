// PRD 007 Req 6 (issue #180): the OAuth2 on-behalf-of exchange behind the
// Graph directory provider. The session bearer is an access token for the
// app's own API (api://<client id>/access_as_user, issue #184 — Entra
// refuses an id_token as the jwt-bearer assertion, AADSTS240002) — Graph
// only accepts access tokens minted for https://graph.microsoft.com, so the
// server exchanges the caller's assertion at the tenant token endpoint
// (grant urn:ietf:params:oauth:grant-type:jwt-bearer, delegated
// User.ReadBasic.All only — never an application permission) and hands
// Graph the result. The token-endpoint fetch is injected like the Graph
// fetch, so unit tests pin the exchange offline.

import type { RequestAuth } from '../types.ts';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Resolves the Graph access token to act as this caller. */
export type GraphTokenSource = (auth: RequestAuth) => Promise<string>;

/** The delegated scope the exchange asks for — the whole permission set. */
export const GRAPH_OBO_SCOPE = 'https://graph.microsoft.com/User.ReadBasic.All';

/**
 * Drop a cached token this long before Entra's own expiry, so a token that
 * is about to lapse is never handed to a Graph call already in flight.
 */
export const OBO_EXPIRY_MARGIN_SECONDS = 300;

export interface OboTokenSourceOptions {
  tenantId: string;
  clientId: string;
  /**
   * The confidential-client credential (ENTRA_CLIENT_SECRET). Like
   * MM_LLM_API_KEY, its value never appears in a log line, error message,
   * or HTTP response — refusals below carry the token endpoint's status and
   * error code, never the request body.
   */
  clientSecret: string;
  fetchImpl?: FetchLike;
  /** Injectable clock (ms since epoch) so tests drive cache expiry. */
  now?: () => number;
}

interface CachedToken {
  token: Promise<string>;
  /** ms timestamp after which the cached token is not reused. */
  freshUntil: number;
}

/**
 * PRD 007 Req 6 (issue #180): exchanged tokens are cached server-side per
 * user for their validity window (expires_in minus a safety margin), so a
 * burst of directory calls — a search plus a page of avatars — costs one
 * exchange, not one per call. Concurrent first calls share one in-flight
 * exchange; a failed exchange is evicted so the next call retries.
 */
export function createOboTokenSource(options: OboTokenSourceOptions): GraphTokenSource {
  const { tenantId, clientId, clientSecret } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const cache = new Map<string, CachedToken>();

  async function exchange(assertion: string): Promise<{ token: string; expiresIn: number }> {
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      client_id: clientId,
      client_secret: clientSecret,
      assertion,
      scope: GRAPH_OBO_SCOPE,
      requested_token_use: 'on_behalf_of',
    });
    const res = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      // Name the OAuth error code and Entra's error_description (the AADSTS
      // line, e.g. "AADSTS240002 …" — issue #184) when the endpoint sends
      // them: the log then states the actual cause instead of a bare
      // invalid_request. Never the secret or the assertion.
      let code = '';
      let description = '';
      try {
        const body = (await res.json()) as { error?: unknown; error_description?: unknown };
        code = String(body.error ?? '');
        description = String(body.error_description ?? '');
      } catch {
        // non-JSON error body: the status alone is the diagnosis
      }
      throw new Error(
        `Graph token exchange failed: ${res.status}${code ? ` (${code})` : ''}${description ? `: ${description}` : ''}`,
      );
    }
    const payload = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== 'string' || payload.access_token === '') {
      throw new Error('Graph token exchange failed: token endpoint answered without an access_token');
    }
    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 0;
    return { token: payload.access_token, expiresIn };
  }

  return async (auth: RequestAuth): Promise<string> => {
    const key = auth.user.id;
    const cached = cache.get(key);
    if (cached && cached.freshUntil > now()) return cached.token;

    const entry: CachedToken = { token: Promise.resolve(''), freshUntil: 0 };
    entry.token = exchange(auth.token).then(
      ({ token, expiresIn }) => {
        entry.freshUntil = now() + (expiresIn - OBO_EXPIRY_MARGIN_SECONDS) * 1000;
        return token;
      },
      (err: unknown) => {
        // Never cache a failure: evict so the next call re-attempts.
        if (cache.get(key) === entry) cache.delete(key);
        throw err;
      },
    );
    // Fresh "forever" while in flight so concurrent calls share the one
    // exchange; the resolution above rewrites it to the real window.
    entry.freshUntil = Number.POSITIVE_INFINITY;
    cache.set(key, entry);
    return entry.token;
  };
}
