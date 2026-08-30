// PRD 007 Req 6: the reusable membership picker — search-as-you-type over the
// tenant directory, avatars with an initials fallback, and a selected-members
// list. API access arrives as props (never a fetch call site), so #75's
// create-workspace flow and #77's settings membership management mount it
// against the live /api/directory endpoints unchanged; this issue ships the
// component without mounting it anywhere.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createDirectorySearch,
  filterSelectable,
  initialsFor,
  type DirectoryEntry,
  type MemberEntry,
} from '../lib/membership';

/** PRD 007 Req 6 (issue #180): the visible guest marker — rendered beside a
 *  name whenever the directory flags the user a guest of the tenant. */
function GuestBadge({ entry }: { entry: Pick<DirectoryEntry, 'isGuest'> }) {
  if (!entry.isGuest) return null;
  return <span className="membership-guest-badge">Guest</span>;
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
}

export function MembershipPicker({
  searchUsers,
  selected,
  onAdd,
  onRemove,
  placeholder = 'Add people…',
  debounceMs,
}: MembershipPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DirectoryEntry[]>([]);
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
        onResults: (users) => setResults(users),
        delayMs: debounceMs,
      }),
    [],
  );
  useEffect(() => () => search.dispose(), [search]);

  /** The input value and the controller move together — never one without the other. */
  const changeQuery = (value: string) => {
    setQuery(value);
    search.setQuery(value);
  };

  const selectable = filterSelectable(
    results,
    selected.map((m) => m.id),
  );

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
                <span className="membership-username">{member.username}</span>
              </>
            ) : (
              // PRD 007 Req 6: a member the directory no longer resolves
              // (left the tenant) stays in the list as its plain identifier —
              // no avatar, not an error state.
              <span className="membership-name">{member.displayName}</span>
            )}
            <button
              type="button"
              className="membership-remove"
              data-testid={`membership-picker-remove-${member.id}`}
              aria-label={`Remove ${member.displayName}`}
              onClick={() => onRemove(member.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <input
        className="membership-input"
        data-testid="membership-picker-input"
        value={query}
        placeholder={placeholder}
        onChange={(e) => changeQuery(e.target.value)}
      />
      {selectable.length > 0 && (
        <ul className="membership-results" data-testid="membership-picker-results">
          {selectable.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                className="membership-result"
                data-testid={`membership-picker-result-${user.id}`}
                onClick={() => {
                  onAdd(user);
                  changeQuery('');
                }}
              >
                <MemberAvatar entry={user} />
                <span className="membership-name">{user.displayName}</span>
                <GuestBadge entry={user} />
                <span className="membership-username">{user.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
