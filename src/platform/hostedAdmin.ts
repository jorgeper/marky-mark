// PRD 017 Req 14: the client's transport to the four /api/admin routes —
// built ON the hosted platform's one `api()` fetch wrapper (the
// createHostedLlm pattern), so it adds no network call site and the
// validate gate's FETCH_ALLOWLIST stays pinned where it is. Exposed as an
// optional Platform capability: app code mounts the Management view on the
// capability being present, never on the flavor.

import type { AdminUserRow, AdminWorkspaceRow } from '../lib/deploymentAdmin';
import type { DeploymentSettings, EffectiveDeploymentSettings } from '../lib/deploymentSettings';

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
  };
}
