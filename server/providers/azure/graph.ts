// PRD 007 Req 3: the Microsoft Graph implementation of the user-directory
// seam — tenant user search and profile resolution for member pickers. Calls
// Graph as the signed-in caller with a token from the injected source — the
// on-behalf-of exchange (obo.ts, issue #180) in production — never with the
// request's session bearer, whose audience is the app itself and which Graph
// rejects as InvalidAuthenticationToken. The fetch function is injected so
// unit tests pin the URL shapes and response mapping with no network;
// verified by typecheck + unit tests only.

import type {
  DirectoryDeleteResult,
  DirectoryInvitation,
  DirectoryInviteResult,
  DirectoryProvider,
  DirectoryUser,
  RequestAuth,
  UserPhoto,
} from '../types.ts';
import { userPhotoUrl } from '../types.ts';
import type { GraphTokenSource } from './obo.ts';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface GraphUser {
  id: string;
  displayName?: string;
  userPrincipalName?: string;
  userType?: string;
  externalUserState?: string;
  mail?: string;
}

// PRD 017 Req 33: externalUserState joins the $select of search, getUser and
// listUsers, so an unredeemed invitation reads as Pending everywhere.
// Issue #195: mail joins it too — a guest's userPrincipalName is the mangled
// #EXT# form, and the copy-link re-POST needs the real invited address.
const USER_SELECT = 'id,displayName,userPrincipalName,userType,externalUserState,mail';

/**
 * A Graph refusal AS DATA — error.code and message from the JSON body when
 * there is one, else the caller's status-line fallback stands as the
 * diagnosis. Shared by invite and deleteUser, whose routes surface it as a
 * 502; never a token in either field.
 */
async function graphRefusal(
  res: Response,
  fallback: string,
): Promise<{ ok: false; code: string; message: string }> {
  let code = '';
  let message = fallback;
  try {
    const refusal = (await res.json()) as { error?: { code?: unknown; message?: unknown } };
    code = String(refusal.error?.code ?? '');
    if (refusal.error?.message !== undefined) message = String(refusal.error.message);
  } catch {
    // non-JSON refusal: the fallback status line is the diagnosis
  }
  return { ok: false, code, message };
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
    // PRD 017 Req 33: only an unredeemed invitation carries the flag at all.
    ...(u.externalUserState === 'PendingAcceptance' ? { pending: true } : {}),
    // Issue #195: the real mail address, when Graph records one.
    ...(u.mail ? { email: u.mail } : {}),
  };
}

export function createGraphDirectoryProvider(
  fetchImpl: FetchLike,
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
      url.searchParams.set('$select', USER_SELECT);
      url.searchParams.set('$top', '20');
      const res = await fetchImpl(url.toString(), { headers: await headers(auth) });
      if (!res.ok) throw new Error(`Graph user search failed: ${res.status}`);
      const body = (await res.json()) as { value: GraphUser[] };
      return body.value.map(toDirectoryUser);
    },
    // PRD 017 Req 19: every tenant user, paged. The first page is the PRD's
    // pinned URL — /users with the same $select as search and $top=999 (the
    // endpoint's page cap) — and each @odata.nextLink is followed verbatim,
    // as Graph requires. Delegated User.ReadBasic.All over the existing OBO
    // token already covers it: no new registration permission. A non-OK page
    // throws, so the admin route answers an error, never a truncated tenant.
    async listUsers(auth: RequestAuth): Promise<DirectoryUser[]> {
      const first = new URL(`${GRAPH_BASE}/users`);
      first.searchParams.set('$select', USER_SELECT);
      first.searchParams.set('$top', '999');
      const users: DirectoryUser[] = [];
      let next: string | null = first.toString();
      while (next) {
        const res = await fetchImpl(next, {
          headers: { Authorization: `Bearer ${await getGraphToken(auth)}` },
        });
        if (!res.ok) throw new Error(`Graph user listing failed: ${res.status}`);
        const body = (await res.json()) as { value: GraphUser[]; '@odata.nextLink'?: string };
        users.push(...body.value.map(toDirectoryUser));
        next = body['@odata.nextLink'] ?? null;
      }
      return users;
    },
    async getUser(id: string, auth: RequestAuth): Promise<DirectoryUser | null> {
      const url = `${GRAPH_BASE}/users/${encodeURIComponent(id)}?$select=${USER_SELECT}`;
      const res = await fetchImpl(url, { headers: await headers(auth) });
      if (res.status === 404) return null; // left the tenant — caller renders a plain identifier
      if (!res.ok) throw new Error(`Graph user lookup failed: ${res.status}`);
      return toDirectoryUser((await res.json()) as GraphUser);
    },
    // PRD 017 Req 29: Graph POST /v1.0/invitations AS THE SIGNED-IN ADMIN —
    // the OBO token now carries User.Invite.All, so Entra's own guest-invite
    // policy (allowInvitesFrom) applies to the caller, never to an app
    // identity. sendInvitationMessage lets Microsoft's mail carry the pure
    // template's body. A Graph refusal (already in tenant, blocked domain,
    // missing consent) comes back AS DATA — its error.code and message feed
    // the route's 502 — and neither path ever includes a token.
    async invite(invitation: DirectoryInvitation, auth: RequestAuth): Promise<DirectoryInviteResult> {
      const res = await fetchImpl(`${GRAPH_BASE}/invitations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await getGraphToken(auth)}`,
          'Content-Type': 'application/json',
        },
        // Issue #195: with the mail suppressed there is nothing to carry the
        // customized body, so the message rides along only when one is sent.
        body: JSON.stringify({
          invitedUserEmailAddress: invitation.email,
          inviteRedirectUrl: invitation.redirectUrl,
          sendInvitationMessage: invitation.sendEmail,
          ...(invitation.sendEmail
            ? { invitedUserMessageInfo: { customizedMessageBody: invitation.message } }
            : {}),
        }),
      });
      if (!res.ok) return graphRefusal(res, `Graph refused the invitation (${res.status})`);
      const body = (await res.json()) as {
        invitedUser?: { id?: string };
        invitedUserDisplayName?: string;
        inviteRedeemUrl?: string;
      };
      const id = body.invitedUser?.id;
      if (!id) return { ok: false, code: '', message: 'Graph answered without an invitedUser.id' };
      // Issue #195: the redeem URL exists only in this creation answer; it
      // is returned as data and must never be logged.
      if (!body.inviteRedeemUrl) {
        return { ok: false, code: '', message: 'Graph answered without an inviteRedeemUrl' };
      }
      return {
        ok: true,
        redeemUrl: body.inviteRedeemUrl,
        user: {
          id,
          displayName: body.invitedUserDisplayName || invitation.email,
          username: invitation.email,
          avatarUrl: userPhotoUrl(id),
          isGuest: true,
          pending: true,
          email: invitation.email,
        },
      };
    },
    // Issue #193: rescind — Graph DELETE /v1.0/users/{id} AS THE SIGNED-IN
    // ADMIN (the OBO token now carries User.ReadWrite.All), so Entra's own
    // authorization applies to the caller, never to an app identity. A Graph
    // refusal comes back AS DATA — its error.code and message feed the
    // route's 502 — and neither path ever includes a token.
    async deleteUser(id: string, auth: RequestAuth): Promise<DirectoryDeleteResult> {
      const res = await fetchImpl(`${GRAPH_BASE}/users/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${await getGraphToken(auth)}` },
      });
      if (!res.ok) return graphRefusal(res, `Graph refused the deletion (${res.status})`);
      return { ok: true };
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
