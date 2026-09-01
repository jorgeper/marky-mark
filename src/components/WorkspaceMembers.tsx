// PRD 007 Req 16: the people section of Workspace settings — who is in the
// workspace, what role each holds, and whether everyone in the tenant gets a
// default role. It mounts the existing MembershipPicker (PRD 007 Req 6)
// against the live directory rather than forking it, and every edit goes
// through a server endpoint gated on `workspace.members`: the client shows
// the server's refusal (the last-Owner rule above all) rather than pretending
// a disabled control is the enforcement.

import { useEffect, useState } from 'react';
import {
  addWorkspaceMember,
  grantableRoleNames,
  OWNER_ROLE,
  removeWorkspaceMember,
  setEveryoneAccess,
  setWorkspaceMemberRole,
  type ManifestResult,
  type WorkspaceManifest,
} from '../lib/hostedWorkspace';
import { DEFAULT_MEMBER_ROLE } from '../lib/workspaceLifecycle';
import { offersInviteRow } from '../lib/invitations';
import type { MemberEntry } from '../lib/membership';
import type { DeploymentAdmin } from '../platform/hostedAdmin';
import type { WorkspaceLifecycle } from '../platform/hostedWorkspaces';
import { MembershipPicker } from './MembershipPicker';

export interface WorkspaceMembersProps {
  lifecycle: WorkspaceLifecycle;
  workspaceId: string;
  manifest: WorkspaceManifest;
  onManifest: (manifest: WorkspaceManifest) => void;
  /**
   * PRD 017 Req 32: the admin transport and the session's /api/me answer —
   * present only on a platform that has them; together with the pure
   * predicate they decide whether the picker offers its invite row.
   */
  admin?: DeploymentAdmin;
  me?: { admin?: boolean } | null;
}

export function WorkspaceMembers({ lifecycle, workspaceId, manifest, onManifest, admin, me }: WorkspaceMembersProps) {
  const [entries, setEntries] = useState<MemberEntry[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // The effect keys on the ids' serialization, not on the members array (a
  // new value every render) or on the manifest (a role or everyone-access
  // edit is no reason to re-resolve display names).
  const memberIdsKey = JSON.stringify(manifest.members.map((m) => m.id));

  // Display names come from the directory; when it cannot answer, the
  // manifest's add-time snapshot stands in (issue #180), and only an id
  // with neither stays a plain identifier (resolveMembers marks those
  // unresolved either way).
  useEffect(() => {
    let cancelled = false;
    void lifecycle
      .resolveUsers(manifest.members.map((m) => ({ id: m.id, displayName: m.displayName })))
      .then((resolved) => {
        if (!cancelled) setEntries(resolved);
      });
    return () => {
      cancelled = true;
    };
  }, [lifecycle, memberIdsKey]);

  /**
   * PRD 007 Req 16: decide with the SAME pure function the endpoint runs,
   * then send. A refusal — the last-Owner rule above all — becomes a visible
   * message without a round trip, and its wording is literally the server's.
   * The client copy is the explanation, never the enforcement: the endpoint
   * re-checks and answers 400 to anyone calling it directly (E189).
   */
  const apply = async (decision: ManifestResult, send: () => Promise<ManifestResult>) => {
    if (!decision.ok) {
      setError(decision.error);
      return;
    }
    setBusy(true);
    setError('');
    const result = await send();
    if (result.ok) onManifest(result.manifest);
    else setError(result.error);
    setBusy(false);
  };

  const roles = grantableRoleNames(manifest);
  const nameOf = (id: string) => entries.find((e) => e.id === id)?.displayName ?? id;
  // PRD 007 Req 6 (issue #180): guests of the tenant are badged wherever a
  // member renders — here on the role rows, and in the picker via GuestBadge.
  const isGuest = (id: string) => entries.find((e) => e.id === id)?.isGuest === true;
  // PRD 017 Req 33: an unredeemed invitation is badged Pending beside Guest.
  const isPending = (id: string) => entries.find((e) => e.id === id)?.pending === true;

  /**
   * PRD 017 Reqs 30+32: invite the typed email AND grant the chosen role in
   * this workspace in one request. On success the server has already written
   * the manifest, so the same pure mutation mirrors it here (the issue #180
   * snapshot is the email — the only name known yet) rather than re-reading.
   * A refusal — the parser's 400 or Graph's 502 — shows inline, verbatim;
   * so does a Req 30 grant that failed after the invitation landed.
   */
  const inviteGuest = async (email: string, role: string) => {
    if (!admin) return;
    setBusy(true);
    setError('');
    const answer = await admin.invite({ email, workspace: { id: workspaceId, role } });
    if (!answer.ok) {
      setError(answer.error);
      setBusy(false);
      return;
    }
    const grant = addWorkspaceMember(manifest, { id: answer.guest.id, role, displayName: email });
    if (grant.ok) onManifest(grant.manifest);
    if (answer.guest.membership) setError(answer.guest.membership.error);
    setBusy(false);
  };

  return (
    <div className="workspace-members" data-testid="workspace-members-section">
      <h2>People</h2>
      <p className="hotkey-hint">
        Members hold the role you give them here. A workspace always keeps at least one {OWNER_ROLE}.
      </p>
      <MembershipPicker
        searchUsers={(q) => lifecycle.searchUsers(q)}
        selected={entries}
        onAdd={(user) =>
          void apply(addWorkspaceMember(manifest, { id: user.id, role: DEFAULT_MEMBER_ROLE }), () =>
            lifecycle.addMember(workspaceId, { id: user.id, role: DEFAULT_MEMBER_ROLE }),
          )
        }
        onRemove={(id) =>
          void apply(removeWorkspaceMember(manifest, id), () => lifecycle.removeMember(workspaceId, id))
        }
        debounceMs={80}
        // PRD 017 Req 32: the invite row exists only for a deployment admin
        // on a platform holding the admin transport — and even then the pure
        // predicate over (/api/me, query, results) decides each render.
        invite={
          admin && me?.admin === true
            ? {
                offer: (query, results) => offersInviteRow(me, query, results),
                roles,
                defaultRole: DEFAULT_MEMBER_ROLE,
                onInvite: (email, role) => void inviteGuest(email, role),
              }
            : undefined
        }
      />
      {manifest.members.map((member) => (
        // Issue #183 §2: the member's name is the field label and the select
        // spans the field beneath it — its edges align with the Add people
        // input above (both dress from the shared .field primitive).
        <div className="workspace-member-field" key={member.id}>
          <label htmlFor={`workspace-member-role-${member.id}`}>
            {nameOf(member.id)}
            {isGuest(member.id) && (
              <span className="membership-guest-badge" data-testid={`workspace-member-guest-${member.id}`}>
                Guest
              </span>
            )}
            {/* PRD 017 Req 33: Pending beside Guest until acceptance. */}
            {isPending(member.id) && (
              <span className="membership-pending-badge" data-testid={`workspace-member-pending-${member.id}`}>
                Pending
              </span>
            )}
          </label>
          <select
            id={`workspace-member-role-${member.id}`}
            data-testid={`workspace-member-role-${member.id}`}
            className="field"
            value={member.role}
            disabled={busy}
            onChange={(e) =>
              void apply(setWorkspaceMemberRole(manifest, member.id, e.target.value), () =>
                lifecycle.setMemberRole(workspaceId, member.id, e.target.value),
              )
            }
          >
            {/* The five built-ins AND this workspace's own custom roles — a
                role created in the editor below is grantable immediately. */}
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
            {/* A role name the manifest no longer defines still shows as the
                member's current value rather than silently reading as another. */}
            {roles.includes(member.role) ? null : <option value={member.role}>{member.role}</option>}
          </select>
        </div>
      ))}

      {/* PRD 007 Req 16: everyone-in-tenant access with an Owner-chosen role.
          Explicit membership overrides it — that is resolvePermissions', not
          this control's, to enforce. */}
      <div className="checkbox-row">
        <input
          id="workspace-everyone-enabled"
          data-testid="workspace-everyone-enabled"
          type="checkbox"
          checked={manifest.everyone.enabled}
          disabled={busy}
          onChange={(e) =>
            void apply(setEveryoneAccess(manifest, { enabled: e.target.checked }), () =>
              lifecycle.setEveryone(workspaceId, { enabled: e.target.checked }),
            )
          }
        />
        <label htmlFor="workspace-everyone-enabled" style={{ margin: 0, fontWeight: 400 }}>
          Everyone in the organization can access this workspace
        </label>
      </div>
      {manifest.everyone.enabled && (
        <div className="workspace-member-field">
          <label htmlFor="workspace-everyone-role">Their role</label>
          <select
            id="workspace-everyone-role"
            data-testid="workspace-everyone-role"
            className="field"
            value={manifest.everyone.role}
            disabled={busy}
            onChange={(e) =>
              void apply(setEveryoneAccess(manifest, { enabled: true, role: e.target.value }), () =>
                lifecycle.setEveryone(workspaceId, { enabled: true, role: e.target.value }),
              )
            }
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p className="workspace-settings-error" data-testid="workspace-members-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
