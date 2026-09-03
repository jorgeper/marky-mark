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
import { Button } from './ui/Button';
import type { DirectoryEntry, MemberEntry } from '../lib/membership';
import { timeAgo } from '../lib/time';
import { uniqueNameProblem } from '../lib/workspaceNames';
import {
  DEFAULT_MEMBER_ROLE,
  GRANTABLE_ROLES,
  emptyNewWorkspaceForm,
  filterWorkspaces,
  noAccessMessage,
  validateNewWorkspaceForm,
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
  const [busy, setBusy] = useState(false);
  // PRD 020 Req 2: format/length/reserved problems appear while typing; the
  // empty field waits for submit to complain (WorkspaceNames does the same).
  const typedProblem = form.uniqueName === '' ? null : uniqueNameProblem(form.uniqueName);

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
      <div className="dialog workspace-modal" data-testid="new-workspace-dialog">
        <h2>New workspace</h2>
        {/* PRD 020 Req 2: the unique name comes first and is validated as you
            type — the same pure rule the server enforces, so format/length/
            reserved problems show inline before submit ever happens. */}
        <div className="field">
          <label htmlFor="new-workspace-unique-name">Unique name</label>
          <input
            id="new-workspace-unique-name"
            className="field"
            data-testid="new-workspace-unique-name"
            type="text"
            value={form.uniqueName}
            autoFocus
            onChange={(e) => setForm((prev) => ({ ...prev, uniqueName: e.target.value }))}
          />
          {typedProblem && (
            <p className="hotkey-hint" data-testid="new-workspace-unique-name-error" role="alert">
              {typedProblem}
            </p>
          )}
        </div>
        {/* PRD 020 Req 2: the optional friendly display name — free text;
            blank means the unique name is what chrome displays. The input
            keeps its original test id (`new-workspace-name`): renaming ids
            is forbidden, and this is still the display-name field. */}
        <div className="field">
          <label htmlFor="new-workspace-name">Display name (optional)</label>
          <input
            id="new-workspace-name"
            className="field"
            data-testid="new-workspace-name"
            type="text"
            value={form.name}
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
            // Issue #183 §2: name-as-label over a full-width select, matching
            // the settings People tab's member rows.
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
          <p className="hotkey-hint" data-testid="new-workspace-error" role="alert">
            {error}
          </p>
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
        <div className="dialog-actions">
          <Button data-testid="open-workspace-cancel" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

