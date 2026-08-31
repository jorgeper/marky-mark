// PRD 007 Req 4: local dev mode's user directory — case-insensitive substring
// search over the seeded test users, mirroring how the Graph implementation
// answers member pickers, with zero network. PRD 017 Req 33 (issue #190): it
// also accepts invitations — an invite adds an in-memory pending guest that
// search, getUser and listUsers then answer with — so the whole
// guest-invitation flow is e2e-testable offline.

import type {
  DirectoryDeleteResult,
  DirectoryInvitation,
  DirectoryInviteResult,
  DirectoryProvider,
  DirectoryUser,
  UserPhoto,
} from '../types.ts';
import { userPhotoUrl } from '../types.ts';
import { SEEDED_USERS } from './users.ts';

// PRD 007 Req 6: one seeded user has no photo, so the "no photo → 404 →
// initials fallback" path is exercisable offline, exactly like a Graph user
// who never uploaded a picture.
const PHOTOLESS_IDS = new Set(['mock-katherine']);

// PRD 007 Req 6: deterministic avatars with zero assets and zero network —
// an SVG initials disc whose hue is derived from the user id, so local dev
// and e2e render the same picture on every run.
function avatarSvg(user: DirectoryUser): string {
  let hash = 0;
  for (const ch of user.id) hash = (hash * 31 + ch.codePointAt(0)!) % 360;
  const initials = user.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0]!.toUpperCase())
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="32" fill="hsl(${hash}, 55%, 45%)"/>` +
    `<text x="32" y="41" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#fff">${initials}</text>` +
    `</svg>`
  );
}

/** The seeded user decorated with its same-origin avatar URL, when it has a photo. */
function withAvatar(user: DirectoryUser): DirectoryUser {
  return PHOTOLESS_IDS.has(user.id) ? user : { ...user, avatarUrl: userPhotoUrl(user.id) };
}

/** PRD 017 Req 33: the deterministic id an invited email lands under. */
export function mockInvitationId(email: string): string {
  return `mock-invite-${email.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

/**
 * Issue #195: the deterministic fake redeem URL the mock answers on every
 * invitation creation — what real Graph's inviteRedeemUrl is offline, so
 * the copy-link e2e flows can pin an exact value.
 */
export function mockRedeemUrl(id: string): string {
  return `https://invitations.mock.example/redeem/${id}`;
}

/** PRD 017 Req 33: the e2e lane's levers over the in-memory invitations. */
export interface InvitationTestHooks {
  /** Mark an invited guest redeemed (Graph: externalUserState leaves PendingAcceptance). */
  acceptInvitation(id: string): boolean;
  /** Forget an invitation entirely, so a test restores the seeded directory. */
  withdrawInvitation(id: string): boolean;
  // Issue #195: whether the LAST invite for the id asked the directory to
  // send its mail — how the e2e lane proves Get invite link suppressed it.
  /** null when the id was never invited this run. */
  invitationSendEmail(id: string): boolean | null;
}

/**
 * The hooks when the wired directory is the mock one, else null — how
 * app.ts offers the accept/withdraw test endpoints ONLY on the local lane.
 */
export function invitationTestHooks(directory: DirectoryProvider): InvitationTestHooks | null {
  const maybe = directory as DirectoryProvider & Partial<InvitationTestHooks>;
  return typeof maybe.acceptInvitation === 'function' &&
    typeof maybe.withdrawInvitation === 'function' &&
    typeof maybe.invitationSendEmail === 'function'
    ? (maybe as DirectoryProvider & InvitationTestHooks)
    : null;
}

export function createMockDirectoryProvider(): DirectoryProvider & InvitationTestHooks {
  // PRD 017 Req 33: invited guests live in memory — reset by a restart or
  // the withdraw hook, which is exactly what the offline e2e lane needs.
  const invited: DirectoryUser[] = [];
  // Issue #195: the last invite's sendEmail per invited id, for the hook.
  const sendFlags = new Map<string, boolean>();
  const all = (): DirectoryUser[] => [...SEEDED_USERS, ...invited];
  return {
    kind: 'mock',
    async search(query: string): Promise<DirectoryUser[]> {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return all()
        .filter((u) => u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q))
        .map(withAvatar);
    },
    async getUser(id: string): Promise<DirectoryUser | null> {
      const found = all().find((u) => u.id === id);
      return found ? withAvatar(found) : null;
    },
    // PRD 017 Req 19: the whole tenant is the seeded list — the same five
    // users sign-in and search answer from, avatars stamped the same way —
    // plus (Req 33) whatever guests have been invited since.
    async listUsers(): Promise<DirectoryUser[]> {
      return all().map(withAvatar);
    },
    // PRD 017 Req 33: a POST creates an in-memory pending guest. Inviting an
    // address the directory already knows as a seeded user or an ACCEPTED
    // guest answers Graph's own refusal shape, so the Req 29 refusal lane
    // (502, message shown inline) stays drivable offline. Issue #195:
    // re-inviting a still-PENDING invited guest succeeds again with a fresh
    // deterministic redeem URL — mirroring real Graph, whose /invitations
    // re-POST is exactly how a redeem URL is obtained for a pending guest.
    async invite({ email, sendEmail }: DirectoryInvitation): Promise<DirectoryInviteResult> {
      const address = email.trim();
      const q = address.toLowerCase();
      const existing = all().find((u) => u.username.toLowerCase() === q);
      if (existing && existing.pending !== true) {
        return {
          ok: false,
          code: 'invitedUserAlreadyExists',
          message: `A user with the address ${address} already exists in the directory.`,
        };
      }
      const user: DirectoryUser = existing ?? {
        id: mockInvitationId(address),
        username: address,
        displayName: address,
        isGuest: true,
        pending: true,
        email: address,
      };
      if (!existing) invited.push(user);
      sendFlags.set(user.id, sendEmail);
      return { ok: true, user: withAvatar(user), redeemUrl: mockRedeemUrl(user.id) };
    },
    // Issue #193: rescind support — deleting forgets an invited guest, the
    // Graph-faithful mirror of DELETE /v1.0/users/{id}. The seeded users are
    // the mock's fixed tenant, so asking to delete one refuses with a
    // Graph-shaped code the route's 502 can carry (the admin route's own
    // 409 eligibility gate refuses first in every real flow).
    async deleteUser(id: string): Promise<DirectoryDeleteResult> {
      const at = invited.findIndex((u) => u.id === id);
      if (at !== -1) {
        invited.splice(at, 1);
        return { ok: true };
      }
      return {
        ok: false,
        code: 'Request_ResourceNotFound',
        message: `The directory refused to delete ${id}.`,
      };
    },
    acceptInvitation(id: string): boolean {
      const found = invited.find((u) => u.id === id);
      if (!found) return false;
      found.pending = false;
      return true;
    },
    withdrawInvitation(id: string): boolean {
      const at = invited.findIndex((u) => u.id === id);
      if (at === -1) return false;
      invited.splice(at, 1);
      sendFlags.delete(id);
      return true;
    },
    invitationSendEmail(id: string): boolean | null {
      return sendFlags.get(id) ?? null;
    },
    async getUserPhoto(id: string): Promise<UserPhoto | null> {
      const found = all().find((u) => u.id === id);
      if (!found || PHOTOLESS_IDS.has(id)) return null;
      return { contentType: 'image/svg+xml', data: new TextEncoder().encode(avatarSvg(found)) };
    },
  };
}
