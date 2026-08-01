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

describe('PRD 002 §D15 recent workspaces (same lineage, separate store)', () => {
  test('U68: the workspace store is its own MRU — per-section cap, dedupe by path, tolerant parse, Clear', () => {
    // A second RecentStore instance holds the workspaces — its cap and
    // dedupe are independent of the files store.
    let files: RecentStore = { version: 1, entries: [] };
    let ws: RecentStore = { version: 1, entries: [] };
    for (let i = 0; i < RECENT_CAP; i++) files = rememberRecent(files, `/docs/f${i}.md`, '2026-08-01T10:00:00Z');
    for (let i = 0; i < RECENT_CAP + 2; i++) ws = rememberRecent(ws, `/w/p${i}.marky-workspace`, '2026-08-01T10:01:00Z');
    expect(files.entries).toHaveLength(RECENT_CAP);
    expect(ws.entries).toHaveLength(RECENT_CAP); // its own cap, not shared
    expect(ws.entries[0].path).toBe(`/w/p${RECENT_CAP + 1}.marky-workspace`);

    // MRU bump on re-open of a named workspace, deduped by path.
    ws = rememberRecent(ws, '/w/p5.marky-workspace', '2026-08-01T10:02:00Z');
    expect(ws.entries.filter((e) => e.path === '/w/p5.marky-workspace')).toHaveLength(1);
    expect(ws.entries[0].path).toBe('/w/p5.marky-workspace');

    // Corruption-tolerant parse, exactly parseRecent's contract.
    expect(parseRecent('{nope').entries).toEqual([]);
    expect(parseRecent('{"entries":[{"path":"/w/a.marky-workspace","at":"t"},{"path":42}]}').entries).toEqual([
      { path: '/w/a.marky-workspace', at: 't' },
    ]);
    const trip = parseRecent(serializeRecent(ws));
    expect(trip.entries).toEqual(ws.entries);

    // Labels disambiguate colliding basenames with the parent folder.
    const twins: RecentStore = {
      version: 1,
      entries: [
        { path: '/a/site.marky-workspace', at: 't' },
        { path: '/b/site.marky-workspace', at: 't' },
      ],
    };
    expect(recentMenuEntries(twins, basename, dirname).map((e) => e.label)).toEqual([
      'site.marky-workspace — a',
      'site.marky-workspace — b',
    ]);

    // Clear empties a section; the sibling store is untouched by design.
    ws = clearRecent();
    expect(ws.entries).toEqual([]);
    expect(files.entries).toHaveLength(RECENT_CAP);
  });
});

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
