// PRD 007 Req 12 (+17): the destructive delete action in Workspace settings.
// It renders only for a holder of `workspace.delete` — the permission is
// resolved server-side from the manifest, so a member without it never sees
// the control (and the endpoint refuses them anyway). The button stays inert
// until the workspace's exact name is typed, and a successful delete returns
// the app to the start page with no workspace bound.

import { useEffect, useState } from 'react';
import { deleteConfirmationMatches } from '../lib/workspaceLifecycle';
import type { WorkspaceLifecycle } from '../platform/hostedWorkspaces';
import { Button } from './ui/Button';

export function WorkspaceDangerZone({ lifecycle }: { lifecycle: WorkspaceLifecycle }) {
  const id = lifecycle.currentId();
  const [name, setName] = useState<string | null>(null);
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
      setAllowed(permissions.includes('workspace.delete'));
    });
    return () => {
      cancelled = true;
    };
  }, [lifecycle, id]);

  if (!id || !allowed || name === null) return null;

  const armed = deleteConfirmationMatches(typed, name);

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
      <p className="hotkey-hint">
        Deleting “{name}” permanently removes its documents, comments and images for everyone. This cannot be
        undone.
      </p>
      <div className="field">
        <label htmlFor="workspace-delete-confirm">
          Type the workspace name to confirm
        </label>
        <input
          id="workspace-delete-confirm"
          data-testid="workspace-delete-confirm"
          className="field"
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
      {/* PRD 018 Req 21 (issue #204): the destructive FILL — danger fg on
          danger bg — is the .btn-danger.btn-primary compound, replacing the
          old .workspace-danger button.destructive rule. */}
      <Button
        variant="danger"
        className="btn-primary"
        data-testid="workspace-delete-submit"
        disabled={!armed || busy}
        onClick={() => void remove()}
      >
        Delete this workspace
      </Button>
    </div>
  );
}
