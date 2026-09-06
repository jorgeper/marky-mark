// PRD 020 Req 4: the names section of Workspace settings — a holder of the
// `workspace.settings` verb changes the unique name (validated as you type
// with the same pure rule the server enforces) and the optional friendly
// display name. The write is the manifest PUT the verb already gates; the
// server re-checks reserved words and case-insensitive collisions and its
// refusal shows here inline, verbatim — the client copy is the explanation,
// never the enforcement (the WorkspaceMembers pattern).

import { useState } from 'react';
import { friendlyNameOf, type WorkspaceManifest } from '../lib/hostedWorkspace';
import { isUniqueNameError } from '../lib/workspaceLifecycle';
import { uniqueNameProblem } from '../lib/workspaceNames';
import type { WorkspaceLifecycle } from '../platform/hostedWorkspaces';
import { Button } from './ui/Button';
import { SectionHeader } from './ui/SectionHeader';

export interface WorkspaceNamesProps {
  lifecycle: WorkspaceLifecycle;
  workspaceId: string;
  manifest: WorkspaceManifest;
  onManifest: (manifest: WorkspaceManifest) => void;
}

export function WorkspaceNames({ lifecycle, workspaceId, manifest, onManifest }: WorkspaceNamesProps) {
  const [uniqueName, setUniqueName] = useState(manifest.uniqueName ?? '');
  const [friendly, setFriendly] = useState(friendlyNameOf(manifest) ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // PRD 020 Req 2: format/length/reserved problems appear while typing; the
  // empty field waits for Save to complain, like the creation dialog.
  const typedProblem = uniqueName === '' ? null : uniqueNameProblem(uniqueName);
  // Issue #250 (the #245 treatment, same decision): the unique-name field
  // wears the error paint — border and typed value — exactly while the name
  // is what was refused, whether that came from typing or from the server's
  // collision/reserved refusal on the manifest PUT. `isUniqueNameError` is
  // the shared judge, so a permission or network refusal still shows its
  // message with the field left alone.
  const nameRejected = typedProblem !== null || (error !== '' && isUniqueNameError(error));

  const save = async () => {
    const problem = uniqueNameProblem(uniqueName);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    // PRD 020 Req 4: a friendly-name change never touches the unique name —
    // both travel in one manifest write, and a blank friendly field stores
    // the unique name as the display (Req 2's unset-friendly semantics).
    const result = await lifecycle.putManifest(workspaceId, {
      ...manifest,
      uniqueName,
      name: friendly.trim() || uniqueName,
    });
    if (result.ok) onManifest(result.manifest);
    else setError(result.error);
    setBusy(false);
  };

  return (
    <div className="workspace-names" data-testid="workspace-names-section">
      {/* Issue #249: the settings-page section header primitive — the
          Workspace tab's sections read like every other tab's. */}
      <SectionHeader>Names</SectionHeader>
      <p className="hotkey-hint">
        The unique name identifies this workspace across the deployment. The display name is what
        the app shows; leave it blank to display the unique name.
      </p>
      <div className="field">
        <label htmlFor="workspace-unique-name">Unique name</label>
        <input
          id="workspace-unique-name"
          className={nameRejected ? 'field invalid invalid-value' : 'field'}
          data-testid="workspace-unique-name"
          type="text"
          value={uniqueName}
          disabled={busy}
          onChange={(e) => {
            // Issue #250: editing the name retires the save-time refusal it
            // earned — message and paint both — without waiting for another
            // Save (WorkspaceSwitcher's onChange behaviour).
            setError('');
            setUniqueName(e.target.value);
          }}
        />
        {typedProblem && (
          // Issue #250: an error line, not a hint — the dialog's body size in
          // the theme's danger colour, through the same shared `.form-error`
          // rule the New Workspace dialog uses (the 11px muted `.hotkey-hint`
          // was the "field looks completely normal" the issue reports).
          <p className="form-error" data-testid="workspace-unique-name-problem" role="alert">
            {typedProblem}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="workspace-friendly-name">Display name (optional)</label>
        <input
          id="workspace-friendly-name"
          className="field"
          data-testid="workspace-friendly-name"
          type="text"
          value={friendly}
          disabled={busy}
          onChange={(e) => setFriendly(e.target.value)}
        />
      </div>
      {error && (
        // Issue #250: the save-time refusal joins the same shared rule as the
        // type-time one — `.workspace-settings-error` (small) stays what the
        // members and roles sections use.
        <p className="form-error" data-testid="workspace-names-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button data-testid="workspace-names-save" disabled={busy} onClick={() => void save()}>
          Save names
        </Button>
      </div>
    </div>
  );
}
