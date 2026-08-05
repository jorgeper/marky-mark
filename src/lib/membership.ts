// PRD 007 Req 6: the membership picker's non-DOM logic — debounced directory
// search, selection rules, initials fallback, and stored-member resolution.
// Pure functions with the API injected (a search/lookup function, never a
// fetch call site), so the component stays a thin shell and #75/#77 reuse
// this against any transport.

/** A directory user as `GET /api/directory/search` returns it (mirrors server/providers/types.ts). */
export interface DirectoryEntry {
  id: string;
  displayName: string;
  username: string;
  avatarUrl?: string;
}

/** A stored member id resolved for display — or kept as a plain identifier. */
export interface MemberEntry {
  id: string;
  displayName: string;
  username: string;
  avatarUrl?: string;
  /** False when the directory no longer knows the id (left the tenant). */
  resolved: boolean;
}

/**
 * Up to two initials for the avatar fallback: first letter of the first and
 * last words of the display name (falling back to the username, then '?').
 */
export function initialsFor(displayName: string, username = ''): string {
  const words = displayName.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    const alt = username.trim();
    return alt ? [...alt][0]!.toUpperCase() : '?';
  }
  const picked = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]];
  return picked.map((w) => [...w][0]!.toUpperCase()).join('');
}

/** Search results minus the already-selected users — never offer a member twice. */
export function filterSelectable(
  results: DirectoryEntry[],
  selectedIds: Iterable<string>,
): DirectoryEntry[] {
  const taken = new Set(selectedIds);
  return results.filter((u) => !taken.has(u.id));
}

/** Injectable timers so unit tests drive the debounce without real clocks. */
export interface SearchTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface DirectorySearchController {
  /** The latest input value; debounces the actual request. */
  setQuery(query: string): void;
  /** Cancel any pending request/timer (component unmount). */
  dispose(): void;
}

/**
 * Debounced search-as-you-type: one request per pause, not per keystroke.
 * A blank query clears results immediately without a request; out-of-order
 * responses are dropped so a slow early request never overwrites a newer
 * one; a failed request yields an empty result list rather than an error.
 */
export function createDirectorySearch(options: {
  search: (query: string) => Promise<DirectoryEntry[]>;
  onResults: (users: DirectoryEntry[], query: string) => void;
  delayMs?: number;
  timers?: SearchTimers;
}): DirectorySearchController {
  const delayMs = options.delayMs ?? 250;
  const timers: SearchTimers = options.timers ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let pending: unknown = null;
  let generation = 0;

  const clearPending = () => {
    if (pending !== null) {
      timers.clear(pending);
      pending = null;
    }
  };

  return {
    setQuery(query: string): void {
      clearPending();
      const q = query.trim();
      const gen = ++generation;
      if (!q) {
        options.onResults([], '');
        return;
      }
      pending = timers.set(() => {
        pending = null;
        void options.search(q).then(
          (users) => {
            if (gen === generation) options.onResults(users, q);
          },
          () => {
            if (gen === generation) options.onResults([], q);
          },
        );
      }, delayMs);
    },
    dispose(): void {
      clearPending();
      generation++;
    },
  };
}

/**
 * Resolve stored member ids to display entries via the injected lookup
 * (`GET /api/directory/users/<id>` shaped: a user, or null on 404). A user
 * the directory no longer knows — or a lookup that fails outright — renders
 * as a plain identifier (`resolved: false`), and never breaks resolution of
 * the rest of the list. Order follows the input ids.
 */
export async function resolveMembers(
  ids: readonly string[],
  getUser: (id: string) => Promise<DirectoryEntry | null>,
): Promise<MemberEntry[]> {
  return Promise.all(
    ids.map(async (id) => {
      const user = await getUser(id).catch(() => null);
      return user
        ? { id: user.id, displayName: user.displayName, username: user.username, avatarUrl: user.avatarUrl, resolved: true }
        : { id, displayName: id, username: '', resolved: false };
    }),
  );
}
