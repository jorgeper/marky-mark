// PRD 017 Req 29 (issue #190): the shared pure layer of in-app guest
// invitations — the body parser the server route AND both client surfaces
// validate with (so a 400 is predicted, never discovered), the
// invitation-mail template, the Req 32 picker predicate, and the redirect
// origin the invitee lands on. Pure data-in/data-out: the route, the fetch
// wrapper and the components stay thin shells around this module.

import { BUILT_IN_ROLES } from './hostedWorkspace.ts';

/** PRD 017 Req 29: the longest note an invitation mail may append. */
export const INVITATION_NOTE_MAX = 500;

/** The optional same-request role grant (PRD 017 Req 30). */
export interface InvitationWorkspaceGrant {
  id: string;
  role: string;
}

/** The body of `POST /api/admin/invitations`. */
export interface InvitationRequest {
  email: string;
  note?: string;
  workspace?: InvitationWorkspaceGrant;
  // Issue #195: false suppresses Microsoft's invitation mail — the form's
  // Get invite link creates the guest and surfaces the redeem URL instead.
  // Absent means true (the mail goes out), so the parser only keeps `false`.
  sendEmail?: boolean;
}

export type InvitationParse =
  | { ok: true; invitation: InvitationRequest }
  | { ok: false; error: string };

// PRD 017 Req 29: "syntactically valid" for an invitation — something@domain
// with a dotted domain and no whitespace. External invitees always carry a
// public address; a stricter RFC dance would refuse nothing real.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether a typed value reads as an invitable email address. */
export function isInvitableEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

const fail = (error: string): InvitationParse => ({ ok: false, error });

/**
 * PRD 017 Req 29: validate `{ email, note?, workspace? }`. `knownRoles`
 * defaults to the built-in role names; the server passes the target
 * workspace's grantable set (custom roles included) when a grant rides
 * along, and the picker predicts with the same list it offers.
 */
export function parseInvitationRequest(
  data: unknown,
  knownRoles: readonly string[] = Object.keys(BUILT_IN_ROLES),
): InvitationParse {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return fail('the body must be an object');
  }
  const { email, note, workspace, sendEmail } = data as {
    email?: unknown;
    note?: unknown;
    workspace?: unknown;
    sendEmail?: unknown;
  };
  if (typeof email !== 'string' || !isInvitableEmail(email)) {
    return fail('email must be a valid address');
  }
  if (note !== undefined) {
    if (typeof note !== 'string') return fail('the note must be text');
    if (note.length > INVITATION_NOTE_MAX) {
      return fail(`the note must stay within ${INVITATION_NOTE_MAX} characters`);
    }
  }
  // Issue #195: anything but a boolean is a named refusal, and the default
  // (send the mail) stays implicit — only an explicit false is kept.
  if (sendEmail !== undefined && typeof sendEmail !== 'boolean') {
    return fail('sendEmail must be true or false');
  }
  let grant: InvitationWorkspaceGrant | undefined;
  if (workspace !== undefined) {
    if (typeof workspace !== 'object' || workspace === null || Array.isArray(workspace)) {
      return fail('workspace must be {id, role}');
    }
    const { id, role } = workspace as { id?: unknown; role?: unknown };
    if (typeof id !== 'string' || id === '') return fail('workspace must be {id, role}');
    if (typeof role !== 'string' || !knownRoles.includes(role)) {
      return fail(`unknown role '${typeof role === 'string' ? role : ''}'`);
    }
    grant = { id, role };
  }
  return {
    ok: true,
    invitation: {
      email: email.trim(),
      ...(typeof note === 'string' && note !== '' ? { note } : {}),
      ...(grant ? { workspace: grant } : {}),
      ...(sendEmail === false ? { sendEmail } : {}),
    },
  };
}

/**
 * PRD 017 Req 29: the fixed invitation-mail body — the inviter's display
 * name and Marky Mark, then the optional note on its own paragraph.
 */
export function invitationMessage(inviterDisplayName: string, note?: string): string {
  const lead = `${inviterDisplayName} has invited you to collaborate in Marky Mark.`;
  const extra = note?.trim();
  return extra ? `${lead}\n\n${extra}` : lead;
}

/**
 * PRD 017 Req 32: whether the picker offers its one extra row — the caller
 * is a deployment admin (`/api/me`'s `admin`), the typed query reads as an
 * email, and the settled search matched nobody in the directory.
 */
export function offersInviteRow(
  me: { admin?: boolean } | null | undefined,
  query: string,
  results: readonly { id: string }[],
): boolean {
  return me?.admin === true && isInvitableEmail(query) && results.length === 0;
}

/**
 * Issue #193: the rescind eligibility decision — null when the target may
 * be deleted (a guest whose invitation is still unredeemed, Req 33's
 * `pending` flag), else the route's 409 sentence naming why not. Members,
 * accepted guests and admins are never deletable from the app; that stays
 * in Entra.
 */
export function rescindRefusal(
  user: { displayName: string; isGuest?: boolean; pending?: boolean } | null,
): string | null {
  if (user === null) return 'the directory knows no user with that id';
  if (user.isGuest !== true) {
    return `${user.displayName} is a member of the tenant, not an invited guest — members are managed in Entra`;
  }
  if (user.pending !== true) {
    return `${user.displayName} has already accepted their invitation — accepted guests are managed in Entra`;
  }
  return null;
}

/**
 * PRD 017 Req 29: `inviteRedirectUrl` — the deployment's origin with a
 * trailing slash, from the request's own Host (the SPA and the API share
 * one origin) and the proxy's `x-forwarded-proto` when one fronts us
 * (Azure App Service does); plain local serving stays http.
 */
export function deploymentOrigin(hostHeader: string | undefined, forwardedProto?: string): string {
  const host = hostHeader?.trim() || 'localhost';
  const proto = (forwardedProto ?? '').split(',')[0]!.trim() || 'http';
  return `${proto}://${host}/`;
}
