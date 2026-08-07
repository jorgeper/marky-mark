/**
 * PRD 010 Req 15+16: the pure half of the connect-your-GitHub-repo wizard —
 * the storage choice the New Workspace flow offers, the four steps the GitHub
 * choice walks (install → pick repo → pick branch and subdirectory →
 * confirm), the subdirectory rule, the create body each choice produces, and
 * the resume-vs-restart decision that makes the flow restartable across the
 * full navigation out to GitHub's consent page.
 *
 * No I/O, no DOM, no `react`: `src/components/GitHubRepoWizard.tsx` is a thin
 * shell that renders what these functions return, exactly as
 * `WorkspaceSwitcher.tsx` is over `workspaceLifecycle.ts`. The transport is
 * `src/platform/hostedWorkspaces.ts`'s bearer-stamped `api()` wrapper and
 * nothing else — no GitHub host string appears in `src/` at all, because
 * every GitHub call is the server's (PRD 010 Req 2+4).
 */

import type { CreateWorkspaceRequest } from './hostedWorkspace';
import { validateNewWorkspaceForm, type NewWorkspaceForm, type NewWorkspaceResult } from './workspaceLifecycle';

/** PRD 010 Req 15: the two storage choices the New Workspace dialog offers. */
export type StorageChoice = 'default' | 'github';

/** PRD 010 Req 15: default storage is the preselected choice. */
export const DEFAULT_STORAGE_CHOICE: StorageChoice = 'default';

/** PRD 010 Req 16: the wizard's steps, in the order they are walked. */
export type WizardStep = 'install' | 'repo' | 'branch' | 'confirm';

export const WIZARD_STEPS: readonly WizardStep[] = ['install', 'repo', 'branch', 'confirm'];

/**
 * PRD 010 Req 16: where the wizard's progress is remembered. Leaving for
 * GitHub is a full navigation, so this outlives an unload — and the same key
 * is what a reload, a closed dialog or a never-completed round trip resume
 * from.
 */
export const WIZARD_STATE_KEY = 'marky-mark.new-workspace.github-connect';

/** The connection a confirmed wizard creates the workspace with (Req 16). */
export interface RepoConnection {
  kind: 'repo';
  owner: string;
  repo: string;
  branch: string;
  /** Repo-relative prefix; absent means the repo root. */
  root?: string;
}

/** One repo the completed installation grants, as the server reports it. */
export interface RepoOption {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
}

/**
 * PRD 010 Req 16: everything the wizard must still have after the browser
 * has been away at GitHub — the chosen mode is implied by this record
 * existing, and the workspace fields already entered ride along so the admin
 * does not retype them.
 *
 * PRD 010 Req 2: nothing here is a credential and nothing is GitHub-issued
 * beyond identifiers the user can already see (owner, repo, branch, the
 * installation id). No token ever reaches `src/`, so none can be persisted.
 */
export interface SavedWizardState {
  version: 1;
  /** The opaque state the server issued for this wizard session. */
  session: string;
  step: WizardStep;
  form: NewWorkspaceForm;
  /** Present from the moment the return from GitHub is resolved. */
  installationId?: number;
  owner?: string;
  repo?: string;
  /** The picked repo's default branch, offered as the branch default. */
  defaultBranch?: string;
  branch?: string;
  /** Absent means the repo root. */
  root?: string;
}

/** The parameters GitHub sends back to the deployment's setup URL. */
export interface GitHubReturn {
  /** True when the URL carries a return at all. */
  present: boolean;
  installationId: number | null;
  setupAction: string | null;
  /** The opaque state the server issued and GitHub echoed back. */
  session: string | null;
}

/**
 * PRD 010 Req 16: recognise the return from GitHub's consent page. GitHub
 * appends `installation_id` and `setup_action` to the configured setup URL;
 * `state` is the deployment's own opaque value, echoed back untouched.
 */
export function readGitHubReturn(search: string): GitHubReturn {
  const params = new URLSearchParams(search);
  const raw = params.get('installation_id');
  const setupAction = params.get('setup_action');
  const id = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  return {
    present: raw !== null || setupAction !== null,
    installationId: id,
    setupAction,
    session: params.get('state'),
  };
}

/**
 * PRD 010 Req 16: what re-entering the New Workspace flow does. The component
 * only renders this — it makes no decision of its own.
 *
 * - `fresh`: nothing saved and no return; the plain two-choice dialog.
 * - `resume`: the return matched the saved session; the wizard continues at
 *   pick-repo with the installation it just came back with.
 * - `continue`: saved progress with no return in the URL; the admin is
 *   offered to continue where it stopped or start over.
 * - `restart`: the saved state can no longer be used, with the named reason
 *   to show. Never a stuck step and never a raw status code.
 */
export type WizardEntry =
  | { kind: 'fresh' }
  | { kind: 'resume'; state: SavedWizardState }
  | { kind: 'continue'; state: SavedWizardState }
  | { kind: 'restart'; reason: string };

/** Only a well-formed saved record is resumable; anything else is not one. */
export function parseSavedWizardState(raw: string | null): SavedWizardState | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const saved = value as Partial<SavedWizardState>;
  if (saved.version !== 1) return null;
  if (typeof saved.session !== 'string' || !saved.session) return null;
  if (!WIZARD_STEPS.includes(saved.step as WizardStep)) return null;
  const form = saved.form as Partial<NewWorkspaceForm> | undefined;
  if (!form || typeof form.name !== 'string' || !Array.isArray(form.members)) return null;
  return {
    version: 1,
    session: saved.session,
    step: saved.step as WizardStep,
    form: {
      name: form.name,
      members: form.members,
      everyoneEnabled: form.everyoneEnabled === true,
      everyoneRole: typeof form.everyoneRole === 'string' ? form.everyoneRole : 'Viewer',
    },
    ...(typeof saved.installationId === 'number' ? { installationId: saved.installationId } : {}),
    ...(typeof saved.owner === 'string' ? { owner: saved.owner } : {}),
    ...(typeof saved.repo === 'string' ? { repo: saved.repo } : {}),
    ...(typeof saved.defaultBranch === 'string' ? { defaultBranch: saved.defaultBranch } : {}),
    ...(typeof saved.branch === 'string' ? { branch: saved.branch } : {}),
    ...(typeof saved.root === 'string' ? { root: saved.root } : {}),
  };
}

export function serializeWizardState(state: SavedWizardState): string {
  return JSON.stringify(state);
}

/**
 * PRD 010 Req 16: the resume-vs-restart decision, pure over the saved state
 * and the return parameters. Every unusable combination resolves to a named
 * restart — an abandoned round trip is not an error state, and a return the
 * app cannot match is a sentence, not a status code.
 */
export function decideWizardEntry(raw: string | null, ret: GitHubReturn): WizardEntry {
  const saved = parseSavedWizardState(raw);
  if (!ret.present) return saved ? { kind: 'continue', state: saved } : { kind: 'fresh' };
  if (!saved) {
    return {
      kind: 'restart',
      reason: 'This browser has no record of the connection GitHub returned from. Start again to connect a repo.',
    };
  }
  if (!ret.session || ret.session !== saved.session) {
    return {
      kind: 'restart',
      reason: 'GitHub returned from a different connection than the one this browser started. Start again.',
    };
  }
  if (ret.setupAction === 'cancel' || ret.installationId === null) {
    return {
      kind: 'restart',
      reason: 'The GitHub install did not complete, so there is no installation to pick a repo from. Start again.',
    };
  }
  return {
    kind: 'resume',
    // The installation is the one thing the return adds; the workspace fields
    // and the session are the ones that survived the navigation.
    state: { ...saved, step: 'repo', installationId: ret.installationId },
  };
}

export type SubdirectoryResult = { ok: true; root?: string } | { ok: false; error: string };

/**
 * PRD 010 Req 16: the subdirectory is a plain repo-relative prefix, validated
 * here rather than by a server round trip. Empty means the repo root, which
 * is the default — and which the create body then omits entirely.
 */
export function validateSubdirectory(raw: string): SubdirectoryResult {
  const value = raw.trim();
  if (!value) return { ok: true };
  if (value.includes('\\')) {
    return { ok: false, error: 'Use forward slashes in the subdirectory — a repo path has no backslashes.' };
  }
  if (value.startsWith('/')) {
    return { ok: false, error: 'The subdirectory is relative to the repo, so it cannot start with “/”.' };
  }
  if (value.endsWith('/')) {
    return { ok: false, error: 'Leave the trailing “/” off the subdirectory.' };
  }
  const segments = value.split('/');
  if (segments.some((s) => s === '..' || s === '.')) {
    return { ok: false, error: 'The subdirectory cannot contain “.” or “..” — it must stay inside the repo.' };
  }
  if (segments.some((s) => s === '')) {
    return { ok: false, error: 'The subdirectory has an empty path segment — remove the doubled “/”.' };
  }
  return { ok: true, root: value };
}

/**
 * PRD 010 Req 16: the connection the create body carries. `root` is omitted
 * when the repo root was chosen — the record says "the whole repo", it does
 * not say "the empty prefix".
 */
export function connectionFor(state: SavedWizardState): RepoConnection | null {
  const { owner, repo, branch, root } = state;
  if (!owner || !repo || !branch) return null;
  return { kind: 'repo', owner, repo, branch, ...(root ? { root } : {}) };
}

/**
 * PRD 010 Req 15: the default-storage create body — today's body exactly, with
 * NO `storage` field, so an existing deployment's create is byte identical.
 */
export function buildDefaultCreateRequest(form: NewWorkspaceForm): NewWorkspaceResult {
  return validateNewWorkspaceForm(form);
}

/**
 * PRD 010 Req 15+16: the GitHub choice's create body — the same workspace
 * fields (the connection adds to them, it does not replace them) plus #103's
 * optional `storage` field. One existing call, `POST /api/workspaces`.
 */
export function buildConnectedCreateRequest(state: SavedWizardState): NewWorkspaceResult {
  const validated = validateNewWorkspaceForm(state.form);
  if (!validated.ok) return validated;
  const connection = connectionFor(state);
  if (!connection) return { ok: false, error: 'Pick a repository and a branch before creating the workspace.' };
  const request: CreateWorkspaceRequest = { ...validated.request, storage: connection };
  return { ok: true, request };
}

/**
 * PRD 010 Req 16: the step a completed step hands over to. Ordering lives
 * here, so the component never computes "what comes next" itself.
 */
export function stepAfter(step: WizardStep): WizardStep {
  const index = WIZARD_STEPS.indexOf(step);
  return WIZARD_STEPS[Math.min(index + 1, WIZARD_STEPS.length - 1)];
}

/** The step a Back button returns to; the first step has none. */
export function stepBefore(step: WizardStep): WizardStep {
  const index = WIZARD_STEPS.indexOf(step);
  return WIZARD_STEPS[Math.max(index - 1, 0)];
}

/**
 * PRD 010 Req 16: picking a repo moves to the branch step with the repo's own
 * default branch already filled in, and the subdirectory at the repo root.
 */
export function pickRepo(state: SavedWizardState, option: RepoOption): SavedWizardState {
  const next: SavedWizardState = {
    ...state,
    step: 'branch',
    owner: option.owner,
    repo: option.repo,
    defaultBranch: option.defaultBranch,
    branch: option.defaultBranch,
  };
  delete next.root;
  return next;
}

/** PRD 010 Req 16: what the confirm step shows back before anything exists. */
export interface ConnectionSummary {
  repo: string;
  branch: string;
  /** Human phrasing of the chosen root — the repo root when none was given. */
  location: string;
}

export function summarize(connection: RepoConnection): ConnectionSummary {
  return {
    repo: `${connection.owner}/${connection.repo}`,
    branch: connection.branch,
    location: connection.root ? `${connection.root}/` : 'the repository root',
  };
}
