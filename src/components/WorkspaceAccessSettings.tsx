// PRD 007 Req 15+16 (+17): the permission-gated access sections of Workspace
// settings. It loads the open workspace's manifest and the signed-in user's
// resolved permissions ONCE and hands both to the people and roles sections,
// so a role created in one is grantable in the other without a reload.
// Each section renders only for a holder of its single verb — the same
// pattern WorkspaceDangerZone uses for `workspace.delete` — and the server
// endpoints behind them refuse anyone else regardless.

import { useEffect, useState } from 'react';
import type { Permission, WorkspaceManifest } from '../lib/hostedWorkspace';
import type { WorkspaceLifecycle } from '../platform/hostedWorkspaces';
import { WorkspaceMembers } from './WorkspaceMembers';
import { WorkspaceRoles } from './WorkspaceRoles';

export function WorkspaceAccessSettings({ lifecycle }: { lifecycle: WorkspaceLifecycle }) {
  const id = lifecycle.currentId();
  const [manifest, setManifest] = useState<WorkspaceManifest | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void Promise.all([lifecycle.manifest(id), lifecycle.permissions(id)]).then(([loaded, resolved]) => {
      if (cancelled) return;
      setManifest(loaded);
      setPermissions(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [lifecycle, id]);

  if (!id || !manifest) return null;
  const canMembers = permissions.includes('workspace.members');
  const canRoles = permissions.includes('workspace.roles');
  if (!canMembers && !canRoles) return null;

  return (
    <>
      {canMembers && (
        <WorkspaceMembers
          lifecycle={lifecycle}
          workspaceId={id}
          manifest={manifest}
          onManifest={setManifest}
        />
      )}
      {canRoles && (
        <WorkspaceRoles
          lifecycle={lifecycle}
          workspaceId={id}
          manifest={manifest}
          onManifest={setManifest}
        />
      )}
    </>
  );
}
