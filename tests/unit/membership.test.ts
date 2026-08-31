import { describe, expect, it } from 'vitest';
import {
  createDirectorySearch,
  filterSelectable,
  initialsFor,
  resolveMembers,
  type DirectoryEntry,
  type SearchTimers,
} from '../../src/lib/membership';

// PRD 007 Req 6: the membership picker's pure logic — initials fallback,
// selection rules, debounced search-as-you-type, and stored-member
// resolution — unit-tested with injected search/lookup functions and timers.

const user = (id: string, displayName: string, username = id): DirectoryEntry => ({
  id,
  displayName,
  username,
});

/** Hand-cranked timers: the debounce fires only when the test says so. */
function fakeTimers() {
  let next = 0;
  const pending = new Map<number, () => void>();
  const timers: SearchTimers = {
    set: (fn) => {
      pending.set(++next, fn);
      return next;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    fire() {
      const fns = [...pending.values()];
      pending.clear();
      fns.forEach((fn) => fn());
    },
    pendingCount: () => pending.size,
  };
}

describe('PRD 007 Req 6 membership picker logic', () => {
  it('U247: initialsFor picks first + last word initials, falling back to username, then a neutral glyph', () => {
    expect(initialsFor('Ada Lovelace')).toBe('AL');
    expect(initialsFor('Katherine Coleman Goble Johnson')).toBe('KJ');
    expect(initialsFor('ada')).toBe('A');
    expect(initialsFor('', 'grace')).toBe('G');
    expect(initialsFor('   ', '')).toBe('?');
  });

  it('U248: filterSelectable drops already-selected users so a member is never offered twice', () => {
    const results = [user('a', 'Ada'), user('b', 'Grace'), user('c', 'Alan')];
    expect(filterSelectable(results, ['b'])).toEqual([results[0], results[2]]);
    expect(filterSelectable(results, [])).toEqual(results);
    expect(filterSelectable(results, ['a', 'b', 'c'])).toEqual([]);
  });

  it('U249: search is debounced — typing three keystrokes issues one request, for the latest query', async () => {
    const clock = fakeTimers();
    const searched: string[] = [];
    const results: DirectoryEntry[][] = [];
    const search = createDirectorySearch({
      search: async (q) => {
        searched.push(q);
        return [user(q, q)];
      },
      onResults: (users) => results.push(users),
      timers: clock.timers,
    });
    search.setQuery('a');
    search.setQuery('ad');
    search.setQuery('ada');
    expect(searched).toEqual([]); // nothing until the pause
    expect(clock.pendingCount()).toBe(1); // earlier keystrokes' timers were cancelled
    clock.fire();
    await Promise.resolve();
    expect(searched).toEqual(['ada']);
    expect(results).toEqual([[user('ada', 'ada')]]);
    // A blank query clears immediately, with no request at all.
    search.setQuery('   ');
    expect(results[results.length - 1]).toEqual([]);
    expect(searched).toEqual(['ada']);
    search.dispose();
  });

  it('U250: a stale response never overwrites a newer query, a failed request yields empty, dispose cancels', async () => {
    const clock = fakeTimers();
    const resolvers = new Map<string, (users: DirectoryEntry[]) => void>();
    const results: { users: DirectoryEntry[]; query: string }[] = [];
    const search = createDirectorySearch({
      search: (q) =>
        q === 'boom'
          ? Promise.reject(new Error('network down'))
          : new Promise((resolve) => resolvers.set(q, resolve)),
      onResults: (users, query) => results.push({ users, query }),
      timers: clock.timers,
    });
    search.setQuery('gra');
    clock.fire(); // 'gra' request in flight…
    search.setQuery('grace');
    clock.fire(); // …and 'grace' too
    resolvers.get('grace')!([user('g', 'Grace')]);
    await Promise.resolve();
    resolvers.get('gra')!([user('stale', 'Stale')]); // the older request answers late
    await Promise.resolve();
    expect(results).toEqual([{ users: [user('g', 'Grace')], query: 'grace' }]);
    // Without an onError handler, a rejected search still collapses to empty
    // results rather than an unhandled error (issue #183 §3 kept the default).
    search.setQuery('boom');
    clock.fire();
    await Promise.resolve();
    await Promise.resolve();
    expect(results[results.length - 1]).toEqual({ users: [], query: 'boom' });
    // dispose: a pending timer dies and an in-flight answer is dropped.
    search.setQuery('late');
    search.dispose();
    expect(clock.pendingCount()).toBe(0);
  });

  it('U963: with onError given, a failed request is distinguishable from an empty answer — and stale failures are dropped', async () => {
    // Issue #183 §3: the picker shows "directory error" apart from "no
    // matches", so the controller must stop collapsing failures into [].
    const clock = fakeTimers();
    const results: { users: DirectoryEntry[]; query: string }[] = [];
    const errors: string[] = [];
    const rejecters = new Map<string, (err: Error) => void>();
    const search = createDirectorySearch({
      search: (q) =>
        q.startsWith('boom')
          ? new Promise((_resolve, reject) => rejecters.set(q, reject))
          : Promise.resolve(q === 'nobody' ? [] : [user(q, q)]),
      onResults: (users, query) => results.push({ users, query }),
      onError: (query) => errors.push(query),
      timers: clock.timers,
    });
    // A failure lands in onError, never in onResults.
    search.setQuery('boom');
    clock.fire();
    rejecters.get('boom')!(new Error('500'));
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toEqual(['boom']);
    expect(results).toEqual([]);
    // An empty successful answer still lands in onResults.
    search.setQuery('nobody');
    clock.fire();
    await Promise.resolve();
    expect(results).toEqual([{ users: [], query: 'nobody' }]);
    // A stale failure never overwrites a newer query's state.
    search.setQuery('boom2');
    clock.fire();
    search.setQuery('grace');
    clock.fire();
    await Promise.resolve();
    rejecters.get('boom2')!(new Error('late 500'));
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toEqual(['boom']);
    expect(results[results.length - 1]).toEqual({ users: [user('grace', 'grace')], query: 'grace' });
    search.dispose();
  });

  it('U251: resolveMembers maps resolvable ids to display entries and keeps unresolvable ones as plain identifiers', async () => {
    const entries = await resolveMembers(['mock-ada', 'gone-user', 'mock-grace', 'flaky'], async (id) => {
      if (id === 'gone-user') return null; // 404 — left the tenant
      if (id === 'flaky') throw new Error('500'); // one failing lookup breaks nothing else
      return { id, displayName: id.replace('mock-', ''), username: id, avatarUrl: `/api/directory/users/${id}/photo` };
    });
    expect(entries).toEqual([
      {
        id: 'mock-ada',
        displayName: 'ada',
        username: 'mock-ada',
        avatarUrl: '/api/directory/users/mock-ada/photo',
        resolved: true,
      },
      { id: 'gone-user', displayName: 'gone-user', username: '', resolved: false },
      {
        id: 'mock-grace',
        displayName: 'grace',
        username: 'mock-grace',
        avatarUrl: '/api/directory/users/mock-grace/photo',
        resolved: true,
      },
      { id: 'flaky', displayName: 'flaky', username: '', resolved: false },
    ]);
  });

  it('U803: resolveMembers prefers the live directory answer, then the manifest snapshot, then the plain id — and carries the guest flag through', async () => {
    // PRD 007 Req 6 (issue #180): the fallback ordering that keeps member
    // lists human-readable when Graph is unreachable or the user left.
    const entries = await resolveMembers(
      [
        // Live answer wins even when a snapshot exists (and isGuest rides along).
        { id: 'mock-ada', displayName: 'Stale Ada' },
        // Directory answers null → the snapshot stands in, unresolved.
        { id: 'gone-user', displayName: 'Grace (as added)' },
        // Lookup fails outright → the snapshot still stands in.
        { id: 'flaky', displayName: 'Katherine (as added)' },
        // No snapshot → the plain identifier, exactly as before.
        'gone-bare',
      ],
      async (id) => {
        if (id === 'gone-user' || id === 'gone-bare') return null;
        if (id === 'flaky') throw new Error('503');
        return { id, displayName: 'Ada Lovelace', username: 'ada@contoso.com', isGuest: true };
      },
    );
    expect(entries).toEqual([
      { id: 'mock-ada', displayName: 'Ada Lovelace', username: 'ada@contoso.com', isGuest: true, resolved: true },
      { id: 'gone-user', displayName: 'Grace (as added)', username: '', resolved: false },
      { id: 'flaky', displayName: 'Katherine (as added)', username: '', resolved: false },
      { id: 'gone-bare', displayName: 'gone-bare', username: '', resolved: false },
    ]);
  });
});
