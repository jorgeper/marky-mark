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

/** Avatar image when the directory has one, initials disc when it does not
 *  (or when the photo URL answers 404 — Graph users without a photo). */
function MemberAvatar({ entry }: { entry: { displayName: string; username: string; avatarUrl?: string } }) {
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
  const latest = useRef({ searchUsers, debounceMs });
  latest.current = { searchUsers, debounceMs };

  // One controller for the component's lifetime: it owns the debounce timer
  // and drops out-of-order responses; dispose cancels in-flight work.
  const search = useMemo(
    () =>
      createDirectorySearch({
        search: (q) => latest.current.searchUsers(q),
        onResults: (users) => setResults(users),
        delayMs: latest.current.debounceMs,
      }),
    [],
  );
  useEffect(() => () => search.dispose(), [search]);

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
        onChange={(e) => {
          setQuery(e.target.value);
          search.setQuery(e.target.value);
        }}
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
                  setQuery('');
                  search.setQuery('');
                }}
              >
                <MemberAvatar entry={user} />
                <span className="membership-name">{user.displayName}</span>
                <span className="membership-username">{user.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
