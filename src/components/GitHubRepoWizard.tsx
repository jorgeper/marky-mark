// PRD 010 Req 15+16: the connect-your-GitHub-repo wizard — the shell over
// src/lib/githubConnectWizard.ts. Every decision (which step, what the return
// from GitHub means, whether a subdirectory is legal, what the create body
// is) belongs to that pure module; this file renders what it returns and
// makes the calls through the lifecycle's `byo` client, which talks only to
// this app's own origin.
//
// The install step is a full navigation out to GitHub's consent page, so the
// wizard's progress is written to localStorage BEFORE leaving and read back
// on return — abandoning it is not an error state, and a return that cannot
// be matched resolves to a named restart.

import { useEffect, useState } from 'react';
import {
  buildConnectedCreateRequest,
  connectionFor,
  pickRepo,
  serializeWizardState,
  stepAfter,
  stepBefore,
  summarize,
  validateSubdirectory,
  WIZARD_STATE_KEY,
  type RepoConnection,
  type RepoOption,
  type SavedWizardState,
} from '../lib/githubConnectWizard';
import type { ByoBranches, WorkspaceLifecycle } from '../platform/hostedWorkspaces';

/** Persist the wizard's progress so it outlives the trip to GitHub. */
export function saveWizardState(state: SavedWizardState): void {
  window.localStorage.setItem(WIZARD_STATE_KEY, serializeWizardState(state));
}

/** PRD 010 Req 16: starting over discards the saved state cleanly. */
export function clearWizardState(): void {
  window.localStorage.removeItem(WIZARD_STATE_KEY);
}

/**
 * The wizard's steps after the install round trip: pick repo, pick branch and
 * subdirectory, confirm. `state` is the saved progress; every change to it is
 * persisted, so a reload at any step continues rather than restarts.
 */
export function GitHubRepoWizard({
  lifecycle,
  state,
  onState,
  onRestart,
  onCancel,
  onConfirm,
  confirmLabel = 'Create workspace',
}: {
  lifecycle: WorkspaceLifecycle;
  state: SavedWizardState;
  onState: (next: SavedWizardState) => void;
  onRestart: (reason: string) => void;
  onCancel: () => void;
  /**
   * PRD 010 Req 18: what confirming does, when it is not creating a
   * workspace. The reconnect flow walks the SAME steps and the same pure step
   * logic and hands the finished connection here instead — answering the
   * server's own refusal to show in the wizard, with every picked value still
   * in hand, or null when it landed.
   */
  onConfirm?: (connection: RepoConnection) => Promise<string | null>;
  confirmLabel?: string;
}) {
  const [repos, setRepos] = useState<RepoOption[] | null>(null);
  const [reposMessage, setReposMessage] = useState('');
  const [branches, setBranches] = useState<ByoBranches | null>(null);
  const [subdirectory, setSubdirectory] = useState(state.root ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const byo = lifecycle.byo;
  const { installationId } = state;

  // PRD 010 Req 16: the pick-repo step's list — the repos the completed
  // installation grants, and nothing else. A session the server no longer
  // knows resolves to a named restart, never a stuck step.
  useEffect(() => {
    if (state.step !== 'repo' || !byo || installationId === undefined) return;
    let cancelled = false;
    void byo.repos(state.session, installationId).then((result) => {
      if (cancelled) return;
      if ('error' in result) {
        onRestart(result.error);
        return;
      }
      setRepos(result.repos);
      setReposMessage(result.message ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [state.step, state.session, installationId, byo, onRestart]);

  // The branch step's list, with the repo's own default branch preselected.
  useEffect(() => {
    if (state.step !== 'branch' || !byo || installationId === undefined || !state.owner || !state.repo) return;
    let cancelled = false;
    void byo.branches(state.session, installationId, state.owner, state.repo).then((result) => {
      if (cancelled) return;
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setBranches(result);
    });
    return () => {
      cancelled = true;
    };
  }, [state.step, state.session, state.owner, state.repo, installationId, byo]);

  const advance = (next: SavedWizardState) => {
    setError('');
    saveWizardState(next);
    onState(next);
  };

  const chooseRepo = (option: RepoOption) => {
    setBranches(null);
    setSubdirectory('');
    advance(pickRepo(state, option));
  };

  const toConfirm = () => {
    // PRD 010 Req 16: the subdirectory is validated here, by name, without a
    // server round trip to discover that it is malformed.
    const checked = validateSubdirectory(subdirectory);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    const next: SavedWizardState = { ...state, step: stepAfter(state.step) };
    if (checked.root) next.root = checked.root;
    else delete next.root;
    advance(next);
  };

  // The confirm step: hand the finished connection to `onConfirm` when the
  // caller owns what happens next (PRD 010 Req 18's reconnect), otherwise
  // create the workspace this run has been collecting fields for.
  const finish = async () => {
    if (onConfirm) {
      const connection = connectionFor(state);
      if (!connection) {
        setError('Pick a repository and a branch before confirming.');
        return;
      }
      setBusy(true);
      const refused = await onConfirm(connection);
      if (refused) {
        setError(refused);
        setBusy(false);
      }
      return;
    }
    const built = buildConnectedCreateRequest(state);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    const created = await lifecycle.create(built.request);
    if ('error' in created) {
      // PRD 010 Req 16: #103's fail-fast refusal is shown IN the wizard, in
      // the server's own words, with every picked value still in hand — a
      // step can be corrected without starting over.
      setError(created.error);
      setBusy(false);
      return;
    }
    // PRD 010 Req 16: success opens the workspace exactly as a default
    // create does, and the saved wizard state is gone.
    clearWizardState();
    lifecycle.navigateTo(created.id);
  };

  const connection = connectionFor(state);
  const summary = connection ? summarize(connection) : null;

  return (
    <div className="workspace-wizard" data-testid="github-wizard" data-step={state.step}>
      {state.step === 'repo' && (
        <div className="field">
          <label>Repository</label>
          {repos === null && <p className="hotkey-hint">Reading the repositories that installation grants…</p>}
          {repos !== null && repos.length === 0 && (
            <p className="hotkey-hint" data-testid="github-wizard-no-repos" role="alert">
              {reposMessage || 'That installation grants no repository this app can use.'}
            </p>
          )}
          <ul className="workspace-list" data-testid="github-wizard-repos">
            {(repos ?? []).map((option) => (
              <li key={option.fullName}>
                <button
                  type="button"
                  className="workspace-list-item"
                  data-testid={`github-wizard-repo-${option.fullName}`}
                  onClick={() => chooseRepo(option)}
                >
                  <span className="workspace-list-name">{option.fullName}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.step === 'branch' && (
        <>
          <div className="field">
            <label htmlFor="github-wizard-branch">Branch</label>
            <select
              id="github-wizard-branch"
              data-testid="github-wizard-branch"
              value={state.branch ?? ''}
              onChange={(e) => onState({ ...state, branch: e.target.value })}
            >
              {(branches?.branches ?? (state.branch ? [state.branch] : [])).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="github-wizard-root">Subdirectory (optional)</label>
            <input
              id="github-wizard-root"
              data-testid="github-wizard-root"
              type="text"
              placeholder="the repository root"
              value={subdirectory}
              onChange={(e) => setSubdirectory(e.target.value)}
            />
          </div>
        </>
      )}

      {state.step === 'confirm' && summary && (
        <div className="field" data-testid="github-wizard-summary">
          <label>Connection</label>
          <p className="hotkey-hint">
            Documents will live in <strong data-testid="github-wizard-summary-repo">{summary.repo}</strong>, on branch{' '}
            <strong data-testid="github-wizard-summary-branch">{summary.branch}</strong>, at{' '}
            <strong data-testid="github-wizard-summary-root">{summary.location}</strong>.
          </p>
        </div>
      )}

      {error && (
        <p className="hotkey-hint" data-testid="github-wizard-error" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        <button data-testid="github-wizard-cancel" onClick={onCancel}>
          Cancel
        </button>
        {state.step !== 'repo' && (
          <button
            data-testid="github-wizard-back"
            onClick={() => advance({ ...state, step: stepBefore(state.step) })}
          >
            Back
          </button>
        )}
        {state.step === 'branch' && (
          <button className="primary" data-testid="github-wizard-next" onClick={toConfirm}>
            Continue
          </button>
        )}
        {state.step === 'confirm' && (
          <button
            className="primary"
            data-testid="github-wizard-create"
            disabled={busy}
            onClick={() => void finish()}
          >
            {confirmLabel}
          </button>
        )}
      </div>
    </div>
  );
}
