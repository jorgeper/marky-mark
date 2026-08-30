// PRD 007 Req 3: the Microsoft Graph implementation of the user-directory
// seam — tenant user search and profile resolution for member pickers. Calls
// Graph as the signed-in caller with a token from the injected source — the
// on-behalf-of exchange (obo.ts, issue #180) in production — never with the
// request's session bearer, whose audience is the app itself and which Graph
// rejects as InvalidAuthenticationToken. The fetch function is injected so
// unit tests pin the URL shapes and response mapping with no network;
// verified by typecheck + unit tests only.

import type { DirectoryProvider, DirectoryUser, RequestAuth, UserPhoto } from '../types.ts';
import { userPhotoUrl } from '../types.ts';
import type { GraphTokenSource } from './obo.ts';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface GraphUser {
  id: string;
  displayName?: string;
  userPrincipalName?: string;
  userType?: string;
}

function toDirectoryUser(u: GraphUser): DirectoryUser {
  return {
    id: u.id,
    displayName: u.displayName ?? u.userPrincipalName ?? u.id,
    username: u.userPrincipalName ?? '',
    // PRD 007 Req 6: every Graph user gets the same-origin photo URL — Graph
    // cannot say who has a photo without one round trip per user, so the
    // photo endpoint's 404 (→ initials fallback) is the "no photo" signal.
    avatarUrl: userPhotoUrl(u.id),
    // PRD 007 Req 6 (issue #180): Graph's userType marks guests for the
    // People UI's badge; a response omitting it reads as a regular member.
    isGuest: u.userType === 'Guest',
  };
}

export function createGraphDirectoryProvider(
  fetchImpl: FetchLike = fetch,
  getGraphToken: GraphTokenSource,
): DirectoryProvider {
  const headers = async (auth: RequestAuth) => ({
    Authorization: `Bearer ${await getGraphToken(auth)}`,
    // $search requires the eventual-consistency header on directory objects.
    ConsistencyLevel: 'eventual',
  });

  return {
    kind: 'graph',
    async search(query: string, auth: RequestAuth): Promise<DirectoryUser[]> {
      const q = query.trim();
      if (!q) return [];
      const url = new URL(`${GRAPH_BASE}/users`);
      // Strip embedded double quotes: they would terminate the quoted
      // $search phrase early and break the query.
      const term = q.replace(/"/g, '');
      url.searchParams.set('$search', `"displayName:${term}" OR "userPrincipalName:${term}"`);
      url.searchParams.set('$select', 'id,displayName,userPrincipalName,userType');
      url.searchParams.set('$top', '20');
      const res = await fetchImpl(url.toString(), { headers: await headers(auth) });
      if (!res.ok) throw new Error(`Graph user search failed: ${res.status}`);
      const body = (await res.json()) as { value: GraphUser[] };
      return body.value.map(toDirectoryUser);
    },
    async getUser(id: string, auth: RequestAuth): Promise<DirectoryUser | null> {
      const url = `${GRAPH_BASE}/users/${encodeURIComponent(id)}?$select=id,displayName,userPrincipalName,userType`;
      const res = await fetchImpl(url, { headers: await headers(auth) });
      if (res.status === 404) return null; // left the tenant — caller renders a plain identifier
      if (!res.ok) throw new Error(`Graph user lookup failed: ${res.status}`);
      return toDirectoryUser((await res.json()) as GraphUser);
    },
    // PRD 007 Req 6: profile photo bytes via Graph /users/{id}/photo/$value.
    // 404 covers both "no photo" and "unknown user" — neither is an error,
    // both mean the client renders the initials fallback.
    async getUserPhoto(id: string, auth: RequestAuth): Promise<UserPhoto | null> {
      const url = `${GRAPH_BASE}/users/${encodeURIComponent(id)}/photo/$value`;
      const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${await getGraphToken(auth)}` },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Graph photo fetch failed: ${res.status}`);
      return {
        contentType: res.headers.get('content-type') ?? 'image/jpeg',
        data: new Uint8Array(await res.arrayBuffer()),
      };
    },
  };
}
