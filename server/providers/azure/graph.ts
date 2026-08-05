// PRD 007 Req 3: the Microsoft Graph implementation of the user-directory
// seam — tenant user search and profile resolution for member pickers. Calls
// Graph as the signed-in caller with the request's bearer token (the proper
// on-behalf-of exchange lands with the sign-in flow, PRD Req 5's sibling
// issue). The fetch function is injected so unit tests pin the URL shapes and
// response mapping with no network; verified by typecheck + unit tests only.

import type { DirectoryProvider, DirectoryUser, RequestAuth } from '../types.ts';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface GraphUser {
  id: string;
  displayName?: string;
  userPrincipalName?: string;
}

function toDirectoryUser(u: GraphUser): DirectoryUser {
  return {
    id: u.id,
    displayName: u.displayName ?? u.userPrincipalName ?? u.id,
    username: u.userPrincipalName ?? '',
  };
}

export function createGraphDirectoryProvider(fetchImpl: FetchLike = fetch): DirectoryProvider {
  const headers = (auth: RequestAuth) => ({
    Authorization: `Bearer ${auth.token}`,
    // $search requires the eventual-consistency header on directory objects.
    ConsistencyLevel: 'eventual',
  });

  return {
    kind: 'graph',
    async search(query: string, auth: RequestAuth): Promise<DirectoryUser[]> {
      const q = query.trim();
      if (!q) return [];
      const url = new URL(`${GRAPH_BASE}/users`);
      const quoted = q.replace(/"/g, '');
      url.searchParams.set('$search', `"displayName:${quoted}" OR "userPrincipalName:${quoted}"`);
      url.searchParams.set('$select', 'id,displayName,userPrincipalName');
      url.searchParams.set('$top', '20');
      const res = await fetchImpl(url.toString(), { headers: headers(auth) });
      if (!res.ok) throw new Error(`Graph user search failed: ${res.status}`);
      const body = (await res.json()) as { value: GraphUser[] };
      return body.value.map(toDirectoryUser);
    },
    async getUser(id: string, auth: RequestAuth): Promise<DirectoryUser | null> {
      const url = `${GRAPH_BASE}/users/${encodeURIComponent(id)}?$select=id,displayName,userPrincipalName`;
      const res = await fetchImpl(url, { headers: headers(auth) });
      if (res.status === 404) return null; // left the tenant — caller renders a plain identifier
      if (!res.ok) throw new Error(`Graph user lookup failed: ${res.status}`);
      return toDirectoryUser((await res.json()) as GraphUser);
    },
  };
}
