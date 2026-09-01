// PRD 007 Req 6: the reusable membership picker — search-as-you-type over the
// tenant directory, avatars with an initials fallback, and a selected-members
// list. API access arrives as props (never a fetch call site), so #75's
// create-workspace flow and #77's settings membership management mount it
// against the live /api/directory endpoints unchanged; this issue ships the
// component without mounting it anywhere.

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  createDirectorySearch,
  filterSelectable,
  initialsFor,
  type DirectoryEntry,
  type MemberEntry,
} from '../lib/membership';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';

/** PRD 007 Req 6 (issue #180): the visible guest marker — rendered beside a
 *  name whenever the directory flags the user a guest of the tenant. */
function GuestBadge({ entry }: { entry: Pick<DirectoryEntry, 'isGuest'> }) {
  if (!entry.isGuest) return null;
  return <span className="membership-guest-badge">Guest</span>;
}

/** PRD 017 Req 33: beside the Guest badge until the invitation is redeemed. */
function PendingBadge({ entry }: { entry: Pick<DirectoryEntry, 'pending'> }) {
  if (entry.pending !== true) return null;
  return <span className="membership-pending-badge">Pending</span>;
}

/** Avatar image when the directory has one, initials disc when it does not
 *  (or when the photo URL answers 404 — Graph users without a photo). */
function MemberAvatar({ entry }: { entry: Pick<DirectoryEntry, 'displayName' | 'username' | 'avatarUrl'> }) {
  const [failed, setFailed] = useState(false);
  if (!entry.avatarUrl || failed) {
    return (
      <span className="membership-avatar membership-avatar-initials" aria-hidden="true">
        {initialsFor(entry.displayName, entry.username)}
      </span>
    );
  }
  return (
    <img
      className="membership-avatar"
      src={entry.avatarUrl}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

export interface MembershipPickerProps {
  /** Directory search, `GET /api/directory/search?q=` shaped — injected so no live server is required. */
  searchUsers: (query: string) => Promise<DirectoryEntry[]>;
  /** The current members; unresolved entries render as plain identifiers. */
  selected: readonly MemberEntry[];
  onAdd: (user: DirectoryEntry) => void;
  onRemove: (id: string) => void;
  placeholder?: string;
  /** Debounce for search-as-you-type; overridable so tests need not wait. */
  debounceMs?: number;
  /**
   * PRD 017 Req 32: the admin-only invite row — the dropdown empty state's
   * action. `offer` is the pure predicate (offersInviteRow) over the
   * `/api/me` payload, the settled query and its results; when the prop is
   * absent the picker renders byte-identically to before.
   */
  invite?: {
    offer: (query: string, results: DirectoryEntry[]) => boolean;
    roles: readonly string[];
    defaultRole: string;
    onInvite: (email: string, role: string) => void;
  };
}

export function MembershipPicker({
  searchUsers,
  selected,
  onAdd,
  onRemove,
  placeholder = 'Add people…',
  debounceMs,
  invite,
}: MembershipPickerProps) {
  const [query, setQuery] = useState('');
  // PRD 017 Req 32: the invite row's role choice — null until the admin picks
  // one, so the default grant applies even when `invite` arrives after mount.
  const [inviteRole, setInviteRole] = useState<string | null>(null);
  // Issue #183 §3: the dropdown renders the LAST SETTLED search — results, an
  // empty answer, or a directory failure — as three distinguishable states.
  // null means "nothing to show" (blank query, or nothing resolved yet).
  const [outcome, setOutcome] = useState<{ query: string; users: DirectoryEntry[]; failed: boolean } | null>(
    null,
  );
  // Issue #183 §3: Esc closes the dropdown until the next keystroke.
  const [dismissed, setDismissed] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const latestSearchUsers = useRef(searchUsers);
  latestSearchUsers.current = searchUsers;

  // One controller for the component's lifetime: it owns the debounce timer
  // and drops out-of-order responses; dispose cancels in-flight work. The
  // search function is read through a ref so a caller re-rendering with a new
  // closure still hits the latest one; debounceMs is captured at mount.
  const search = useMemo(
    () =>
      createDirectorySearch({
        search: (q) => latestSearchUsers.current(q),
        onResults: (users, q) => {
          setOutcome(q ? { query: q, users, failed: false } : null);
          setHighlight(0);
        },
        onError: (q) => {
          setOutcome({ query: q, users: [], failed: true });
          setHighlight(0);
        },
        delayMs: debounceMs,
      }),
    [],
  );
  useEffect(() => () => search.dispose(), [search]);

  /** The input value and the controller move together — never one without the other. */
  const changeQuery = (value: string) => {
    setQuery(value);
    setDismissed(false);
    search.setQuery(value);
  };

  const selectable = outcome && !outcome.failed
    ? filterSelectable(
        outcome.users,
        selected.map((m) => m.id),
      )
    : [];
  const open = outcome !== null && !dismissed;
  // The highlight is clamped at use, so a shrinking result list never points
  // past the end between renders.
  const active = selectable.length > 0 ? Math.min(highlight, selectable.length - 1) : -1;

  const pick = (user: DirectoryEntry) => {
    onAdd(user);
    changeQuery('');
  };

  // Issue #183 §3: ↑/↓ move the highlight, Enter adds it, Esc closes — Esc is
  // stopped so it dismisses only the dropdown, never the settings panel above.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown' && selectable.length > 0) {
      e.preventDefault();
      setHighlight((active + 1) % selectable.length);
    } else if (e.key === 'ArrowUp' && selectable.length > 0) {
      e.preventDefault();
      setHighlight((active - 1 + selectable.length) % selectable.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(selectable[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
    }
  };

  return (
    <div className="membership-picker" data-testid="membership-picker">
      <ul className="membership-selected" data-testid="membership-picker-selected">
        {selected.map((member) => (
          <li
            key={member.id}
            className={member.resolved ? 'membership-member' : 'membership-member membership-member-unresolved'}
            data-testid={`membership-picker-member-${member.id}`}
          >
            {member.resolved ? (
              <>
                <MemberAvatar entry={member} />
                <span className="membership-name">{member.displayName}</span>
                <GuestBadge entry={member} />
                <PendingBadge entry={member} />
                <span className="membership-username">{member.username}</span>
              </>
            ) : (
              // PRD 007 Req 6: a member the directory no longer resolves
              // (left the tenant) stays in the list as its plain identifier —
              // no avatar, not an error state.
              <span className="membership-name">{member.displayName}</span>
            )}
            <IconButton
              className="membership-remove"
              data-testid={`membership-picker-remove-${member.id}`}
              aria-label={`Remove ${member.displayName}`}
              onClick={() => onRemove(member.id)}
            >
              ×
            </IconButton>
          </li>
        ))}
      </ul>
      {/* Issue #183 §3: input + dropdown anchor — the suggestions float under
          the input instead of pushing the section apart. */}
      <div className="membership-search">
        <input
          type="text"
          className="field"
          data-testid="membership-picker-input"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${selectable[active].id}` : undefined}
          value={query}
          placeholder={placeholder}
          onChange={(e) => changeQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {open && (
          <div className="membership-dropdown" data-testid="membership-picker-dropdown">
            {outcome.failed ? (
              // Issue #183 §3: a directory failure says so inline — never a
              // silent nothing that reads as "no such person".
              <p className="membership-note membership-note-error" role="alert" data-testid="membership-picker-error">
                The directory could not be searched. Try again.
              </p>
            ) : selectable.length === 0 ? (
              <>
                <p className="membership-note" data-testid="membership-picker-empty">
                  No people match “{outcome.query}”.
                </p>
                {/* PRD 017 Req 32: the empty state's action — an admin whose
                    query reads as an unmatched email may invite it, at a role
                    chosen right here. */}
                {invite && invite.offer(outcome.query, outcome.users) && (
                  <div className="membership-invite-row" data-testid="membership-picker-invite-row">
                    <Button
                      // PRD 018 Req 20 (issue #204): variant="primary" keeps
                      // issue #192's accent fill on the invite offer (E380
                      // asserts it); size="sm" fits the dropdown row.
                      variant="primary"
                      size="sm"
                      data-testid="membership-picker-invite"
                      // Keep focus in the input so the dropdown survives until the click lands.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        invite.onInvite(outcome.query.trim(), inviteRole ?? invite.defaultRole);
                        changeQuery('');
                      }}
                    >
                      Invite {outcome.query.trim()} as
                    </Button>
                    <select
                      className="field"
                      data-testid="membership-picker-invite-role"
                      aria-label="Role for the invited guest"
                      value={inviteRole ?? invite.defaultRole}
                      onMouseDown={(e) => e.stopPropagation()}
                      onChange={(e) => setInviteRole(e.target.value)}
                    >
                      {invite.roles.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            ) : (
              <ul className="membership-results" id={listId} role="listbox" data-testid="membership-picker-results">
                {selectable.map((user, i) => (
                  <li key={user.id} id={`${listId}-${user.id}`} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      tabIndex={-1}
                      className={`btn-quiet membership-result${i === active ? ' active' : ''}`}
                      data-testid={`membership-picker-result-${user.id}`}
                      // Keep focus in the input so the dropdown survives until the click lands.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(user)}
                    >
                      <MemberAvatar entry={user} />
                      <span className="membership-name">{user.displayName}</span>
                      <GuestBadge entry={user} />
                      <PendingBadge entry={user} />
                      <span className="membership-username">{user.username}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
