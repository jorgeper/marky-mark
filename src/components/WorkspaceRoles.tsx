// PRD 007 Req 15: the custom-roles editor in Workspace settings — create,
// rename, re-scope and delete named subsets of the fourteen-verb catalog,
// stored in the manifest's `roles[]`. The five built-ins are listed read-only
// because they live in code, not in any manifest; a role a member (or a live
// everyone-grant) still holds cannot be deleted, and the server says so.
// Every write goes through an endpoint gated on `workspace.roles`.

import { useState } from 'react';
import {
  BUILT_IN_ROLES,
  createCustomRole,
  isCustomRoleInUse,
  PERMISSIONS,
  removeCustomRole,
  updateCustomRole,
  type ManifestResult,
  type CustomRole,
  type Permission,
  type WorkspaceManifest,
} from '../lib/hostedWorkspace';
import type { WorkspaceLifecycle } from '../platform/hostedWorkspaces';
import { Button } from './ui/Button';

export interface WorkspaceRolesProps {
  lifecycle: WorkspaceLifecycle;
  workspaceId: string;
  manifest: WorkspaceManifest;
  onManifest: (manifest: WorkspaceManifest) => void;
}

/** The catalog as checkable verbs — the whole of it, so nothing is unreachable. */
function PermissionChecklist({
  idPrefix,
  selected,
  onToggle,
}: {
  idPrefix: string;
  selected: readonly string[];
  onToggle: (permission: Permission, on: boolean) => void;
}) {
  return (
    <ul className="workspace-permission-list">
      {PERMISSIONS.map((permission) => (
        <li key={permission}>
          <label>
            <input
              type="checkbox"
              data-testid={`${idPrefix}-permission-${permission}`}
              checked={selected.includes(permission)}
              onChange={(e) => onToggle(permission, e.target.checked)}
            />
            {permission}
          </label>
        </li>
      ))}
    </ul>
  );
}

export function WorkspaceRoles({ lifecycle, workspaceId, manifest, onManifest }: WorkspaceRolesProps) {
  // One draft at a time: either the new-role form or the role being edited.
  const [draft, setDraft] = useState<CustomRole>({ name: '', permissions: [] });
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');

  /**
   * PRD 007 Req 15: the same decide-then-send discipline the people section
   * uses — a built-in name, a duplicate, or an in-use delete is refused here
   * with the wording the endpoint would answer, and the endpoint refuses it
   * again for anyone calling it directly (U304/U309).
   */
  const apply = async (decision: ManifestResult, send: () => Promise<ManifestResult>, onDone: () => void) => {
    if (!decision.ok) {
      setError(decision.error);
      return;
    }
    setError('');
    const result = await send();
    if (result.ok) {
      onManifest(result.manifest);
      onDone();
    } else {
      setError(result.error);
    }
  };

  const toggle = (permission: Permission, on: boolean) =>
    setDraft((prev) => ({
      ...prev,
      permissions: on ? [...prev.permissions, permission] : prev.permissions.filter((p) => p !== permission),
    }));

  const startEdit = (role: CustomRole) => {
    setError('');
    setEditing(role.name);
    setDraft({ name: role.name, permissions: [...role.permissions] });
  };

  const reset = () => {
    setEditing(null);
    setDraft({ name: '', permissions: [] });
  };

  return (
    <div className="workspace-roles" data-testid="workspace-roles-section">
      <h2>Roles</h2>
      <p className="hotkey-hint">
        The five built-in roles are fixed. Custom roles are named sets of permissions you can grant like any
        other role.
      </p>

      <ul className="workspace-role-list" data-testid="workspace-builtin-roles">
        {Object.keys(BUILT_IN_ROLES).map((name) => (
          <li className="workspace-role-row" key={name} data-testid={`workspace-builtin-role-${name}`}>
            <span className="workspace-role-name">{name}</span>
            <span className="hotkey-hint">built-in</span>
          </li>
        ))}
      </ul>

      <ul className="workspace-role-list">
        {manifest.roles.map((role) => {
          const inUse = isCustomRoleInUse(manifest, role.name);
          return (
            <li className="workspace-role-row" key={role.name} data-testid={`workspace-role-${role.name}`}>
              <span className="workspace-role-name">{role.name}</span>
              <span className="hotkey-hint">{role.permissions.length} permissions</span>
              <Button
                variant="quiet"
                size="sm"
                data-testid={`workspace-role-edit-${role.name}`}
                onClick={() => startEdit(role)}
              >
                Edit
              </Button>
              <Button
                variant="quiet"
                size="sm"
                className="btn-danger"
                data-testid={`workspace-role-delete-${role.name}`}
                // PRD 007 Req 15: a held role is undeletable. The control
                // explains rather than silently doing nothing — and the server
                // refuses it regardless of what the client renders.
                title={inUse ? `${role.name} is in use — change those grants first` : undefined}
                onClick={() =>
                  void apply(
                    removeCustomRole(manifest, role.name),
                    () => lifecycle.deleteRole(workspaceId, role.name),
                    reset,
                  )
                }
              >
                Delete
              </Button>
            </li>
          );
        })}
      </ul>

      {/* One form for both acts: blank name + empty set creates, an Edit
          click loads the role so a rename and a re-scope land in ONE update
          (which is what carries members over to the new name). */}
      <div className="field">
        <label htmlFor="workspace-role-name">{editing ? `Editing “${editing}”` : 'New role'}</label>
        <input
          id="workspace-role-name"
          data-testid="workspace-role-name"
          className="field"
          type="text"
          value={draft.name}
          placeholder="Role name"
          onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
        />
      </div>
      <PermissionChecklist idPrefix="workspace-role" selected={draft.permissions} onToggle={toggle} />
      <div className="dialog-actions">
        <Button
          data-testid="workspace-role-save"
          disabled={draft.name.trim() === ''}
          onClick={() =>
            void apply(
              editing === null ? createCustomRole(manifest, draft) : updateCustomRole(manifest, editing, draft),
              () =>
                editing === null
                  ? lifecycle.createRole(workspaceId, draft)
                  : lifecycle.updateRole(workspaceId, editing, draft),
              reset,
            )
          }
        >
          {editing === null ? 'Create role' : 'Save role'}
        </Button>
        {editing !== null && (
          <Button data-testid="workspace-role-cancel" onClick={reset}>
            Cancel
          </Button>
        )}
      </div>

      {error && (
        <p className="workspace-settings-error" data-testid="workspace-roles-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
