/**
 * PRD 010 Req 18: the pure half of the connection surface in Workspace
 * settings — what a repo-backed workspace's connection reads as, whether it
 * is healthy, and what a broken one says in the Open dialog's list.
 *
 * No I/O, no DOM, no `react`: `src/components/WorkspaceConnectionSettings.tsx`
 * renders what these functions return, exactly as `WorkspaceSwitcher.tsx` is a
 * shell over `workspaceLifecycle.ts`. Every GitHub call behind the payload is
 * the SERVER's, made with the deployment's App credentials — no GitHub host
 * string appears in `src/` and no new client call site exists, because the
 * transport is the same bearer-stamped `api()` wrapper as the rest of the
 * lifecycle (PRD 010 Req 2+4).
 */

import { summarize, type RepoConnection } from './githubConnectWizard';
import type { WorkspaceListing } from './workspaceLifecycle';

/**
 * PRD 010 Req 18: how the deployment's App installation stands for this
 * connection. The split is `connectionFailureStatus`'s, kept end to end:
 * GitHub refusing or not having it is one thing the admin can act on, GitHub
 * being unavailable is another they can only wait out.
 */
export type ConnectionHealth =
  | { state: 'ok' }
  | { state: 'blocked'; message: string }
  | { state: 'unavailable'; message: string };

/**
 * PRD 010 Req 18: what `GET /api/workspaces/<id>/connection` answers. A
 * workspace that is not repo-backed answers `{connected: false}` and nothing
 * else — Req 3 stands, so nothing here reveals which backend a
 * default-storage workspace uses.
 *
 * PRD 010 Req 2: nothing in this payload is a credential. The health is a
 * state plus a sentence; no App JWT, installation token or response dump ever
 * reaches the client.
 */
export type WorkspaceConnectionPayload =
  | { connected: false }
  | {
      connected: true;
      owner: string;
      repo: string;
      branch: string;
      /** Absent means the repo root. */
      root?: string;
      health: ConnectionHealth;
    };

/** The connection as the settings section shows it — four readable lines. */
export interface ConnectionDescription {
  /** `owner/repo`. */
  repo: string;
  branch: string;
  /** The chosen root in words; the repo root when no subdirectory was picked. */
  location: string;
  /** Installed and writable, or the named reason it is not. */
  status: string;
  healthy: boolean;
}

/** The one sentence a healthy connection gets — a state, never a dump. */
export const INSTALLED_AND_WRITABLE = 'Installed, with write access to this repository.';

/**
 * PRD 010 Req 18: the connection section's content, or null when there is
 * nothing to show. Null covers BOTH "not repo-backed" and "the payload has
 * not arrived yet", so the component renders nothing at all in either case
 * rather than an empty state or a "default storage" label.
 */
export function describeConnection(payload: WorkspaceConnectionPayload | null): ConnectionDescription | null {
  if (!payload || !payload.connected) return null;
  const connection: RepoConnection = {
    kind: 'repo',
    owner: payload.owner,
    repo: payload.repo,
    branch: payload.branch,
    ...(payload.root ? { root: payload.root } : {}),
  };
  const summary = summarize(connection);
  return {
    repo: summary.repo,
    branch: summary.branch,
    location: summary.location,
    status: payload.health.state === 'ok' ? INSTALLED_AND_WRITABLE : payload.health.message,
    healthy: payload.health.state === 'ok',
  };
}

/**
 * PRD 010 Req 18: whether the connection section renders at all. It is the
 * `workspace.settings` holder's surface and nobody else's — the route behind
 * it refuses anyone else by name regardless of what this answers, the pattern
 * `WorkspaceAccessSettings` already uses for its own verbs.
 */
export function mayManageConnection(permissions: readonly string[]): boolean {
  return permissions.includes('workspace.settings');
}

/**
 * PRD 010 Req 18: the Open dialog's row for a workspace whose backend could
 * not be reached. It is LISTED, with the reason, rather than dropped — an
 * owner has to be able to find it to repair it. Returns null for every
 * healthy row, so the dialog's existing no-access phrasing is untouched.
 */
export function attentionReason(listing: WorkspaceListing): string | null {
  return listing.attention ? listing.attention : null;
}
