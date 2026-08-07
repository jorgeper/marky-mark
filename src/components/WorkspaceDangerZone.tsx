// PRD 007 Req 12 (+17): the destructive delete action in Workspace settings.
// It renders only for a holder of `workspace.delete` — the permission is
// resolved server-side from the manifest, so a member without it never sees
// the control (and the endpoint refuses them anyway). The button stays inert
// until the workspace's exact name is typed, and a successful delete returns
// the app to the start page with no workspace bound.

import { useEffect, useState } from 'react';
import { deleteRetention, workspaceDeleteWarning } from '../lib/deleteRetention';
import { deleteConfirmationMatches } from '../lib/workspaceLifecycle';
import type { WorkspaceLifecycle } from '../platform/hostedWorkspaces';

export function WorkspaceDangerZone({ lifecycle }: { lifecycle: WorkspaceLifecycle }) {
  const id = lifecycle.currentId();
  const [name, setName] = useState<string | null>(null);
  // PRD 010 Req 21: the row's own retention fact, from the same listing the
  // name comes from — no second request, and no `workspace.settings` gate.
  const [retainsHistory, setRetainsHistory] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void Promise.all([lifecycle.list(), lifecycle.permissions(id)]).then(([items, permissions]) => {
      if (cancelled) return;
      const row = items.find((w) => w.id === id);
      setName(row?.name ?? null);
      setRetainsHistory(row?.retainsHistory === true);
      setAllowed(permissions.includes('workspace.delete'));
    });
    return () => {
      cancelled = true;
    };
  }, [lifecycle, id]);

  if (!id || !allowed || name === null) return null;

  const armed = deleteConfirmationMatches(typed, name);
  // PRD 010 Req 21: `permanentDelete: true` is a fact here, not an assumption
  // — this section only mounts on a platform offering the workspace lifecycle,
  // and every such delete is server-side with no OS Trash behind it.
  const retention = deleteRetention({ permanentDelete: true, retainsHistory });

  const remove = async () => {
    setBusy(true);
    if (await lifecycle.remove(id)) {
      // PRD 007 Req 12: the workspace is gone — leave it rather than staying
      // bound to an id whose every blob has just been deleted.
      lifecycle.navigateTo(null);
      return;
    }
    setError('The workspace could not be deleted.');
    setBusy(false);
  };

  return (
    <div className="workspace-danger" data-testid="workspace-delete-section">
      <h2>Delete workspace</h2>
      {/* PRD 010 Req 21: what this delete may promise is the pure decision in
          lib/deleteRetention.ts — on a git-backed workspace it says the
          repository's history retains the content, without offering any in-app
          recovery; on a blob-backed one it is the sentence that always was. */}
      <p className="hotkey-hint">{workspaceDeleteWarning(retention, name)}</p>
      <div className="field">
        <label htmlFor="workspace-delete-confirm">
          Type the workspace name to confirm
        </label>
        <input
          id="workspace-delete-confirm"
          data-testid="workspace-delete-confirm"
          type="text"
          value={typed}
          placeholder={name}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
      {error && (
        <p className="hotkey-hint" data-testid="workspace-delete-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="destructive"
        data-testid="workspace-delete-submit"
        disabled={!armed || busy}
        onClick={() => void remove()}
      >
        Delete this workspace
      </button>
    </div>
  );
}
