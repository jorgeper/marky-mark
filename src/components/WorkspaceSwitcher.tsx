// PRD 007 Req 10/11: the hosted workspace lifecycle's reachable surface — a
// switcher chip naming the open workspace, the New Workspace flow (name +
// initial members with roles, or everyone-in-tenant access), and the Open
// Workspace dialog (every workspace in the deployment, fuzzy search-as-you-
// type, an in-dialog no-access message naming the Owners). Mounted on the
// Platform's `workspaces` capability, so nothing here asks which flavor is
// running; all decisions are the pure functions in lib/workspaceLifecycle.ts.

import { useEffect, useState } from 'react';
import { MembershipPicker } from './MembershipPicker';
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
import type { WorkspaceLifecycle } from '../platform/hostedWorkspaces';

type Dialog = 'none' | 'new' | 'open';

/**
 * The New Workspace dialog: name, initial members with roles, everyone-access.
 * Exported because PRD 007 Req 21's start page drives the very same flow —
 * the switcher chip and the start page must land in the same place.
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

        {error && (
          <p className="hotkey-hint" data-testid="new-workspace-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button data-testid="new-workspace-cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" data-testid="new-workspace-create" disabled={busy} onClick={() => void submit()}>
            Create
          </button>
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

/**
 * The always-present entry point: a chip naming the open workspace (or "No
 * workspace") that opens the two flows. It is the hosted shell's workspace
 * switcher — reachable without issue #78's start-page action list.
 */
export function WorkspaceSwitcher({ lifecycle }: { lifecycle: WorkspaceLifecycle }) {
  const [dialog, setDialog] = useState<Dialog>('none');
  const [menuOpen, setMenuOpen] = useState(false);
  const [label, setLabel] = useState('No workspace');

  const currentId = lifecycle.currentId();
  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    void lifecycle.list().then((items) => {
      const current = items.find((w) => w.id === currentId);
      if (!cancelled && current) setLabel(current.name);
    });
    return () => {
      cancelled = true;
    };
  }, [lifecycle, currentId]);

  const open = (next: Dialog) => {
    setMenuOpen(false);
    setDialog(next);
  };

  return (
    <>
      <div className="workspace-switcher" data-testid="workspace-switcher">
        <button
          type="button"
          className="workspace-switcher-chip"
          data-testid="workspace-switcher-chip"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {label}
        </button>
        {menuOpen && (
          <div className="workspace-switcher-menu" data-testid="workspace-switcher-menu">
            <button type="button" data-testid="workspace-switcher-new" onClick={() => open('new')}>
              New Workspace…
            </button>
            <button type="button" data-testid="workspace-switcher-open" onClick={() => open('open')}>
              Open Workspace…
            </button>
          </div>
        )}
      </div>
      {dialog === 'new' && <NewWorkspaceDialog lifecycle={lifecycle} onClose={() => setDialog('none')} />}
      {dialog === 'open' && <OpenWorkspaceDialog lifecycle={lifecycle} onClose={() => setDialog('none')} />}
    </>
  );
}
