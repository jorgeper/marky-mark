// PRD 007 Req 10/11: the hosted workspace lifecycle's reachable surface — the
// New Workspace flow (name + initial members with roles, or everyone-in-tenant
// access) and the Open Workspace dialog (every workspace in the deployment,
// fuzzy search-as-you-type, an in-dialog no-access message naming the Owners).
// Mounted on the Platform's `workspaces` capability, so nothing here asks which
// flavor is running; all decisions are the pure functions in
// lib/workspaceLifecycle.ts. PRD 009 Req 11 retired the switcher chip that
// used to sit alongside them: the menu and the start page are the way in, and
// the open workspace's name shows in the toolbar's document affordance.

import { useEffect, useState } from 'react';
import { MembershipPicker } from './MembershipPicker';
import { UrlNameGuidance } from './UrlNameGuidance';
import { Button } from './ui/Button';
import type { SessionMe } from '../lib/deploymentSettings';
import { buildScratchPath } from '../lib/hostedPaths';
import type { DirectoryEntry, MemberEntry } from '../lib/membership';
import { timeAgo } from '../lib/time';
import { slugifyWorkspaceName, uniqueNameProblem } from '../lib/workspaceNames';
import {
  DEFAULT_MEMBER_ROLE,
  DISPLAY_NAME_REQUIRED,
  GRANTABLE_ROLES,
  emptyNewWorkspaceForm,
  isUniqueNameError,
  noAccessMessage,
  normalizeUrlNameTyping,
  settleUrlName,
  validateNewWorkspaceForm,
  visibleWorkspaces,
  workspaceRowBadge,
  type NewWorkspaceForm,
  type WorkspaceListing,
} from '../lib/workspaceLifecycle';
import type { WorkspaceLifecycle } from '../platform/hostedWorkspaces';

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
  // PRD 026 Req 12: the free name the server's collision 409 offered beside
  // `error` — only ever set together with it, and dropped at every site that
  // clears the refusal, so the action can never outlive the message.
  const [suggestion, setSuggestion] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // PRD 026 Req 5: has the user edited the URL-name field themselves? False
  // at open; while false every display-name change re-derives the URL name.
  // A plain state value on purpose: issue #354's "Use <suggestion>" action
  // sets it too (accepting a suggestion counts as touching).
  const [touched, setTouched] = useState(false);
  // PRD 026 Req 6: the settled URL name — the one trailing dash typing may
  // keep (`foo-`) is not part of the name, so the type-time check and the
  // address preview both read the value as submit will see it.
  const settled = settleUrlName(form.uniqueName);
  // PRD 020 Req 2 (amended by PRD 026 Req 6): problems appear while typing;
  // the empty field waits for submit to complain (WorkspaceNames does the
  // same). Checked on the settled value: the kept trailing dash is outside
  // the strict charset, and must not flash the charset refusal at every
  // separator typed. The normaliser keeps everything else inside the charset,
  // so in practice only the reserved-word refusal can surface here.
  const typedProblem = settled === '' ? null : uniqueNameProblem(settled);
  // Issue #245 (kept by PRD 026 Req 8): the URL name wears the refusal — an
  // error-coloured border and typed value — while it is the thing being
  // rejected, whether that came from typing, from submit finding it empty,
  // or from the server's collision refusal. A permission or network failure
  // still shows its message with the field left alone.
  const nameRejected = typedProblem !== null || (error !== '' && isUniqueNameError(error));
  // PRD 026 Req 8: the display name paints itself while it is what submit
  // refused — its own refusal, never the URL name's.
  const displayRejected = error === DISPLAY_NAME_REQUIRED;

  // PRD 026 Req 4+5: every display-name edit retires the submit refusal and,
  // until the URL-name field is touched, mirrors into it through the shared
  // slugifier (`Team Docs`→`team-docs`; nothing usable → `''`, no fallback
  // word here — Req 6's empty refusal waits for submit).
  const changeDisplayName = (name: string) => {
    setError('');
    setSuggestion(undefined);
    setForm((prev) => ({ ...prev, name, uniqueName: touched ? prev.uniqueName : slugifyWorkspaceName(name) }));
  };
  // PRD 026 Req 5+6: a URL-name edit is normalised as typed before it lands
  // in state. A non-empty result marks the field touched (mirroring stops);
  // an empty one un-touches it and resumes mirroring from the current
  // display name at once, not only on the next display-name keystroke.
  const changeUrlName = (raw: string) => {
    // Issue #245: editing the name retires the submit-time refusal it earned
    // — message and styling both — so a corrected name reads as normal
    // without waiting for the next submit.
    setError('');
    setSuggestion(undefined);
    const normalized = normalizeUrlNameTyping(raw);
    if (normalized === '') {
      setTouched(false);
      setForm((prev) => ({ ...prev, uniqueName: slugifyWorkspaceName(prev.name) }));
      return;
    }
    setTouched(true);
    setForm((prev) => ({ ...prev, uniqueName: normalized }));
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

  // PRD 026 Req 12 (+ Req 5): accepting the suggestion fills the URL-name
  // field with it verbatim and counts as touching it (mirroring from the
  // display name stops; the display name itself is left alone), retires the
  // refusal — message, paint and this action together — and does NOT submit:
  // the dialog stays open on the new value for the user to read the preview
  // and press Create themselves. The suggestion already passed the strict
  // rule at the seam, so no type-time problem appears.
  const acceptSuggestion = (name: string) => {
    setError('');
    setSuggestion(undefined);
    setTouched(true);
    setForm((prev) => ({ ...prev, uniqueName: name }));
  };

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
      // PRD 026 Req 12: a collision's free-name suggestion lands beside the
      // refusal; every other failure carries none, and the line shows alone.
      setSuggestion(created.suggestion);
      setBusy(false);
      return;
    }
    // PRD 007 Req 10: the new workspace opens — the creator is its Owner.
    lifecycle.navigateTo(created.id);
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog workspace-modal" data-testid="new-workspace-dialog">
        <h2>New workspace</h2>
        {/* PRD 026 Req 4: the display name leads — required, autofocused,
            free text. The input keeps its original id/test id
            (`new-workspace-name`): renaming ids is forbidden, and this is
            still the display-name field. */}
        <div className="field">
          <label htmlFor="new-workspace-name">Display name</label>
          <input
            id="new-workspace-name"
            className={displayRejected ? 'field invalid invalid-value' : 'field'}
            data-testid="new-workspace-name"
            type="text"
            value={form.name}
            autoFocus
            onChange={(e) => changeDisplayName(e.target.value)}
          />
        </div>
        {/* PRD 020 Req 2 (amended by PRD 026 Req 4+5+6): the URL name comes
            second, auto-filled from the display name until touched,
            normalised as typed, and validated as you type with the same pure
            rule the server enforces so a reserved word shows inline before
            submit ever happens. Blur settles the one trailing dash typing
            may keep (`foo-`→`foo`). */}
        <div className="field">
          <label htmlFor="new-workspace-unique-name">URL name</label>
          <input
            id="new-workspace-unique-name"
            className={nameRejected ? 'field invalid invalid-value' : 'field'}
            data-testid="new-workspace-unique-name"
            type="text"
            value={form.uniqueName}
            onChange={(e) => changeUrlName(e.target.value)}
            onBlur={() => setForm((prev) => ({ ...prev, uniqueName: settleUrlName(prev.uniqueName) }))}
          />
          {typedProblem && (
            // Issue #245: an error line, not a hint — dialog body size in the
            // theme's danger colour (the 11px muted .hotkey-hint was the "too
            // small, not red" the issue reports).
            <p className="form-error" data-testid="new-workspace-unique-name-error" role="alert">
              {typedProblem}
            </p>
          )}
          {/* PRD 026 Req 7: the rule and the live address, always visible,
              previewing the settled value so the trailing dash never shows
              in an address. The origin comes from the page, not the lib. */}
          <UrlNameGuidance origin={window.location.origin} urlName={settled} testIdPrefix="new-workspace" />
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
            // Issue #183 §2: name-as-label over a full-width select, matching
            // the settings Workspace tab's member rows.
            <div className="field" key={member.id}>
              <label htmlFor={`new-workspace-role-${member.id}`}>
                {picked.find((p) => p.id === member.id)?.displayName ?? member.id}
              </label>
              <select
                id={`new-workspace-role-${member.id}`}
                className="field"
                data-testid={`new-workspace-role-${member.id}`}
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
              className="field"
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

        {error && (
          // Issue #245: the submit-time refusal — the server's duplicate-name
          // message lands here — in the same error treatment.
          <>
            <p className="form-error" data-testid="new-workspace-error" role="alert">
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
                data-testid="new-workspace-use-suggestion"
                onClick={() => acceptSuggestion(suggestion)}
              >
                Use {suggestion}
              </Button>
            )}
          </>
        )}
        <div className="dialog-actions">
          <Button data-testid="new-workspace-cancel" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            data-testid="new-workspace-create"
            disabled={busy}
            onClick={() => void submit()}
          >
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The Open Workspace dialog: the whole deployment, filtered as you type. PRD
 * 007 Req 11 (issue #312): the signed-in user's most recently used workspaces
 * lead the list, most-recently-used first, then the rest most recently
 * modified first.
 */
export function OpenWorkspaceDialog({
  lifecycle,
  me,
  recentIds = [],
  onClose,
}: {
  lifecycle: WorkspaceLifecycle;
  /** PRD 020 Req 12: the signed-in session, for the identity footer. */
  me?: SessionMe | null;
  /**
   * PRD 007 Req 11 (issue #312): the user's recently opened workspace ids,
   * most recent first — read off the per-user recent-workspaces.json store
   * the app already keeps. Ids the listing does not contain are ignored.
   */
  recentIds?: readonly string[];
  onClose: () => void;
}) {
  const [all, setAll] = useState<WorkspaceListing[]>([]);
  // PRD 007 Req 10/11 (issue #252): loading is a state of its own, not "the
  // list is still empty" — the empty state used to flash while the fetch was
  // in flight, and only a settled fetch can honestly say nothing matched.
  const [settled, setSettled] = useState(false);
  const [query, setQuery] = useState('');
  // The no-access state names the chosen workspace's Owners; resolving them
  // is one directory round trip, made only when it is actually needed.
  const [denied, setDenied] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    // A rejected listing settles too: the dialog says nothing matched rather
    // than spinning forever.
    void lifecycle.list().then(
      (items) => {
        if (cancelled) return;
        setAll(items);
        setSettled(true);
      },
      () => {
        if (!cancelled) setSettled(true);
      },
    );
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

  // PRD 007 Req 10/11 (issue #252): at most OPEN_WORKSPACE_ROW_CAP rows — the
  // fixed-height list area's worth — chosen by the pure seam, never sliced in
  // the JSX below. Issue #312: the seam puts the user's recently used
  // workspaces first, so they fill the visible rows ahead of merely
  // recently modified ones.
  const shown = visibleWorkspaces(query, all, recentIds);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog workspace-modal" data-testid="open-workspace-dialog">
        <h2>Open workspace</h2>
        <div className="field">
          <input
            type="text"
            className="field"
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
        {/* PRD 007 Req 10/11 (issue #252): the reserved list area. Its height
            is fixed at the row cap's worth, so the loading indicator, the rows
            and the settled-empty line — all rendered INSIDE it — leave the
            dialog at the size it opened at. */}
        <div className="workspace-list-area" data-testid="open-workspace-list-area">
          <ul className="workspace-list" data-testid="open-workspace-list">
            {shown.map((workspace) => (
              <li key={workspace.id}>
                <button
                  type="button"
                  className="btn-quiet workspace-list-item"
                  data-testid={`open-workspace-item-${workspace.id}`}
                  onClick={() => void choose(workspace)}
                >
                  <span className="workspace-list-name">{workspace.name}</span>
                  {/* PRD 019 Req 8: the caller's own scratchpad row carries a
                      distinguishing badge; every other row renders none. */}
                  {workspaceRowBadge(workspace) && (
                    <span className="badge scratchpad" data-testid={`open-workspace-scratchpad-${workspace.id}`}>
                      {workspaceRowBadge(workspace)}
                    </span>
                  )}
                  <span className="workspace-list-modified" data-testid={`open-workspace-modified-${workspace.id}`}>
                    {timeAgo(workspace.modified)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {/* Issue #252: the in-flight affordance is SearchPanel's spinner
              idiom (`search-scanning`), role="status" and keyframes included,
              holding the space the rows will take. */}
          {!settled && (
            <div className="workspace-list-status" data-testid="open-workspace-loading" role="status">
              <span className="search-scanning-spinner" aria-hidden="true" />
              Loading workspaces…
            </div>
          )}
          {/* Issue #252: only a settled fetch can say nothing matched — while
              one is in flight this element does not exist. */}
          {settled && shown.length === 0 && (
            <p className="workspace-list-status" data-testid="open-workspace-empty">
              No workspace matches “{query}”.
            </p>
          )}
          {/* Issue #252: the refusal overlays the bottom of the reserved area
              instead of adding a line under it, so an unopenable choice cannot
              reflow the dialog however long the Owners list runs. */}
          {denied && (
            <p className="workspace-no-access" data-testid="open-workspace-no-access" role="alert">
              {denied}
            </p>
          )}
        </div>
        {/* PRD 020 Req 12: the signed-in identity surface — display name,
            assigned username (the URL segment, distinct from the UPN), and
            the resulting scratchpad URL, right where workspaces are picked. */}
        {me && (
          <p className="hotkey-hint" data-testid="open-workspace-identity">
            Signed in as {me.displayName} ({me.handle}) — your scratchpad lives at{' '}
            <span data-testid="open-workspace-identity-scratch-url">{buildScratchPath(me.handle)}</span>
          </p>
        )}
        <div className="dialog-actions">
          <Button data-testid="open-workspace-cancel" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

