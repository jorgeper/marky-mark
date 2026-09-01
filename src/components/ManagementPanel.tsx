// PRD 017 Req 13: the Management view — the deployment-admin dialog behind
// the `management` command, styled after SettingsPanel but sized near
// full-window (its own .management-modal rule; it must NOT inherit the
// Settings dialog's fixed maximum width). Three tabs: Workspaces (Req 16–18),
// People (Req 19, plus the invite and rescind actions) and Settings
// (Req 20). Mounted only when the platform defines the deploymentAdmin
// capability AND /api/me says admin — and the server gates every route
// again regardless.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  adminWorkspaceTotals,
  explicitMembershipCounts,
  filterAdminUsers,
  filterAdminWorkspaces,
  formatByteSize,
  type AdminUserRow,
  type AdminWorkspaceRow,
} from '../lib/deploymentAdmin';
import {
  parseDeploymentSettings,
  serializeDeploymentSettings,
  type CreationAllowEntry,
  type CreationPolicy,
  type DeploymentSettings,
  type ListingPolicy,
} from '../lib/deploymentSettings';
// Issue #195: the copy-confirmation duration is the code-copy button's, so
// "Copied" feels identical everywhere a copy control lives.
import { CONFIRM_MS } from '../lib/codeCopy';
import { parseInvitationRequest } from '../lib/invitations';
import type { MemberEntry } from '../lib/membership';
import { deleteConfirmationMatches, formatOwnerNames } from '../lib/workspaceLifecycle';
import type { DeploymentAdmin } from '../platform/hostedAdmin';
import type { WorkspaceLifecycle } from '../platform/hostedWorkspaces';
import { MembershipPicker } from './MembershipPicker';
import { Button } from './ui/Button';

type ManagementTab = 'workspaces' | 'people' | 'settings';

const TABS: Array<{ id: ManagementTab; label: string }> = [
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'people', label: 'People' },
  { id: 'settings', label: 'Settings' },
];

export interface ManagementPanelProps {
  /** The /api/admin routes (platform/hostedAdmin.ts). */
  admin: DeploymentAdmin;
  /** Open/Delete/resolve/search ride the existing lifecycle seam. */
  lifecycle: WorkspaceLifecycle;
  // Issue #195: App's one clipboard seam (platform.copyText, else the
  // browser clipboard) — resolves whether the write landed, so a refusal
  // can fall back to showing the URL for manual copy.
  copy: (text: string) => Promise<boolean>;
  onClose: () => void;
}

const dateOf = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString() : '—');

/** The Everyone column: unknown on a corrupt row, else the default role or Off. */
function everyoneLabel(everyone: AdminWorkspaceRow['everyone']): string {
  if (everyone === null) return '—';
  return everyone.enabled ? everyone.role : 'Off';
}

export function ManagementPanel({ admin, lifecycle, copy, onClose }: ManagementPanelProps) {
  const [tab, setTab] = useState<ManagementTab>('workspaces');

  // PRD 017 Req 16: the Workspaces rows — ALSO the People tab's source of
  // explicit-membership counts, so both tabs load from the one request.
  const [rows, setRows] = useState<AdminWorkspaceRow[] | null>(null);
  const [rowsError, setRowsError] = useState('');
  const [owners, setOwners] = useState<Map<string, MemberEntry[]>>(new Map());
  const [wsQuery, setWsQuery] = useState('');

  // PRD 017 Req 19: the tenant — an error state, never an empty list, when
  // the directory cannot answer.
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [usersError, setUsersError] = useState('');
  const [peopleQuery, setPeopleQuery] = useState('');

  // PRD 017 Req 31: the Invite… form — email, optional note, Send.
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteNote, setInviteNote] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');

  // PRD 017 Req 20: the settings draft plus the Req 7 parse error when the
  // stored blob is corrupt (saving over it clears the condition).
  const [creation, setCreation] = useState<CreationPolicy>('everyone');
  const [allow, setAllow] = useState<CreationAllowEntry[]>([]);
  const [allowEntries, setAllowEntries] = useState<MemberEntry[]>([]);
  const [listing, setListing] = useState<ListingPolicy>('everyone');
  const [parseError, setParseError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  // Issue #195: the redeem URL of the most recent form invitation (Send or
  // Get invite link) — shown OUTSIDE the form so it survives Send closing
  // it, with its own Copied confirmation. The visible URL is itself the
  // manual-copy fallback.
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  // Issue #195: per-row copy-link outcome — confirmation, the manual-copy
  // URL when the clipboard write refused, or the server's refusal sentence.
  const [rowLink, setRowLink] = useState<
    | { id: string; kind: 'copied' }
    | { id: string; kind: 'manual'; url: string }
    | { id: string; kind: 'error'; error: string }
    | null
  >(null);
  const [rowLinkBusy, setRowLinkBusy] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  // Issue #193: the pending guest whose invitation is being rescinded,
  // behind the confirm step that names their email.
  const [rescinding, setRescinding] = useState<AdminUserRow | null>(null);
  const [rescindBusy, setRescindBusy] = useState(false);
  const [rescindError, setRescindError] = useState('');

  // PRD 017 Req 18: the row being deleted behind the exact-name gate.
  const [condemned, setCondemned] = useState<AdminWorkspaceRow | null>(null);
  const [typed, setTyped] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    let cancelled = false;
    admin.listWorkspaces().then(
      (loaded) => {
        if (!cancelled) setRows(loaded);
      },
      (err: Error) => {
        if (!cancelled) setRowsError(err.message);
      },
    );
    admin.listUsers().then(
      (loaded) => {
        if (!cancelled) setUsers(loaded);
      },
      (err: Error) => {
        if (!cancelled) setUsersError(err.message);
      },
    );
    admin.readSettings().then(
      ({ settings, error }) => {
        if (cancelled) return;
        setCreation(settings.creation.policy);
        setAllow(settings.creation.allow);
        setListing(settings.listing.policy);
        setParseError(error ?? '');
      },
      (err: Error) => {
        if (!cancelled) setSaveError(err.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [admin]);

  // PRD 017 Req 16: Owner ids resolve through the existing resolveMembers
  // seam, so display-name snapshots and guest badges apply unchanged.
  useEffect(() => {
    if (!rows) return;
    let cancelled = false;
    void Promise.all(
      rows.map(async (row) => [row.id, await lifecycle.resolveUsers(row.owners)] as const),
    ).then((resolved) => {
      if (!cancelled) setOwners(new Map(resolved));
    });
    return () => {
      cancelled = true;
    };
  }, [rows, lifecycle]);

  // PRD 017 Req 20 (issue #180): allow-list entries render through the same
  // resolution, their add-time snapshots the fallback name.
  useEffect(() => {
    let cancelled = false;
    void lifecycle.resolveUsers(allow).then((resolved) => {
      if (!cancelled) setAllowEntries(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [allow, lifecycle]);

  const visibleRows = useMemo(() => filterAdminWorkspaces(wsQuery, rows ?? []), [wsQuery, rows]);
  const totals = useMemo(() => adminWorkspaceTotals(rows ?? []), [rows]);
  const memberCounts = useMemo(() => explicitMembershipCounts(rows ?? []), [rows]);
  const visibleUsers = useMemo(() => filterAdminUsers(peopleQuery, users ?? []), [peopleQuery, users]);

  const saveSettings = async () => {
    setSaved(false);
    // PRD 017 Req 20: validate with the SHARED parser before sending, so a
    // refusal is predicted here rather than discovered as a 400.
    const record: DeploymentSettings = {
      version: 1,
      creation: { policy: creation, allow },
      listing: { policy: listing },
    };
    const validated = parseDeploymentSettings(serializeDeploymentSettings(record));
    if (!validated.ok) {
      setSaveError(validated.error);
      return;
    }
    const res = await admin.writeSettings(validated.settings);
    if (!res.ok) {
      setSaveError(res.error);
      return;
    }
    // Req 7: a successful save replaced the corrupt blob — the error is over.
    setParseError('');
    setSaveError('');
    setSaved(true);
  };

  // Issue #195: one brief "Copied" window for whichever copy confirmed
  // last — codeCopy's CONFIRM_MS, then both confirmations revert.
  const confirmCopied = (apply: () => void) => {
    apply();
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      setInviteLinkCopied(false);
      setRowLink((prior) => (prior?.kind === 'copied' ? null : prior));
    }, CONFIRM_MS);
  };

  /**
   * PRD 017 Req 31: invite without a workspace grant. The SHARED parser
   * predicts the 400 before sending (the settings tab's pattern); a server
   * refusal — Graph's own message on the 502 — shows inline, verbatim.
   * Success upserts the user row, Pending badge from the directory flag.
   * Issue #195: `sendEmail: false` is the form's Get invite link — the same
   * creation with Microsoft's mail suppressed, leaving the form open; both
   * outcomes surface the creation-time redeem URL beside the form.
   */
  const submitInvite = async (sendEmail: boolean) => {
    const note = inviteNote.trim();
    const parsed = parseInvitationRequest({
      email: inviteEmail.trim(),
      ...(note !== '' ? { note } : {}),
      ...(sendEmail ? {} : { sendEmail: false }),
    });
    if (!parsed.ok) {
      setInviteError(parsed.error);
      return;
    }
    setInviteBusy(true);
    setInviteError('');
    setInviteLink(null);
    setInviteLinkCopied(false);
    const answer = await admin.invite(parsed.invitation);
    setInviteBusy(false);
    if (!answer.ok) {
      setInviteError(answer.error);
      return;
    }
    const { guest } = answer;
    // Issue #195: an upsert, not an append — Get invite link may refresh an
    // invitation whose Pending row is already listed.
    setUsers((prior) => [
      ...(prior ?? []).filter((user) => user.id !== guest.id),
      { id: guest.id, displayName: guest.displayName, username: guest.email, isGuest: true, pending: true, admin: false },
    ]);
    setInviteLink({ email: guest.email, url: guest.redeemUrl });
    if (sendEmail) {
      setInviteOpen(false);
      setInviteEmail('');
      setInviteNote('');
    }
  };

  /**
   * Issue #195: Copy invite link on a Pending row — the server re-POSTs the
   * invitation with the mail suppressed and answers a fresh redeem URL,
   * which lands on the clipboard with brief "Copied" feedback. A refused
   * clipboard write shows the URL itself for manual copy instead; a server
   * refusal (the 409 eligibility sentence, a 502) shows verbatim.
   */
  const copyRowLink = async (user: AdminUserRow) => {
    setRowLinkBusy(user.id);
    setRowLink(null);
    const answer = await admin.inviteLink(user.id);
    setRowLinkBusy(null);
    if (!answer.ok) {
      setRowLink({ id: user.id, kind: 'error', error: answer.error });
      return;
    }
    if (await copy(answer.redeemUrl)) {
      confirmCopied(() => setRowLink({ id: user.id, kind: 'copied' }));
    } else {
      setRowLink({ id: user.id, kind: 'manual', url: answer.redeemUrl });
    }
  };

  /**
   * Issue #193: rescind the confirmed pending guest. Success removes the
   * People row and drops the id from every workspace row's member ids — the
   * server scrubbed the manifests in the same operation, so the Workspaces
   * counts mirror what is now stored. A refusal (the 409's eligibility
   * sentence, a 502's Graph refusal) shows in the dialog, verbatim.
   */
  const rescindConfirmed = async () => {
    if (!rescinding) return;
    const { id } = rescinding;
    setRescindBusy(true);
    const answer = await admin.rescind(id);
    setRescindBusy(false);
    if (!answer.ok) {
      setRescindError(answer.error);
      return;
    }
    setUsers((prior) => (prior ?? []).filter((user) => user.id !== id));
    setRows((prior) =>
      prior === null
        ? prior
        : prior.map((row) =>
            row.memberIds.includes(id)
              ? { ...row, memberIds: row.memberIds.filter((memberId) => memberId !== id) }
              : row,
          ),
    );
    setRescinding(null);
    setRescindError('');
  };

  const deleteCondemned = async () => {
    if (!condemned) return;
    setDeleteBusy(true);
    if (await lifecycle.remove(condemned.id)) {
      // PRD 017 Req 18: deleting the workspace this page is bound to unbinds
      // it exactly as Owner-deletion does (WorkspaceDangerZone's rule).
      if (lifecycle.currentId() === condemned.id) {
        lifecycle.navigateTo(null);
        return;
      }
      // Row and totals update on success — both derive from `rows`.
      setRows((prior) => (prior ?? []).filter((row) => row.id !== condemned.id));
      setCondemned(null);
      setTyped('');
      setDeleteError('');
      setDeleteBusy(false);
      return;
    }
    setDeleteError('The workspace could not be deleted.');
    setDeleteBusy(false);
  };

  const condemnedName = condemned ? (condemned.name ?? condemned.id) : '';

  const workspacesTab = (
    <div className="tab-section">
      <div className="inline-row">
        <input
          type="text"
          className="field"
          data-testid="admin-workspaces-filter"
          placeholder="Filter workspaces…"
          value={wsQuery}
          onChange={(e) => setWsQuery(e.target.value)}
        />
      </div>
      {/* PRD 017 Req 16: the totals header — workspaces, files, bytes. */}
      <p className="hotkey-hint" data-testid="admin-workspaces-totals">
        {totals.workspaces} workspaces · {totals.files} files · {formatByteSize(totals.bytes)}
      </p>
      {rowsError !== '' && (
        <p className="hotkey-hint" data-testid="admin-workspaces-error" role="alert">
          {rowsError}
        </p>
      )}
      {rows !== null && (
        <table className="admin-table" data-testid="admin-workspaces-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Created</th>
              <th>Modified</th>
              <th>Owners</th>
              <th>Members</th>
              <th>Everyone</th>
              <th>Files</th>
              <th>Size</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id} data-testid={`admin-workspace-row-${row.id}`}>
                <td>
                  {row.name ?? row.id}
                  {/* Req 16: a corrupt manifest is flagged, never hidden. */}
                  {row.error !== undefined && (
                    <span
                      className="admin-corrupt-badge"
                      data-testid={`admin-workspace-corrupt-${row.id}`}
                      title={row.error}
                    >
                      corrupt manifest
                    </span>
                  )}
                </td>
                <td>{dateOf(row.created)}</td>
                <td>{dateOf(row.modified)}</td>
                <td data-testid={`admin-workspace-owners-${row.id}`}>
                  {formatOwnerNames(owners.get(row.id) ?? [])}
                </td>
                <td data-testid={`admin-workspace-members-${row.id}`}>{row.memberIds.length}</td>
                <td>{everyoneLabel(row.everyone)}</td>
                <td data-testid={`admin-workspace-files-${row.id}`}>{row.fileCount}</td>
                <td data-testid={`admin-workspace-size-${row.id}`}>{formatByteSize(row.totalBytes)}</td>
                <td className="admin-row-actions">
                  {/* PRD 017 Req 17: bind exactly as the Open dialog does. */}
                  <Button
                    variant="quiet"
                    size="sm"
                    data-testid={`admin-workspace-open-${row.id}`}
                    onClick={() => lifecycle.navigateTo(row.id)}
                  >
                    Open
                  </Button>
                  <Button
                    variant="quiet"
                    size="sm"
                    className="btn-danger"
                    data-testid={`admin-workspace-delete-${row.id}`}
                    onClick={() => {
                      setCondemned(row);
                      setTyped('');
                      setDeleteError('');
                    }}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const peopleTab = (
    <div className="tab-section">
      <div className="inline-row">
        <input
          type="text"
          className="field"
          data-testid="admin-users-filter"
          placeholder="Filter people…"
          value={peopleQuery}
          onChange={(e) => setPeopleQuery(e.target.value)}
        />
        {/* PRD 017 Req 31: the Invite… action opens the small form below.
            Issue #192: primary — it is the tab's one call to action. */}
        <Button
          variant="primary"
          data-testid="admin-invite-open"
          onClick={() => {
            setInviteOpen((open) => !open);
            setInviteError('');
          }}
        >
          Invite…
        </Button>
      </div>
      {inviteOpen && (
        <div className="field" data-testid="admin-invite-form">
          <label htmlFor="admin-invite-email">Email</label>
          <input
            id="admin-invite-email"
            data-testid="admin-invite-email"
            className="field"
            type="text"
            value={inviteEmail}
            placeholder="person@example.com"
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <label htmlFor="admin-invite-note">Note (optional)</label>
          <input
            id="admin-invite-note"
            data-testid="admin-invite-note"
            className="field"
            type="text"
            value={inviteNote}
            onChange={(e) => setInviteNote(e.target.value)}
          />
          {inviteError !== '' && (
            <p className="hotkey-hint" data-testid="admin-invite-error" role="alert">
              {inviteError}
            </p>
          )}
          <div className="dialog-actions">
            <Button
              variant="primary"
              data-testid="admin-invite-send"
              disabled={inviteBusy}
              onClick={() => void submitInvite(true)}
            >
              Send
            </Button>
            {/* Issue #195: the same creation without Microsoft's mail — the
                redeem URL below is the invitation, for when the mail cannot
                be trusted to arrive. Secondary: Send stays the call to
                action (issue #192). */}
            <Button
              data-testid="admin-invite-get-link"
              disabled={inviteBusy}
              onClick={() => void submitInvite(false)}
            >
              Get invite link
            </Button>
          </div>
        </div>
      )}
      {/* Issue #195: the created invitation's redeem URL — outside the form
          so Send's success (which closes the form) still shows the link it
          created. The visible URL doubles as the manual-copy fallback. */}
      {inviteLink && (
        <div className="field admin-invite-link" data-testid="admin-invite-link" role="status">
          <label>Invite link for {inviteLink.email}</label>
          <div className="inline-row">
            <code className="admin-link-url" data-testid="admin-invite-link-url">
              {inviteLink.url}
            </code>
            <Button
              variant="quiet"
              size="sm"
              data-testid="admin-invite-link-copy"
              onClick={() => {
                void copy(inviteLink.url).then((ok) => {
                  if (ok) confirmCopied(() => setInviteLinkCopied(true));
                });
              }}
            >
              Copy
            </Button>
            {inviteLinkCopied && (
              <span className="hotkey-hint" data-testid="admin-invite-link-copied">
                Copied
              </span>
            )}
          </div>
        </div>
      )}
      {/* PRD 017 Req 19: a directory failure is said, never an empty tenant. */}
      {usersError !== '' && (
        <p className="hotkey-hint" data-testid="admin-users-error" role="alert">
          {usersError}
        </p>
      )}
      {users !== null && (
        <table className="admin-table" data-testid="admin-users-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Workspaces</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((user) => (
              <tr key={user.id} data-testid={`admin-user-row-${user.id}`}>
                <td>
                  {user.displayName}
                  {user.isGuest === true && (
                    <span className="membership-guest-badge" data-testid={`admin-user-guest-${user.id}`}>
                      Guest
                    </span>
                  )}
                  {/* PRD 017 Req 33: Pending beside Guest until acceptance. */}
                  {user.pending === true && (
                    <span className="membership-pending-badge" data-testid={`admin-user-pending-${user.id}`}>
                      Pending
                    </span>
                  )}
                  {/* Req 19: the Admin badge marks MM_ADMINS membership. */}
                  {user.admin && (
                    <span className="admin-badge" data-testid={`admin-user-admin-${user.id}`}>
                      Admin
                    </span>
                  )}
                </td>
                <td>{user.username}</td>
                <td data-testid={`admin-user-workspaces-${user.id}`}>{memberCounts.get(user.id) ?? 0}</td>
                <td className="admin-row-actions">
                  {/* Issue #195: ONLY a Pending row offers Copy invite link —
                      Graph re-answers a redeem URL solely for an unredeemed
                      invitation, and the server 409s everyone else. */}
                  {user.pending === true && (
                    <Button
                      variant="quiet"
                      size="sm"
                      data-testid={`admin-copy-link-${user.id}`}
                      disabled={rowLinkBusy === user.id}
                      onClick={() => void copyRowLink(user)}
                    >
                      Copy invite link
                    </Button>
                  )}
                  {rowLink?.id === user.id && rowLink.kind === 'copied' && (
                    <span className="hotkey-hint" data-testid={`admin-copy-link-copied-${user.id}`} role="status">
                      Copied
                    </span>
                  )}
                  {rowLink?.id === user.id && rowLink.kind === 'manual' && (
                    // Issue #195: the clipboard refused — the URL itself is
                    // the fallback, visible and selectable for manual copy.
                    <code className="admin-link-url" data-testid={`admin-copy-link-url-${user.id}`}>
                      {rowLink.url}
                    </code>
                  )}
                  {rowLink?.id === user.id && rowLink.kind === 'error' && (
                    <span className="hotkey-hint" data-testid={`admin-copy-link-error-${user.id}`} role="alert">
                      {rowLink.error}
                    </span>
                  )}
                  {/* Issue #193: ONLY a Pending row offers Rescind — members
                      and accepted guests are managed in Entra, never here. */}
                  {user.pending === true && (
                    <Button
                      variant="quiet"
                      size="sm"
                      className="btn-danger"
                      data-testid={`admin-rescind-${user.id}`}
                      onClick={() => {
                        setRescinding(user);
                        setRescindError('');
                      }}
                    >
                      Rescind
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const settingsTab = (
    <div className="tab-section">
      {/* PRD 017 Req 7: the stored blob failed to parse — the deployment is
          failing closed until an admin saves over it, and this is where. */}
      {parseError !== '' && (
        <p className="hotkey-hint" data-testid="admin-settings-parse-error" role="alert">
          The stored settings could not be read ({parseError}). The deployment is running with
          creation and listing restricted until you save.
        </p>
      )}
      <h2>Workspace creation</h2>
      {/* PRD 017 Req 8: three exclusive choices, semantics spelled out.
          Admins may create under every policy. */}
      {(
        [
          ['everyone', 'Everyone — any signed-in user may create a workspace.'],
          ['members', 'Members — tenant members may create; guests may not.'],
          ['restricted', 'Restricted — only deployment admins and the people listed below.'],
        ] as const
      ).map(([policy, label]) => (
        <label className="radio-label" key={policy}>
          <input
            type="radio"
            name="admin-creation-policy"
            data-testid={`admin-creation-${policy}`}
            checked={creation === policy}
            onChange={() => setCreation(policy)}
          />
          {label}
        </label>
      ))}
      {creation === 'restricted' && (
        <div className="field" data-testid="admin-creation-allow">
          <label>Allowed to create workspaces</label>
          <MembershipPicker
            searchUsers={(query) => lifecycle.searchUsers(query)}
            selected={allowEntries}
            // Issue #180's add-time snapshot: the display name is stamped
            // into the record here, when the admin can still see who it was.
            onAdd={(user) => setAllow((prior) => [...prior, { id: user.id, displayName: user.displayName }])}
            onRemove={(id) => setAllow((prior) => prior.filter((entry) => entry.id !== id))}
          />
        </div>
      )}
      <h2>Workspace listing</h2>
      {(
        [
          ['everyone', 'Everyone — every workspace is listed for every signed-in user.'],
          ['members', 'Members — each user sees only workspaces they can access.'],
        ] as const
      ).map(([policy, label]) => (
        <label className="radio-label" key={policy}>
          <input
            type="radio"
            name="admin-listing-policy"
            data-testid={`admin-listing-${policy}`}
            checked={listing === policy}
            onChange={() => setListing(policy)}
          />
          {label}
        </label>
      ))}
      {saveError !== '' && (
        <p className="hotkey-hint" data-testid="admin-settings-error" role="alert">
          {saveError}
        </p>
      )}
      {saved && (
        <p className="hotkey-hint" data-testid="admin-settings-saved" role="status">
          Settings saved.
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="primary" data-testid="admin-settings-save" onClick={() => void saveSettings()}>
          Save
        </Button>
      </div>
    </div>
  );

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog management-modal" data-testid="management-panel">
        <div className="settings-body">
          <nav className="tab-rail" data-testid="management-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`btn btn-quiet tab-btn${tab === t.id ? ' on' : ''}`}
                data-testid={`management-tab-${t.id}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="tab-content" data-testid="management-content">
            {tab === 'workspaces' && workspacesTab}
            {tab === 'people' && peopleTab}
            {tab === 'settings' && settingsTab}
            <div className="dialog-actions">
              <Button variant="primary" data-testid="management-close" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        </div>
        {/* Issue #193: the rescind confirm step — it names the guest's email
            so the admin sees exactly whose invitation is being revoked. */}
        {rescinding && (
          <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setRescinding(null)}>
            <div className="dialog workspace-danger" data-testid="admin-rescind-dialog">
              <h2>Rescind invitation</h2>
              <p className="hotkey-hint" data-testid="admin-rescind-message">
                Rescinding removes {rescinding.username}’s pending guest account and any workspace
                memberships it was granted. This cannot be undone.
              </p>
              {rescindError !== '' && (
                <p className="hotkey-hint" data-testid="admin-rescind-error" role="alert">
                  {rescindError}
                </p>
              )}
              <div className="dialog-actions">
                <Button data-testid="admin-rescind-cancel" onClick={() => setRescinding(null)}>
                  Cancel
                </Button>
                {/* PRD 018 Req 21 (issue #204): the destructive FILL — this
                    confirm was a .workspace-danger button.destructive, so it
                    keeps the danger bg via the .btn-danger.btn-primary
                    compound, like WorkspaceDangerZone's submit. */}
                <Button
                  variant="danger"
                  className="btn-primary"
                  data-testid="admin-rescind-confirm"
                  disabled={rescindBusy}
                  onClick={() => void rescindConfirmed()}
                >
                  Rescind invitation
                </Button>
              </div>
            </div>
          </div>
        )}
        {/* PRD 017 Req 18: the Owner-facing delete pattern, verbatim —
            WorkspaceDangerZone's wording behind the same exact-name gate. */}
        {condemned && (
          <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setCondemned(null)}>
            <div className="dialog workspace-danger" data-testid="admin-delete-dialog">
              <h2>Delete workspace</h2>
              <p className="hotkey-hint">
                Deleting “{condemnedName}” permanently removes its documents, comments and images for
                everyone. This cannot be undone.
              </p>
              <div className="field">
                <label htmlFor="admin-delete-confirm">Type the workspace name to confirm</label>
                <input
                  id="admin-delete-confirm"
                  data-testid="admin-delete-confirm"
                  className="field"
                  type="text"
                  value={typed}
                  placeholder={condemnedName}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </div>
              {deleteError !== '' && (
                <p className="hotkey-hint" data-testid="admin-delete-error" role="alert">
                  {deleteError}
                </p>
              )}
              <div className="dialog-actions">
                <Button data-testid="admin-delete-cancel" onClick={() => setCondemned(null)}>
                  Cancel
                </Button>
                {/* PRD 018 Req 21 (issue #204): destructive fill, as above. */}
                <Button
                  variant="danger"
                  className="btn-primary"
                  data-testid="admin-delete-submit"
                  disabled={!deleteConfirmationMatches(typed, condemnedName) || deleteBusy}
                  onClick={() => void deleteCondemned()}
                >
                  Delete this workspace
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
