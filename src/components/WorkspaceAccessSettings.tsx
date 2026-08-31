// Issue #183 §1 (was PRD 007 Req 15+16+17's appended sections): the People
// tab of Settings. The hook loads the open workspace's manifest and the
// signed-in user's resolved permissions ONCE — SettingsPanel reads it to
// decide whether the tab exists at all, and the tab body hands both to the
// people and roles sections so a role created in one is grantable in the
// other without a reload. Each section still renders only for a holder of
// its single verb — the same pattern WorkspaceDangerZone uses for
// `workspace.delete` — and the server endpoints behind them refuse anyone
// else regardless.

import { useEffect, useState } from 'react';
import type { Permission, WorkspaceManifest } from '../lib/hostedWorkspace';
import type { DeploymentAdmin } from '../platform/hostedAdmin';
import type { WorkspaceLifecycle } from '../platform/hostedWorkspaces';
import { WorkspaceDangerZone } from './WorkspaceDangerZone';
import { WorkspaceMembers } from './WorkspaceMembers';
import { WorkspaceRoles } from './WorkspaceRoles';

export interface WorkspaceAccess {
  workspaceId: string | null;
  manifest: WorkspaceManifest | null;
  permissions: Permission[];
  setManifest: (manifest: WorkspaceManifest) => void;
  /**
   * Issue #183 §1: whether the People tab exists — a hosted workspace is
   * open AND the member holds at least one of the verbs the tab's sections
   * gate on. No permission-denied placeholder tab.
   */
  peopleTab: boolean;
}

/** The verbs that give the People tab something to show. */
const PEOPLE_TAB_PERMISSIONS: readonly Permission[] = [
  'workspace.members',
  'workspace.roles',
  'workspace.delete',
];

export function useWorkspaceAccess(lifecycle: WorkspaceLifecycle | undefined): WorkspaceAccess {
  const workspaceId = lifecycle?.currentId() ?? null;
  const [manifest, setManifest] = useState<WorkspaceManifest | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);

  useEffect(() => {
    // Reset first, so a workspace switch never shows the previous one's
    // people while the new manifest loads.
    setManifest(null);
    setPermissions([]);
    if (!lifecycle || !workspaceId) return;
    let cancelled = false;
    void Promise.all([lifecycle.manifest(workspaceId), lifecycle.permissions(workspaceId)]).then(
      ([loaded, resolved]) => {
        if (cancelled) return;
        setManifest(loaded);
        setPermissions(resolved);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [lifecycle, workspaceId]);

  return {
    workspaceId,
    manifest,
    permissions,
    setManifest,
    peopleTab:
      workspaceId !== null && manifest !== null && PEOPLE_TAB_PERMISSIONS.some((p) => permissions.includes(p)),
  };
}

/** Issue #183 §1: the People tab body — members, roles, then the danger zone. */
export function WorkspacePeopleTab({
  lifecycle,
  access,
  admin,
  me,
}: {
  lifecycle: WorkspaceLifecycle;
  access: WorkspaceAccess;
  /** PRD 017 Req 32: the admin transport + session facts for the invite row. */
  admin?: DeploymentAdmin;
  me?: { admin?: boolean } | null;
}) {
  const { workspaceId, manifest, permissions, setManifest } = access;
  if (!workspaceId || !manifest) return null;
  return (
    <>
      {permissions.includes('workspace.members') && (
        <WorkspaceMembers
          lifecycle={lifecycle}
          workspaceId={workspaceId}
          manifest={manifest}
          onManifest={setManifest}
          admin={admin}
          me={me}
        />
      )}
      {permissions.includes('workspace.roles') && (
        <WorkspaceRoles
          lifecycle={lifecycle}
          workspaceId={workspaceId}
          manifest={manifest}
          onManifest={setManifest}
        />
      )}
      {/* The danger zone self-gates on `workspace.delete`, exactly as before. */}
      <WorkspaceDangerZone lifecycle={lifecycle} />
    </>
  );
}
