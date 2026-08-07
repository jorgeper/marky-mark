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
import { resolveMembers, type DirectoryEntry, type MemberEntry } from '../lib/membership';
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
import type { RepoConnection, RepoOption } from '../lib/githubConnectWizard';
import type { WorkspaceConnectionPayload } from '../lib/workspaceConnection';
import type { WorkspaceListing } from '../lib/workspaceLifecycle';

/** PRD 010 Req 15: whether this deployment can connect a repo, and why not. */
export interface ByoAvailability {
  available: boolean;
  reason?: string;
}

/** PRD 010 Req 16: a started wizard session and where to send the admin. */
export interface ByoSession {
  session: string;
  installUrl: string;
}

/** The installation the return from GitHub resolved to. */
export interface ByoInstallation {
  installationId: number;
  account: string;
}

/** The installation's repos; `message` says why an empty list is empty. */
export interface ByoRepos {
  repos: RepoOption[];
  message?: string;
}

export interface ByoBranches {
  defaultBranch: string;
  branches: string[];
}

/** Every wizard call answers its payload or the server's own message. */
export type ByoResult<T> = T | { error: string };

/**
 * PRD 010 Req 2+16: the connect-your-GitHub-repo wizard's transport. Every
 * method is a call to THIS app's own origin through the same bearer-stamped
 * wrapper as the rest of the lifecycle — the server makes the GitHub calls
 * with the deployment's App credentials, so no GitHub host string and no
 * GitHub token exists anywhere in `src/`.
 */
export interface GitHubByoClient {
  availability(): Promise<ByoAvailability>;
  /** Start a session; the install URL carries the state GitHub echoes back. */
  beginInstall(): Promise<ByoResult<ByoSession>>;
  /** Resolve GitHub's return into that session. */
  resolveReturn(session: string, installationId: number, setupAction: string | null): Promise<ByoResult<ByoInstallation>>;
  /** The repos of the installation this session came back from. */
  repos(session: string, installationId: number): Promise<ByoResult<ByoRepos>>;
  branches(session: string, installationId: number, owner: string, repo: string): Promise<ByoResult<ByoBranches>>;
}

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
   * PRD 010 Req 18: this workspace's connection as the server reports it —
   * owner/repo, branch, root and the App installation's status — or the
   * server's own named refusal. A workspace that is not repo-backed answers
   * `{connected: false}`, which the section renders as nothing at all.
   */
  connection(id: string): Promise<ByoResult<WorkspaceConnectionPayload>>;
  /**
   * PRD 010 Req 18: repair the connection. NOT `POST /api/workspaces` — it
   * never creates a workspace, and the server refuses it unless the target is
   * reachable, writable and already carries this workspace's own manifest.
   * A refusal is the server's own sentence, shown in the wizard verbatim.
   */
  reconnect(id: string, connection: RepoConnection): Promise<ByoResult<WorkspaceConnectionPayload>>;
  /** Directory search for the membership picker. */
  searchUsers(query: string): Promise<DirectoryEntry[]>;
  /** Stored ids → display entries; unresolvable ids stay plain identifiers. */
  resolveUsers(ids: readonly string[]): Promise<MemberEntry[]>;
  /** Bind the page to a workspace (null: leave — the start page, no workspace). */
  navigateTo(id: string | null): void;
  /**
   * PRD 010 Req 15+16: the connect-your-GitHub-repo wizard's calls. Optional
   * on the seam like every other capability — a lifecycle without it simply
   * offers no storage choice, which is what the New Workspace dialog renders.
   */
  byo?: GitHubByoClient;
  /**
   * PRD 009 Req 6: drop the binding WITHOUT navigating — Close Workspace and
   * every crossing action into single-file mode must leave a reload on the
   * initial page, and a navigation would discard the file being opened.
   */
  unbind(): void;
}

export function createHostedWorkspaceLifecycle(): WorkspaceLifecycle {
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

  /**
   * PRD 010 Req 11+16: one wizard call. A refusal is the SERVER's own message
   * — the actionable GitHub failure vocabulary, the session-gone sentence,
   * the cross-installation refusal — so nothing here re-words it, and a
   * status with no message still says something rather than a bare code.
   */
  const byoCall = async <T>(
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<ByoResult<T>> => {
    const res = await api(path, init);
    const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (res.ok && body) return body;
    return { error: body?.error ?? `GitHub could not be reached (${res.status}).` };
  };

  const byoQuery = (session: string, installationId: number): string =>
    `session=${encodeURIComponent(session)}&installation=${encodeURIComponent(String(installationId))}`;

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
      const me = await json<{ id: string }>(await api('/api/me'));
      if (!me) return [];
      const validated = validateWorkspaceManifest(body.manifest);
      return validated.ok ? [...resolvePermissions(validated.manifest, me.id)] : [];
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

    // PRD 010 Req 18: both connection calls go through the SAME bearer-stamped
    // `api()` wrapper as everything else on this seam — no new client network
    // call site, so `FETCH_ALLOWLIST` in scripts/validate.mjs is unchanged, and
    // no GitHub host string exists in `src/` to add to it.
    connection(id) {
      return byoCall<WorkspaceConnectionPayload>(workspacePath(id, '/connection'));
    },

    reconnect(id, connection) {
      return byoCall<WorkspaceConnectionPayload>(workspacePath(id, '/connection'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection }),
      });
    },

    async searchUsers(query) {
      const found =
        (await json<DirectoryEntry[]>(await api(`/api/directory/search?q=${encodeURIComponent(query)}`))) ?? [];
      return found.map(withAvatarToken);
    },

    resolveUsers(ids) {
      return resolveMembers(ids, getUser);
    },

    // PRD 010 Req 2+16: every wizard step is one `/api/github/byo/…` call on
    // this origin, through the same `api()` wrapper — no new network call
    // site is introduced, so the bundle scan's fetch allowlist is unchanged.
    byo: {
      async availability() {
        const body = await json<ByoAvailability>(await api('/api/github/byo'));
        return body ?? { available: false, reason: 'This deployment did not answer whether a repo can be connected.' };
      },
      beginInstall() {
        return byoCall<ByoSession>('/api/github/byo/session', { method: 'POST' });
      },
      resolveReturn(session, installationId, setupAction) {
        return byoCall<ByoInstallation>('/api/github/byo/return', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session, installationId, setupAction }),
        });
      },
      repos(session, installationId) {
        return byoCall<ByoRepos>(`/api/github/byo/repos?${byoQuery(session, installationId)}`);
      },
      branches(session, installationId, owner, repo) {
        const query = `${byoQuery(session, installationId)}&owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`;
        return byoCall<ByoBranches>(`/api/github/byo/branches?${query}`);
      },
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
