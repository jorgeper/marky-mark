/**
 * PRD 007 Req 10/11/12: the hosted flavor's workspace-lifecycle client — the
 * REST calls behind create, list/open and delete, plus the directory lookups
 * the flows need. It is exposed on the Platform seam as the optional
 * `workspaces` capability, so app code mounts the flows by asking whether the
 * capability exists (never whether the flavor is hosted, PRD 007 Req 2).
 *
 * Everything here is transport; the decisions live in the pure functions of
 * src/lib/workspaceLifecycle.ts and src/lib/hostedWorkspace.ts.
 */

import { readStoredToken } from '../lib/hostedGate';
import { resolveMembers, type DirectoryEntry, type MemberEntry, type MemberRef } from '../lib/membership';
import { workspaceIdFromSearch } from '../lib/hostedPaths';
import {
  resolvePermissions,
  validateWorkspaceManifest,
  type CreateWorkspaceRequest,
  type CustomRoleInput,
  type ManifestResult,
  type Permission,
  type WorkspaceManifest,
  type WorkspaceMember,
} from '../lib/hostedWorkspace';
import type { WorkspaceListing } from '../lib/workspaceLifecycle';

/** The lifecycle seam the workspace UI is written against. */
export interface WorkspaceLifecycle {
  /** The workspace this page is bound to, or null when none is open. */
  currentId(): string | null;
  /** PRD 007 Req 11: every workspace in the deployment, with access + owners. */
  list(): Promise<WorkspaceListing[]>;
  /** PRD 007 Req 10: create; the error string is the server's own 400 message. */
  create(request: CreateWorkspaceRequest): Promise<{ id: string } | { error: string }>;
  /** PRD 007 Req 12: delete every server-side blob of a workspace. */
  remove(id: string): Promise<boolean>;
  /** The signed-in user's resolved permissions in a workspace ([] without access). */
  permissions(id: string): Promise<Permission[]>;
  /** PRD 007 Req 15+16: the stored manifest, or null when the read is refused. */
  manifest(id: string): Promise<WorkspaceManifest | null>;
  /**
   * PRD 007 Req 16: membership edits — all behind `workspace.members`. Each
   * answers the same `ManifestResult` the pure decision has: the manifest as
   * stored, or the server's own named refusal (a 403's verb, or a 400's
   * last-Owner / in-use / built-in message) for the UI to show verbatim.
   */
  addMember(id: string, member: WorkspaceMember): Promise<ManifestResult>;
  setMemberRole(id: string, userId: string, role: string): Promise<ManifestResult>;
  removeMember(id: string, userId: string): Promise<ManifestResult>;
  setEveryone(id: string, everyone: { enabled: boolean; role?: string }): Promise<ManifestResult>;
  /** PRD 007 Req 15: custom-role edits — all behind `workspace.roles`. */
  createRole(id: string, role: CustomRoleInput): Promise<ManifestResult>;
  updateRole(id: string, name: string, role: CustomRoleInput): Promise<ManifestResult>;
  deleteRole(id: string, name: string): Promise<ManifestResult>;
  /**
   * Directory search for the membership picker. Rejects on a failed answer
   * (issue #183 §3) so the picker can tell an error from an empty match.
   */
  searchUsers(query: string): Promise<DirectoryEntry[]>;
  /**
   * Stored members → display entries. A ref carrying the manifest's
   * display-name snapshot (issue #180) falls back to it when the directory
   * cannot answer; a bare id stays a plain identifier.
   */
  resolveUsers(members: readonly MemberRef[]): Promise<MemberEntry[]>;
  /** Bind the page to a workspace (null: leave — the start page, no workspace). */
  navigateTo(id: string | null): void;
  /**
   * PRD 009 Req 6: drop the binding WITHOUT navigating — Close Workspace and
   * every crossing action into single-file mode must leave a reload on the
   * initial page, and a navigation would discard the file being opened.
   */
  unbind(): void;
}

export function createHostedWorkspaceLifecycle(
  // PRD 017 Req 3: the session-held /api/me record, injected by hosted.ts —
  // this module reads the one held answer instead of re-fetching per use.
  sessionMe: () => Promise<{ id: string; admin?: boolean } | null>,
): WorkspaceLifecycle {
  const token = () => readStoredToken(window.localStorage) ?? '';
  const api = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    fetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token()}` } });
  const json = async <T>(res: Response): Promise<T | null> => (res.ok ? ((await res.json()) as T) : null);

  /**
   * PRD 007 Req 6: an <img> cannot carry an Authorization header, so a
   * directory avatar URL only loads when the bearer rides in the query
   * string — the same concession the workspace asset URLs make, and the same
   * one the server accepts for GETs alone. Stamping it here keeps the
   * membership picker a plain component that just renders what it is given.
   */
  const withAvatarToken = <T extends DirectoryEntry>(user: T): T =>
    user.avatarUrl ? { ...user, avatarUrl: `${user.avatarUrl}?access_token=${encodeURIComponent(token())}` } : user;

  const getUser = async (id: string): Promise<DirectoryEntry | null> => {
    const user = await json<DirectoryEntry>(await api(`/api/directory/users/${encodeURIComponent(id)}`));
    return user ? withAvatarToken(user) : null;
  };

  const workspacePath = (id: string, rest = ''): string =>
    `/api/workspaces/${encodeURIComponent(id)}${rest}`;

  const readManifest = async (res: Response): Promise<WorkspaceManifest | null> => {
    const body = await json<{ manifest: unknown }>(res);
    if (!body) return null;
    const validated = validateWorkspaceManifest(body.manifest);
    return validated.ok ? validated.manifest : null;
  };

  /**
   * PRD 007 Req 15+16: one member/role mutation. The server's own 400/403
   * message is what the settings UI shows — the refusals it phrases (last
   * Owner, in-use role, built-in name, missing verb) are the user-facing
   * explanation, so nothing here re-words them.
   */
  const mutate = async (path: string, method: string, body?: unknown): Promise<ManifestResult> => {
    const res = await api(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) {
      const manifest = await readManifest(res);
      if (manifest) return { ok: true, manifest };
      return { ok: false, error: 'The server returned a workspace manifest this build cannot read.' };
    }
    const failure = (await res.json().catch(() => null)) as { error?: string; required?: string } | null;
    if (failure?.required) {
      return { ok: false, error: `You need the ${failure.required} permission to do that.` };
    }
    return { ok: false, error: failure?.error ?? `The change could not be saved (${res.status}).` };
  };

  return {
    currentId() {
      return workspaceIdFromSearch(window.location.search);
    },

    async list() {
      return (await json<WorkspaceListing[]>(await api('/api/workspaces'))) ?? [];
    },

    async create(request) {
      const res = await api('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const body = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (res.ok && body?.id) return { id: body.id };
      return { error: body?.error ?? `Could not create the workspace (${res.status}).` };
    },

    async remove(id) {
      return (await api(workspacePath(id), { method: 'DELETE' })).ok;
    },

    async permissions(id) {
      // The manifest read is itself doc.read-gated, so "no access" comes back
      // as a 403 and resolves to the empty set without a second endpoint.
      const body = await json<{ manifest: { members: { id: string; role: string }[] } }>(
        await api(workspacePath(id, '/manifest')),
      );
      if (!body) return [];
      const me = await sessionMe();
      if (!me) return [];
      const validated = validateWorkspaceManifest(body.manifest);
      // PRD 017 Req 4 (issue #189): /api/me now says whether the caller is a
      // deployment admin, so the client predicts the same implicit union the
      // server resolves — the Settings People tab appears for a non-member
      // admin exactly because of this flag.
      return validated.ok ? [...resolvePermissions(validated.manifest, me.id, me.admin === true)] : [];
    },

    manifest(id) {
      return api(workspacePath(id, '/manifest')).then(readManifest);
    },

    addMember(id, member) {
      return mutate(workspacePath(id, '/members'), 'POST', member);
    },

    setMemberRole(id, userId, role) {
      return mutate(workspacePath(id, `/members/${encodeURIComponent(userId)}`), 'PUT', { role });
    },

    removeMember(id, userId) {
      return mutate(workspacePath(id, `/members/${encodeURIComponent(userId)}`), 'DELETE');
    },

    setEveryone(id, everyone) {
      return mutate(workspacePath(id, '/everyone'), 'PUT', everyone);
    },

    createRole(id, role) {
      return mutate(workspacePath(id, '/roles'), 'POST', role);
    },

    updateRole(id, name, role) {
      return mutate(workspacePath(id, `/roles/${encodeURIComponent(name)}`), 'PUT', role);
    },

    deleteRole(id, name) {
      return mutate(workspacePath(id, `/roles/${encodeURIComponent(name)}`), 'DELETE');
    },

    async searchUsers(query) {
      // Issue #183 §3: a failed directory answer REJECTS instead of reading
      // as "nobody matched" — the picker shows its inline error for it (the
      // #184 OBO failure rendered as an empty list for exactly this reason).
      const res = await api(`/api/directory/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`directory search failed (${res.status})`);
      const found = ((await res.json()) as DirectoryEntry[]) ?? [];
      return found.map(withAvatarToken);
    },

    resolveUsers(members) {
      return resolveMembers(members, getUser);
    },

    navigateTo(id) {
      // PRD 007 Req 2: the binding IS `?workspace=<id>` on the SPA's own URL,
      // so opening or leaving a workspace is a same-origin navigation that
      // rebinds it — the whole app boots against the new workspace.
      window.location.assign(id ? `/?workspace=${encodeURIComponent(id)}` : '/');
    },

    unbind() {
      // PRD 009 Req 6: same binding, rewritten in place — this page keeps
      // running (it may be mid-switch into single-file mode), and only a
      // reload from here starts against no workspace.
      window.history.replaceState(null, '', '/');
    },
  };
}
