// PRD 020 Req 4 (amended by PRD 026 Req 10): the names section of Workspace
// settings — a holder of the `workspace.settings` verb changes the required
// display name (what the app shows) and, deliberately, the URL name (the
// workspace's address; normalised as typed and validated with the same pure
// rule the server enforces on a rename). The write is the manifest PUT the
// verb already gates; the server re-checks reserved words and case-insensitive
// collisions and its refusal shows here inline, verbatim — the client copy is
// the explanation, never the enforcement (the WorkspaceMembers pattern).

import { useState } from 'react';
import type { WorkspaceManifest } from '../lib/hostedWorkspace';
import {
  DISPLAY_NAME_REQUIRED,
  isUniqueNameError,
  normalizeUrlNameTyping,
  settleUrlName,
  validateWorkspaceNamesForm,
} from '../lib/workspaceLifecycle';
import { uniqueNameProblem } from '../lib/workspaceNames';
import type { WorkspaceLifecycle } from '../platform/hostedWorkspaces';
import { Button } from './ui/Button';
import { SectionHeader } from './ui/SectionHeader';
import { UrlNameGuidance } from './UrlNameGuidance';

export interface WorkspaceNamesProps {
  lifecycle: WorkspaceLifecycle;
  workspaceId: string;
  manifest: WorkspaceManifest;
  onManifest: (manifest: WorkspaceManifest) => void;
}

export function WorkspaceNames({ lifecycle, workspaceId, manifest, onManifest }: WorkspaceNamesProps) {
  // PRD 026 Req 9+10: the stored URL name is read off the `manifest` prop on
  // every render, never copied into state — after a successful rename the
  // value the save handed back is the new baseline, so the field reads as
  // unedited again without a remount.
  const stored = manifest.uniqueName ?? '';
  const [uniqueName, setUniqueName] = useState(stored);
  // PRD 026 Req 10: the display name is required and prefilled from what the
  // chrome shows (`manifest.name`) — a workspace whose display name equals
  // its URL name opens with that name in the field, not an empty required
  // one (`friendlyNameOf`'s unset-friendly reading is not this field's).
  const [displayName, setDisplayName] = useState(manifest.name);
  const [error, setError] = useState('');
  // PRD 026 Req 12: the free name the server's collision 409 offered beside
  // `error` — only ever set together with it, and dropped at every site that
  // clears the refusal, so the action can never outlive the message.
  const [suggestion, setSuggestion] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // PRD 026 Req 9+10: has the URL name been changed from the stored one?
  // While it has not, the value is the workspace's own — possibly a
  // grandfathered `Team_Docs` that the strict rule would refuse — and it is
  // neither judged, settled nor painted; save sends it back verbatim and the
  // server skips its strict check for an unchanged name. Only an edited value
  // enters the strict regime below.
  const edited = uniqueName !== stored;
  // PRD 026 Req 6: the settled URL name — the one trailing dash typing may
  // keep (`foo-`) is not part of the name, so the type-time check and the
  // address preview both read the value as save will see it.
  const settled = settleUrlName(uniqueName);
  // PRD 020 Req 2 (amended by PRD 026 Req 6+9): problems appear while typing
  // an EDITED value; the empty field waits for Save to complain, like the
  // creation dialog. Checked on the settled value so the kept trailing dash
  // never flashes the charset refusal at every separator typed.
  const typedProblem = edited && settled !== '' ? uniqueNameProblem(settled) : null;
  // Issue #250 (the #245 treatment, same decision; kept by PRD 026 Req 8):
  // the URL-name field wears the error paint — border and typed value —
  // exactly while the name is what was refused, whether that came from
  // typing, from Save finding it empty, or from the server's collision or
  // reserved refusal on the manifest PUT. `isUniqueNameError` is the shared
  // judge, so a permission or network refusal still shows its message with
  // the field left alone.
  const nameRejected = typedProblem !== null || (error !== '' && isUniqueNameError(error));
  // PRD 026 Req 8+10: the display name paints itself while it is what Save
  // refused — its own refusal, never the URL name's.
  const displayRejected = error === DISPLAY_NAME_REQUIRED;
  // PRD 024 Req 16 (issue #304): `formerNames` is optional on read — an
  // undefined list is an empty one, and an empty one renders nothing at all.
  const formerNames = manifest.formerNames ?? [];

  const save = async () => {
    // PRD 026 Req 10: the pure form rule decides, in field order — display
    // name required, then the URL name only if it was edited (settled,
    // required, strict) — so the section never re-implements the order.
    const validated = validateWorkspaceNamesForm({ displayName, urlName: uniqueName, storedUrlName: stored });
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    setBusy(true);
    setError('');
    setSuggestion(undefined);
    // PRD 020 Req 4 (amended by PRD 026 Req 10): a display-name change never
    // touches the URL name — both travel in one manifest write, the display
    // name trimmed and always present (the "blank stores the URL name" rule
    // is gone: the field is required now).
    const result = await lifecycle.putManifest(workspaceId, {
      ...manifest,
      uniqueName: validated.uniqueName,
      name: validated.name,
    });
    if (result.ok) {
      // PRD 026 Req 9: the field shows the settled value the save landed, so
      // it reads as unedited against the manifest the parent hands back.
      setUniqueName(validated.uniqueName);
      onManifest(result.manifest);
    } else {
      setError(result.error);
      // PRD 026 Req 12: a collision's free-name suggestion lands beside the
      // refusal; every other failure carries none, and the line shows alone.
      setSuggestion(result.suggestion);
    }
    setBusy(false);
  };

  // PRD 026 Req 12: accepting the suggestion puts it in the URL-name field
  // verbatim — it now differs from `stored`, so the field is edited and in
  // the strict regime, which the suggestion passed at the seam — retires the
  // refusal (message, paint and this action together), leaves the display
  // name alone, and does NOT save: the manifest is unchanged until the user
  // presses Save names themselves.
  const acceptSuggestion = (name: string) => {
    setError('');
    setSuggestion(undefined);
    setUniqueName(name);
  };

  return (
    <div className="workspace-names" data-testid="workspace-names-section">
      {/* Issue #249: the settings-page section header primitive — the
          Workspace tab's sections read like every other tab's. */}
      <SectionHeader>Names</SectionHeader>
      <p className="hotkey-hint">
        The display name is what the app shows. The URL name is this workspace's address across the
        deployment; changing it renames the workspace, and links to the old name keep working.
      </p>
      {/* PRD 026 Req 10: the display name leads — required, free text. The
          input keeps its original id/test id (`workspace-friendly-name`):
          renaming ids is forbidden, and this is still the display-name
          field. No autofocus: this is a settings panel, not a dialog. */}
      <div className="field">
        <label htmlFor="workspace-friendly-name">Display name</label>
        <input
          id="workspace-friendly-name"
          className={displayRejected ? 'field invalid invalid-value' : 'field'}
          data-testid="workspace-friendly-name"
          type="text"
          value={displayName}
          disabled={busy}
          onChange={(e) => {
            // PRD 026 Req 8+10: editing the display name retires the refusal
            // it earned — message and paint — and never touches the URL name
            // (no auto-derive here: a URL change is a rename with link
            // consequences and stays a deliberate act).
            setError('');
            setSuggestion(undefined);
            setDisplayName(e.target.value);
          }}
        />
      </div>
      {/* PRD 020 Req 2 (amended by PRD 026 Req 6+9+10): the URL name comes
          second, showing the stored value verbatim — grandfathered or not —
          until edited; then normalised as typed and validated as you type
          with the same pure rule the server enforces so a reserved word shows
          inline before Save ever happens. Blur settles the one trailing dash
          typing may keep (`foo-`→`foo`) on an edited value only. */}
      <div className="field">
        <label htmlFor="workspace-unique-name">URL name</label>
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
            setSuggestion(undefined);
            // PRD 026 Req 6: every keystroke lands normalised (`Foo Bar`→
            // `foo-bar`, `foo--bar`→`foo-bar`, `foo-` kept while typing).
            setUniqueName(normalizeUrlNameTyping(e.target.value));
          }}
          onBlur={() => {
            if (edited) setUniqueName(settled);
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
        {/* PRD 026 Req 7: the rule and the live address, always visible —
            the same component the New Workspace dialog mounts, under this
            surface's test-id prefix. An unedited value previews as stored
            (a grandfathered name is its real address); an edited one
            previews settled so the trailing dash never shows in an address.
            The origin comes from the page, not the lib. */}
        <UrlNameGuidance
          origin={window.location.origin}
          urlName={edited ? settled : uniqueName}
          testIdPrefix="workspace"
        />
      </div>
      {formerNames.length > 0 && (
        // PRD 024 Req 16 (issue #304): the names this workspace used to
        // carry, read-only, in the manifest's order (oldest first) — read
        // straight off the `manifest` prop, never copied into state, so the
        // server-computed list the save hands back shows in this same dialog.
        // The muted caption treatment (`.hotkey-hint`), not `.form-error`:
        // it is information, not a refusal. Nothing here removes an entry —
        // former names are the server's (Req 1–3) and stay reachable.
        <p className="hotkey-hint" data-testid="workspace-former-names">
          Previous names: {formerNames.join(', ')}. Links to these still open this workspace.
        </p>
      )}
      {error && (
        // Issue #250: the save-time refusal joins the same shared rule as the
        // type-time one — `.workspace-settings-error` (small) stays what the
        // members and roles sections use.
        <>
          <p className="form-error" data-testid="workspace-names-error" role="alert">
            {error}
          </p>
          {suggestion !== undefined && (
            // PRD 026 Req 12: the one-click way out of a collision — the quiet
            // inline Button primitive right under the refusal line, with the
            // server's minted free name in its label. Absent whenever the 409
            // carried no usable suggestion.
            <Button
              variant="quiet"
              size="sm"
              className="form-error-action"
              data-testid="workspace-use-suggestion"
              onClick={() => acceptSuggestion(suggestion)}
            >
              Use {suggestion}
            </Button>
          )}
        </>
      )}
      <div className="dialog-actions">
        <Button data-testid="workspace-names-save" disabled={busy} onClick={() => void save()}>
          Save names
        </Button>
      </div>
    </div>
  );
}
