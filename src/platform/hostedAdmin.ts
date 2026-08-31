// PRD 017 Req 14: the client's transport to the /api/admin routes —
// built ON the hosted platform's one `api()` fetch wrapper (the
// createHostedLlm pattern), so it adds no network call site and the
// validate gate's FETCH_ALLOWLIST stays pinned where it is. Exposed as an
// optional Platform capability: app code mounts the Management view on the
// capability being present, never on the flavor.

import type { AdminUserRow, AdminWorkspaceRow } from '../lib/deploymentAdmin';
import type { DeploymentSettings, EffectiveDeploymentSettings } from '../lib/deploymentSettings';
import type { InvitationRequest } from '../lib/invitations';

/** PRD 017 Req 29: what a 201 from POST /api/admin/invitations carries. */
export interface InvitedGuest {
  id: string;
  email: string;
  displayName: string;
  pending: true;
  // Issue #195: Graph yields the redeem URL only at creation, so every 201
  // carries it — the invite surfaces show it beside their success.
  redeemUrl: string;
  /** Req 30: present when the invitation landed but the role grant did not. */
  membership?: { error: string };
}

/** The hosted platform's authorized fetch — the one call site. */
type ApiFetch = (
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: BodyInit },
) => Promise<Response>;

/**
 * PRD 017 Reqs 14+16+19+20: what the Management view calls. The listings
 * REJECT on a failed answer (issue #183 §3's rule): the tabs show an error
 * state, never an empty deployment. Writing settings answers the server's
 * own named refusal instead, for the tab to show verbatim.
 */
export interface DeploymentAdmin {
  /** Req 16: every workspace in the deployment, with statistics. */
  listWorkspaces(): Promise<AdminWorkspaceRow[]>;
  /** Req 19: every tenant user, admin-flagged. */
  listUsers(): Promise<AdminUserRow[]>;
  /** Req 14: the stored settings plus the Req 7 parse error when present. */
  readSettings(): Promise<EffectiveDeploymentSettings>;
  /** Req 14/20: replace the record — last write wins, no ETag. */
  writeSettings(settings: DeploymentSettings): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * PRD 017 Req 29: invite a guest — the refusal is the server's own
   * sentence (a 400's parser message, a 502's Graph refusal) for the two
   * invite surfaces to show inline, verbatim.
   */
  invite(request: InvitationRequest): Promise<{ ok: true; guest: InvitedGuest } | { ok: false; error: string }>;
  /**
   * Issue #193: rescind an invitation — delete the pending guest and its
   * workspace memberships. The refusal is the server's own sentence (the
   * 409's eligibility message, a 502's Graph refusal) shown verbatim.
   */
  rescind(userId: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Issue #195: a fresh redeem URL for a pending guest — the server
   * re-POSTs the invitation with the mail suppressed. The refusal is the
   * server's own sentence (the 409's eligibility message, a 502's Graph
   * refusal) for the People row to show verbatim.
   */
  inviteLink(userId: string): Promise<{ ok: true; redeemUrl: string } | { ok: false; error: string }>;
}

/** The server's error shape, when it sent one at all. */
async function errorOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (typeof body.error === 'string') return body.error;
  } catch {
    // A non-JSON failure still needs a sentence.
  }
  return `The server answered ${res.status}.`;
}

export function createHostedAdmin(api: ApiFetch): DeploymentAdmin {
  const getJson = async <T>(path: string): Promise<T> => {
    const res = await api(path);
    if (!res.ok) throw new Error(await errorOf(res));
    return (await res.json()) as T;
  };
  return {
    listWorkspaces: () => getJson<AdminWorkspaceRow[]>('/api/admin/workspaces'),
    listUsers: () => getJson<AdminUserRow[]>('/api/admin/users'),
    readSettings: () => getJson<EffectiveDeploymentSettings>('/api/admin/settings'),
    async writeSettings(settings) {
      const res = await api('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) return { ok: true };
      return { ok: false, error: await errorOf(res) };
    },
    async invite(request) {
      const res = await api('/api/admin/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) return { ok: false, error: await errorOf(res) };
      return { ok: true, guest: (await res.json()) as InvitedGuest };
    },
    async rescind(userId) {
      const res = await api(`/api/admin/invitations/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) return { ok: false, error: await errorOf(res) };
      return { ok: true };
    },
    async inviteLink(userId) {
      const res = await api(`/api/admin/invitations/${encodeURIComponent(userId)}/link`, {
        method: 'POST',
      });
      if (!res.ok) return { ok: false, error: await errorOf(res) };
      const { redeemUrl } = (await res.json()) as { redeemUrl: string };
      return { ok: true, redeemUrl };
    },
  };
}
