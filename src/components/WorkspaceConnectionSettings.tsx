// PRD 010 Req 18: the connection section of Workspace settings — where a
// repo-backed workspace says which repo, branch and root it is stored in and
// whether the deployment's App installation still reaches it, and where a
// holder of `workspace.settings` re-runs the connect wizard to repair it.
//
// It is a thin shell: every decision belongs to src/lib/workspaceConnection.ts
// and src/lib/githubConnectWizard.ts, and every call goes through the
// lifecycle seam's bearer-stamped transport to THIS app's own origin. No
// GitHub host string exists in `src/`; the installation status is answered by
// the server making the GitHub call with the deployment's App credentials.
//
// It renders only for a holder of `workspace.settings`, and only when the
// server says the workspace is repo-backed — a default-storage workspace
// shows nothing at all, not an empty state and not a "default storage" label
// (Req 3: nothing in the client reveals which backend a default workspace
// uses). The routes behind it refuse anyone else by name regardless.

import { useCallback, useEffect, useState } from 'react';
import {
  decideWizardEntry,
  readGitHubReturn,
  WIZARD_STATE_KEY,
  type RepoConnection,
  type SavedWizardState,
} from '../lib/githubConnectWizard';
import { describeConnection, mayManageConnection, type WorkspaceConnectionPayload } from '../lib/workspaceConnection';
import type { WorkspaceLifecycle } from '../platform/hostedWorkspaces';
import { clearWizardState, GitHubRepoWizard, saveWizardState } from './GitHubRepoWizard';

export function WorkspaceConnectionSettings({ lifecycle }: { lifecycle: WorkspaceLifecycle }) {
  const id = lifecycle.currentId();
  const [payload, setPayload] = useState<WorkspaceConnectionPayload | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [wizard, setWizard] = useState<SavedWizardState | null>(null);
  const [resumable, setResumable] = useState<SavedWizardState | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const byo = lifecycle.byo;

  const restart = useCallback((reason = '') => {
    clearWizardState();
    setWizard(null);
    setResumable(null);
    setNotice(reason);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    if (!id) return;
    const permissions = await lifecycle.permissions(id);
    const mayManage = mayManageConnection(permissions);
    setAllowed(mayManage);
    // PRD 010 Req 18: ask about the connection only when the manifest says
    // this member may manage it, OR when the manifest could not answer at all
    // (an empty set — no access, or a workspace whose backend is unreachable),
    // which is exactly the broken-connection case the route's own card-backed
    // gate exists for. A member who simply lacks `workspace.settings` no
    // longer spends a request on a 403 the section would discard anyway.
    if (!mayManage && permissions.length > 0) {
      setPayload(null);
      return;
    }
    const answer = await lifecycle.connection(id);
    // A refusal is not a connection: the section stays silent rather than
    // guessing, and the route has already refused by name.
    setPayload('error' in answer ? null : answer);
  }, [lifecycle, id]);

  useEffect(() => {
    void load();
  }, [load]);

  // PRD 010 Req 18: the permission check must not need the repo. `permissions`
  // resolves from the manifest when it is readable; when it is not, the
  // connection route's own card-backed gate is what decides, and the section
  // is offered to whoever that gate lets through.
  useEffect(() => {
    if (!id || !payload || !payload.connected || payload.health.state === 'ok') return;
    setAllowed(true);
  }, [id, payload]);

  // PRD 010 Req 18: the reconnect flow's re-entry — the SAME pure decision the
  // create flow makes, told which workspace it is repairing so another flow's
  // saved state is simply not this one's.
  useEffect(() => {
    if (!byo || !id) return;
    const ret = readGitHubReturn(window.location.search);
    const entry = decideWizardEntry(window.localStorage.getItem(WIZARD_STATE_KEY), ret, {
      purpose: 'reconnect',
      workspaceId: id,
    });
    if (entry.kind === 'fresh') return;
    if (entry.kind === 'restart') {
      restart(entry.reason);
      return;
    }
    if (entry.kind === 'continue') {
      setResumable(entry.state);
      return;
    }
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
      // GitHub's parameters have done their job; the workspace binding stays.
      window.history.replaceState(null, '', `/?workspace=${encodeURIComponent(id)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [byo, id, restart]);

  /**
   * PRD 010 Req 18: leave for GitHub's consent page. The saved state NAMES the
   * workspace being repaired and carries no workspace fields at all — this run
   * produces a connection, never a workspace — and it is written before the
   * navigation, because leaving is a full unload.
   */
  const beginInstall = async () => {
    if (!byo || !id) return;
    setBusy(true);
    const started = await byo.beginInstall();
    if ('error' in started) {
      setError(started.error);
      setBusy(false);
      return;
    }
    saveWizardState({
      version: 1,
      purpose: 'reconnect',
      workspaceId: id,
      session: started.session,
      step: 'install',
    });
    window.location.assign(started.installUrl);
  };

  /** The confirm step: repair the record, or show the server's own refusal. */
  const confirm = async (connection: RepoConnection): Promise<string | null> => {
    if (!id) return 'This page is not bound to a workspace.';
    const answered = await lifecycle.reconnect(id, connection);
    if ('error' in answered) return answered.error;
    clearWizardState();
    setWizard(null);
    setResumable(null);
    setNotice('The connection was repaired.');
    setPayload(answered);
    return null;
  };

  const described = describeConnection(payload);
  if (!id || !described || !allowed) return null;

  return (
    <section className="settings-section" data-testid="workspace-connection">
      <h3>Connection</h3>
      <p className="hotkey-hint">
        This workspace is stored in <strong data-testid="workspace-connection-repo">{described.repo}</strong>, on
        branch <strong data-testid="workspace-connection-branch">{described.branch}</strong>, at{' '}
        <strong data-testid="workspace-connection-root">{described.location}</strong>.
      </p>
      <p
        className="hotkey-hint"
        data-testid="workspace-connection-status"
        data-healthy={described.healthy ? 'yes' : 'no'}
        {...(described.healthy ? {} : { role: 'alert' as const })}
      >
        {described.status}
      </p>
      {notice && (
        <p className="hotkey-hint" data-testid="workspace-connection-notice">
          {notice}
        </p>
      )}
      {error && (
        <p className="hotkey-hint" data-testid="workspace-connection-error" role="alert">
          {error}
        </p>
      )}

      {wizard && byo ? (
        <GitHubRepoWizard
          lifecycle={lifecycle}
          state={wizard}
          onState={setWizard}
          onRestart={restart}
          onCancel={() => restart()}
          onConfirm={confirm}
          confirmLabel="Repair connection"
        />
      ) : (
        <div className="actions">
          {resumable && (
            <button data-testid="workspace-connection-resume" onClick={() => setWizard(resumable)}>
              Continue repairing
            </button>
          )}
          {byo && (
            <button data-testid="workspace-connection-reconnect" disabled={busy} onClick={() => void beginInstall()}>
              {resumable ? 'Start over' : 'Reconnect…'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
