import { describe, expect, test } from 'vitest';
import {
  clearRecent,
  parseRecent,
  RECENT_CAP,
  recentMenuEntries,
  rememberRecent,
  removeRecent,
  serializeRecent,
  type RecentStore,
} from '../../src/lib/recentFiles';

const basename = (p: string) => p.split('/').filter(Boolean).pop() ?? '';
const dirname = (p: string) => p.split('/').slice(0, -1).join('/') || '/';

describe('SPEC29 recent files', () => {
  test('U56: MRU insert/dedupe/cap, remove, clear, labels, round-trip, corruption tolerance', () => {
    let s: RecentStore = { version: 1, entries: [] };
    s = rememberRecent(s, '/docs/a.md', '2026-07-12T10:00:00Z');
    s = rememberRecent(s, '/docs/b.md', '2026-07-12T10:01:00Z');
    s = rememberRecent(s, '/docs/c.md', '2026-07-12T10:02:00Z');
    expect(s.entries.map((e) => e.path)).toEqual(['/docs/c.md', '/docs/b.md', '/docs/a.md']);

    // Re-opening bumps to the front without duplicating.
    s = rememberRecent(s, '/docs/a.md', '2026-07-12T10:03:00Z');
    expect(s.entries.map((e) => e.path)).toEqual(['/docs/a.md', '/docs/c.md', '/docs/b.md']);
    expect(s.entries[0].at).toBe('2026-07-12T10:03:00Z');

    // Cap at 10, oldest falls off.
    for (let i = 0; i < RECENT_CAP + 3; i++) s = rememberRecent(s, `/n/f${i}.md`, '2026-07-12T11:00:00Z');
    expect(s.entries.length).toBe(RECENT_CAP);
    expect(s.entries[0].path).toBe(`/n/f${RECENT_CAP + 2}.md`);
    expect(s.entries.some((e) => e.path === '/docs/a.md')).toBe(false);

    // remove / clear.
    const removed = removeRecent(s, s.entries[1].path);
    expect(removed.entries.length).toBe(RECENT_CAP - 1);
    expect(clearRecent().entries).toEqual([]);

    // Labels: bare basenames unless they collide → parent-folder suffix.
    let l: RecentStore = { version: 1, entries: [] };
    l = rememberRecent(l, '/work/notes.md', '2026-07-12T10:00:00Z');
    l = rememberRecent(l, '/home/notes.md', '2026-07-12T10:01:00Z');
    l = rememberRecent(l, '/docs/unique.md', '2026-07-12T10:02:00Z');
    expect(recentMenuEntries(l, basename, dirname)).toEqual([
      { path: '/docs/unique.md', label: 'unique.md' },
      { path: '/home/notes.md', label: 'notes.md — home' },
      { path: '/work/notes.md', label: 'notes.md — work' },
    ]);

    // Round-trip; malformed and absent JSON come back empty.
    expect(parseRecent(serializeRecent(l))).toEqual(l);
    expect(parseRecent('not json').entries).toEqual([]);
    expect(parseRecent('{"entries":"nope"}').entries).toEqual([]);
    expect(parseRecent('{"entries":[{"path":123},{"path":"/ok.md","at":"t"}]}').entries).toEqual([
      { path: '/ok.md', at: 't' },
    ]);
  });
});
