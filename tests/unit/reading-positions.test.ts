import { describe, expect, test } from 'vitest';
import { parsePositions, positionFor, rememberPosition, serializePositions } from '../../src/lib/readingPositions';

describe('SPEC16 reading positions', () => {
  test('U31: round-trip, corrupt fallback, LRU bump/dedupe, 200-entry cap', () => {
    // Corrupt / missing → empty store.
    expect(parsePositions('not json')).toEqual({ version: 1, entries: [] });
    expect(parsePositions('{"version":9,"entries":"x"}')).toEqual({ version: 1, entries: [] });

    let store = parsePositions('{}');
    store = rememberPosition(store, '/docs/a.md', 42, '2026-07-11T00:00:00Z');
    store = rememberPosition(store, '/docs/b.md', 7, '2026-07-11T00:01:00Z');
    expect(store.entries.map((e) => e.path)).toEqual(['/docs/b.md', '/docs/a.md']); // most recent first
    expect(positionFor(store, '/docs/a.md')).toBe(42);
    expect(positionFor(store, '/docs/none.md')).toBeNull();

    // Re-remembering bumps to the front and updates in place (no duplicate).
    store = rememberPosition(store, '/docs/a.md', 99, '2026-07-11T00:02:00Z');
    expect(store.entries.map((e) => e.path)).toEqual(['/docs/a.md', '/docs/b.md']);
    expect(positionFor(store, '/docs/a.md')).toBe(99);

    // Round-trip.
    expect(parsePositions(serializePositions(store))).toEqual(store);

    // Cap at 200: the oldest entry is evicted.
    let big = parsePositions('{}');
    for (let i = 1; i <= 201; i++) {
      big = rememberPosition(big, `/docs/${i}.md`, i, `2026-07-11T01:${String(i % 60).padStart(2, '0')}:00Z`);
    }
    expect(big.entries).toHaveLength(200);
    expect(positionFor(big, '/docs/1.md')).toBeNull(); // evicted
    expect(positionFor(big, '/docs/201.md')).toBe(201);
  });
});
