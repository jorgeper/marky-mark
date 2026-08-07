// PRD 007 Req 10/11: the hosted workspace lifecycle's reachable surface — the
// New Workspace flow (name + initial members with roles, or everyone-in-tenant
// access) and the Open Workspace dialog (every workspace in the deployment,
// fuzzy search-as-you-type, an in-dialog no-access message naming the Owners).
// Mounted on the Platform's `workspaces` capability, so nothing here asks which
// flavor is running; all decisions are the pure functions in
// lib/workspaceLifecycle.ts. PRD 009 Req 11 retired the switcher chip that
// used to sit alongside them: the menu and the start page are the way in, and
// the open workspace's name shows in the toolbar's document affordance.

import { useCallback, useEffect, useState } from 'react';
import { MembershipPicker } from './MembershipPicker';
import { GitHubRepoWizard, clearWizardState, saveWizardState } from './GitHubRepoWizard';
import type { DirectoryEntry, MemberEntry } from '../lib/membership';
import { timeAgo } from '../lib/time';
import {
  DEFAULT_MEMBER_ROLE,
  GRANTABLE_ROLES,
  emptyNewWorkspaceForm,
  filterWorkspaces,
  noAccessMessage,
  validateNewWorkspaceForm,
  type NewWorkspaceForm,
  type WorkspaceListing,
} from '../lib/workspaceLifecycle';
import {
  DEFAULT_STORAGE_CHOICE,
  WIZARD_STATE_KEY,
  decideWizardEntry,
  readGitHubReturn,
  type SavedWizardState,
  type StorageChoice,
} from '../lib/githubConnectWizard';
import type { ByoAvailability, WorkspaceLifecycle } from '../platform/hostedWorkspaces';

/**
 * The New Workspace dialog: name, initial members with roles, everyone-access.
 * PRD 007 Req 21 + PRD 009 Req 11: the start page and the menu's New
 * Workspace row both land here, through App.tsx's `managedWsDialog`.
 */
export function NewWorkspaceDialog({
  lifecycle,
  onClose,
}: {
  lifecycle: WorkspaceLifecycle;
  onClose: () => void;
}) {
  const [form, setForm] = useState<NewWorkspaceForm>(emptyNewWorkspaceForm);
  // The picker speaks in resolved directory entries; the manifest speaks in
  // {id, role}. Both views of the same selection move together.
  const [picked, setPicked] = useState<MemberEntry[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // PRD 010 Req 15: the storage choice — default storage preselected, so the
  // flow a deployment already has is the one it keeps.
  const [choice, setChoice] = useState<StorageChoice>(DEFAULT_STORAGE_CHOICE);
  const [availability, setAvailability] = useState<ByoAvailability | null>(null);
  // PRD 010 Req 16: the wizard in progress, the saved progress being offered
  // to continue, and the named reason a saved state could not be used.
  const [wizard, setWizard] = useState<SavedWizardState | null>(null);
  const [resumable, setResumable] = useState<SavedWizardState | null>(null);
  const [notice, setNotice] = useState('');
  const byo = lifecycle.byo;

  /** Discard the saved progress; `reason` is shown when there is one to name. */
  const restart = useCallback((reason = '') => {
    clearWizardState();
    setWizard(null);
    setResumable(null);
    setChoice(DEFAULT_STORAGE_CHOICE);
    setNotice(reason);
  }, []);

  // PRD 010 Req 15: the GitHub choice is offered only where the deployment can
  // actually connect one; elsewhere it is visibly unavailable with the
  // server's one-line reason, never a dead end.
  useEffect(() => {
    if (!byo) return;
    let cancelled = false;
    void byo.availability().then((answer) => {
      if (!cancelled) setAvailability(answer);
    });
    return () => {
      cancelled = true;
    };
  }, [byo]);

  // PRD 010 Req 16: what re-entering the flow does — the pure decision over
  // the saved state and GitHub's return parameters, rendered as it comes.
  useEffect(() => {
    if (!byo) return;
    const ret = readGitHubReturn(window.location.search);
    const entry = decideWizardEntry(window.localStorage.getItem(WIZARD_STATE_KEY), ret);
    if (entry.kind === 'fresh') return;
    if (entry.kind === 'restart') {
      restart(entry.reason);
      return;
    }
    if (entry.state.form) setForm(entry.state.form);
    setChoice('github');
    if (entry.kind === 'continue') {
      setResumable(entry.state);
      return;
    }
    // The return leg: the server binds the installation to the session it
    // issued, and only then does the wizard resume at pick-repo.
    const resumed = entry.state;
    let cancelled = false;
    void byo.resolveReturn(resumed.session, resumed.installationId, ret.setupAction).then((result) => {
      if (cancelled) return;
      if ('error' in result) {
        restart(result.error);
        return;
      }
      saveWizardState(resumed);
      setWizard(resumed);
      // GitHub's parameters have done their job; the page keeps running
      // with the app's own URL so a reload is an ordinary re-entry.
      lifecycle.unbind();
    });
    return () => {
      cancelled = true;
    };
  }, [byo, lifecycle, restart]);

  // The workspace fields stay editable during the wizard, and stay saved with
  // it: the connection adds to them, it does not replace them.
  useEffect(() => {
    if (wizard) saveWizardState({ ...wizard, form });
  }, [wizard, form]);

  /**
   * PRD 010 Req 16: leave for GitHub's consent page. The progress is written
   * BEFORE navigating — this is a full navigation out of the app, not a
   * fetch — so coming back (or never coming back) finds it.
   */
  const beginInstall = async () => {
    const validated = validateNewWorkspaceForm(form);
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    if (!byo) return;
    setBusy(true);
    const started = await byo.beginInstall();
    if ('error' in started) {
      setError(started.error);
      setBusy(false);
      return;
    }
    saveWizardState({ version: 1, session: started.session, step: 'install', form });
    window.location.assign(started.installUrl);
  };

  const addMember = (user: DirectoryEntry) => {
    setPicked((prev) => [...prev, { ...user, resolved: true }]);
    setForm((prev) => ({ ...prev, members: [...prev.members, { id: user.id, role: DEFAULT_MEMBER_ROLE }] }));
  };
  const removeMember = (id: string) => {
    setPicked((prev) => prev.filter((m) => m.id !== id));
    setForm((prev) => ({ ...prev, members: prev.members.filter((m) => m.id !== id) }));
  };
  const setRole = (id: string, role: string) =>
    setForm((prev) => ({ ...prev, members: prev.members.map((m) => (m.id === id ? { id, role } : m)) }));

  const submit = async () => {
    const validated = validateNewWorkspaceForm(form);
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    setBusy(true);
    const created = await lifecycle.create(validated.request);
    if ('error' in created) {
      setError(created.error);
      setBusy(false);
      return;
    }
    // PRD 007 Req 10: the new workspace opens — the creator is its Owner.
    lifecycle.navigateTo(created.id);
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal workspace-modal" data-testid="new-workspace-dialog">
        <h2>New workspace</h2>
        <div className="field">
          <label htmlFor="new-workspace-name">Name</label>
          <input
            id="new-workspace-name"
            data-testid="new-workspace-name"
            type="text"
            value={form.name}
            autoFocus
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          />
        </div>

        <div className="field">
          <label>People</label>
          <MembershipPicker
            searchUsers={(q) => lifecycle.searchUsers(q)}
            selected={picked}
            onAdd={addMember}
            onRemove={removeMember}
            debounceMs={80}
          />
          {form.members.map((member) => (
            <div className="workspace-role-row" key={member.id}>
              <span className="workspace-role-name">
                {picked.find((p) => p.id === member.id)?.displayName ?? member.id}
              </span>
              <select
                data-testid={`new-workspace-role-${member.id}`}
                aria-label={`Role for ${member.id}`}
                value={member.role}
                onChange={(e) => setRole(member.id, e.target.value)}
              >
                {GRANTABLE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        {/* PRD 007 Req 16: everyone-in-tenant access, defaulting to Viewer. */}
        <div className="checkbox-row">
          <input
            id="new-workspace-everyone"
            data-testid="new-workspace-everyone"
            type="checkbox"
            checked={form.everyoneEnabled}
            onChange={(e) => setForm((prev) => ({ ...prev, everyoneEnabled: e.target.checked }))}
          />
          <label htmlFor="new-workspace-everyone">Everyone in the organization can access this workspace</label>
        </div>
        {form.everyoneEnabled && (
          <div className="field">
            <label htmlFor="new-workspace-everyone-role">Their role</label>
            <select
              id="new-workspace-everyone-role"
              data-testid="new-workspace-everyone-role"
              value={form.everyoneRole}
              onChange={(e) => setForm((prev) => ({ ...prev, everyoneRole: e.target.value }))}
            >
              {GRANTABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* PRD 010 Req 15: the storage choice. Both choices collect the same
            workspace fields above; this only says where the bytes live. */}
        {byo && (
          <div className="field" data-testid="new-workspace-storage">
            <label>Storage</label>
            <div className="checkbox-row">
              <input
                id="new-workspace-storage-default"
                data-testid="new-workspace-storage-default"
                type="radio"
                name="new-workspace-storage"
                checked={choice === 'default'}
                onChange={() => {
                  setChoice('default');
                  setError('');
                }}
              />
              <label htmlFor="new-workspace-storage-default">Default storage</label>
            </div>
            <div className="checkbox-row">
              <input
                id="new-workspace-storage-github"
                data-testid="new-workspace-storage-github"
                type="radio"
                name="new-workspace-storage"
                disabled={!availability?.available}
                checked={choice === 'github'}
                onChange={() => {
                  setChoice('github');
                  setError('');
                }}
              />
              <label htmlFor="new-workspace-storage-github">Connect your GitHub repository</label>
            </div>
            {availability && !availability.available && (
              <p className="hotkey-hint" data-testid="new-workspace-storage-unavailable">
                {availability.reason}
              </p>
            )}
          </div>
        )}

        {/* PRD 010 Req 16: abandoning mid-flow is not an error state — the
            saved progress is offered back, and starting over discards it. */}
        {choice === 'github' && resumable && !wizard && (
          <div className="field" data-testid="new-workspace-resume">
            <p className="hotkey-hint">
              You started connecting a repository and did not finish. Continue where you stopped, or start over.
            </p>
            <div className="actions">
              <button
                data-testid="new-workspace-resume-continue"
                onClick={() => {
                  setWizard(resumable);
                  setResumable(null);
                }}
              >
                Continue
              </button>
              <button data-testid="new-workspace-resume-restart" onClick={() => restart()}>
                Start over
              </button>
            </div>
          </div>
        )}

        {notice && (
          <p className="hotkey-hint" data-testid="new-workspace-notice" role="alert">
            {notice}
          </p>
        )}

        {choice === 'github' && wizard && wizard.step !== 'install' ? (
          <GitHubRepoWizard
            lifecycle={lifecycle}
            state={{ ...wizard, form }}
            onState={setWizard}
            onRestart={restart}
            onCancel={onClose}
          />
        ) : (
          <>
            {error && (
              <p className="hotkey-hint" data-testid="new-workspace-error" role="alert">
                {error}
              </p>
            )}
            <div className="actions">
              <button data-testid="new-workspace-cancel" onClick={onClose}>
                Cancel
              </button>
              {choice === 'github' && !resumable ? (
                // PRD 010 Req 16: what leaving does, said plainly, and how to
                // come back if the tab is lost.
                <button
                  className="primary"
                  data-testid="new-workspace-connect"
                  disabled={busy}
                  onClick={() => void beginInstall()}
                  title="You will be sent to GitHub to install this app on your repository, then returned here. If the tab is lost, reopen the app and choose New Workspace to continue."
                >
                  Continue on GitHub…
                </button>
              ) : (
                <button
                  className="primary"
                  data-testid="new-workspace-create"
                  disabled={busy || choice === 'github'}
                  onClick={() => void submit()}
                >
                  Create
                </button>
              )}
            </div>
            {choice === 'github' && !wizard && !resumable && (
              <p className="hotkey-hint" data-testid="new-workspace-install-note">
                You will leave Marky Mark for GitHub to install this app on your repository, then come back here to
                pick the repo, branch and folder. If you lose this tab, open the app again and choose New Workspace —
                you will be offered to continue.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The Open Workspace dialog: the whole deployment, filtered as you type. */
export function OpenWorkspaceDialog({
  lifecycle,
  onClose,
}: {
  lifecycle: WorkspaceLifecycle;
  onClose: () => void;
}) {
  const [all, setAll] = useState<WorkspaceListing[]>([]);
  const [query, setQuery] = useState('');
  // The no-access state names the chosen workspace's Owners; resolving them
  // is one directory round trip, made only when it is actually needed.
  const [denied, setDenied] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void lifecycle.list().then((items) => {
      if (!cancelled) setAll(items);
    });
    return () => {
      cancelled = true;
    };
  }, [lifecycle]);

  const choose = async (workspace: WorkspaceListing) => {
    if (workspace.access) {
      lifecycle.navigateTo(workspace.id);
      return;
    }
    // PRD 007 Req 11: the listing already said this is inaccessible — no
    // forbidden read is attempted to discover it. Owners resolve to display
    // names, falling back to the plain identifier.
    const owners = await lifecycle.resolveUsers(workspace.owners);
    setDenied(noAccessMessage(workspace.name, owners));
  };

  const shown = filterWorkspaces(query, all);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal workspace-modal" data-testid="open-workspace-dialog">
        <h2>Open workspace</h2>
        <div className="field">
          <input
            type="text"
            data-testid="open-workspace-search"
            placeholder="Search workspaces…"
            value={query}
            autoFocus
            onChange={(e) => {
              setQuery(e.target.value);
              setDenied('');
            }}
          />
        </div>
        <ul className="workspace-list" data-testid="open-workspace-list">
          {shown.map((workspace) => (
            <li key={workspace.id}>
              <button
                type="button"
                className="workspace-list-item"
                data-testid={`open-workspace-item-${workspace.id}`}
                onClick={() => void choose(workspace)}
              >
                <span className="workspace-list-name">{workspace.name}</span>
                <span className="workspace-list-modified" data-testid={`open-workspace-modified-${workspace.id}`}>
                  {timeAgo(workspace.modified)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {shown.length === 0 && (
          <p className="hotkey-hint" data-testid="open-workspace-empty">
            No workspace matches “{query}”.
          </p>
        )}
        {denied && (
          <p className="hotkey-hint" data-testid="open-workspace-no-access" role="alert">
            {denied}
          </p>
        )}
        <div className="actions">
          <button data-testid="open-workspace-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

