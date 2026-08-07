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
/**
 * PRD 010 Req 18: which flow a saved state belongs to. `create` is the New
 * Workspace run (#104) and stays the default, so a record written before this
 * existed still parses and still resumes. `reconnect` is the repair run: it
 * produces a CONNECTION, not a workspace, and therefore collects no workspace
 * fields at all — it names the workspace it is repairing instead.
 */
export type WizardPurpose = 'create' | 'reconnect';

export interface SavedWizardState {
  version: 1;
  /** Absent means `create` — the shape #104 wrote. */
  purpose?: WizardPurpose;
  /**
   * PRD 010 Req 18: which workspace is being repaired. Present exactly when
   * `purpose` is `reconnect`, and what makes the return from GitHub land back
   * on THAT workspace's settings rather than the start page.
   */
  workspaceId?: string;
  /** The opaque state the server issued for this wizard session. */
  session: string;
  step: WizardStep;
  /** The workspace fields a create run carries; a reconnect run has none. */
  form?: NewWorkspaceForm;
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
  | { kind: 'resume'; state: ResumedWizardState }
  | { kind: 'continue'; state: SavedWizardState }
  | { kind: 'restart'; reason: string };

/**
 * A resumed state always names the installation the return came back with —
 * that is what separates `resume` from the restarts above, so the caller
 * never has to assert it.
 */
export interface ResumedWizardState extends SavedWizardState {
  installationId: number;
}

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
  // PRD 010 Req 18: the two purposes carry different requirements, and a
  // record that satisfies neither is not usable saved state — which
  // `decideWizardEntry` turns into a named restart, never a stuck step.
  const purpose: WizardPurpose = saved.purpose === 'reconnect' ? 'reconnect' : 'create';
  const form = saved.form as Partial<NewWorkspaceForm> | undefined;
  if (purpose === 'create' && (!form || typeof form.name !== 'string' || !Array.isArray(form.members))) return null;
  if (purpose === 'reconnect' && (typeof saved.workspaceId !== 'string' || !saved.workspaceId)) return null;
  return {
    version: 1,
    // Absent stays absent: a create record parses back byte-identically to
    // the shape #104 wrote, so nothing about that flow changed.
    ...(purpose === 'reconnect' ? { purpose } : {}),
    session: saved.session,
    step: saved.step as WizardStep,
    ...(typeof saved.workspaceId === 'string' && saved.workspaceId ? { workspaceId: saved.workspaceId } : {}),
    ...(form && typeof form.name === 'string' && Array.isArray(form.members)
      ? {
          form: {
            name: form.name,
            members: form.members,
            everyoneEnabled: form.everyoneEnabled === true,
            everyoneRole: typeof form.everyoneRole === 'string' ? form.everyoneRole : 'Viewer',
          },
        }
      : {}),
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
export function decideWizardEntry(
  raw: string | null,
  ret: GitHubReturn,
  // PRD 010 Req 18: which flow is asking. The create flow (#104) is the
  // default, so its existing contract is unchanged; the reconnect flow also
  // names the workspace it is repairing, and a saved state belonging to the
  // OTHER flow is simply not this flow's saved state.
  expect: { purpose: WizardPurpose; workspaceId?: string } = { purpose: 'create' },
): WizardEntry {
  const parsed = parseSavedWizardState(raw);
  const mine =
    parsed !== null &&
    (parsed.purpose ?? 'create') === expect.purpose &&
    (expect.purpose !== 'reconnect' || parsed.workspaceId === expect.workspaceId);
  const saved = mine ? parsed : null;
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

/**
 * PRD 010 Req 18: the workspace a saved reconnect run is repairing, or null.
 * Leaving for GitHub is a full navigation and the deployment's setup URL is
 * one fixed address, so the app boots at the start page on the way back: this
 * is what tells it to rebind to that workspace and reopen its settings
 * instead of showing a fresh New Workspace dialog.
 */
export function reconnectTargetOf(raw: string | null): string | null {
  const saved = parseSavedWizardState(raw);
  return saved?.purpose === 'reconnect' ? (saved.workspaceId ?? null) : null;
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
 * PRD 010 Req 15+16: the GitHub choice's create body — the same workspace
 * fields (the connection adds to them, it does not replace them) plus #103's
 * optional `storage` field. One existing call, `POST /api/workspaces`.
 *
 * The default-storage choice does not come through here at all: it stays on
 * `validateNewWorkspaceForm` alone, so its body carries no `storage` key and
 * is byte identical to an existing deployment's.
 */
export function buildConnectedCreateRequest(state: SavedWizardState): NewWorkspaceResult {
  // PRD 010 Req 18: a reconnect run has no workspace fields at all, and must
  // never be able to reach create — it produces a connection, not a workspace.
  if (!state.form) return { ok: false, error: 'This run is repairing a connection, not creating a workspace.' };
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
