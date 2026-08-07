import { describe, expect, it } from 'vitest';
import { flattenSections, parseSections } from '../../src/lib/sectionModel';
import { reconcileSummaryKeys, summaryKeyForSection, type SummaryKeyContext } from '../../src/lib/summaryCache';
import {
  SUMMARY_CACHE_MAX_BYTES,
  emptySummaryCache,
  parseSummaryCache,
  readSummaryCacheEntry,
  serializeSummaryCache,
  summaryCacheBytes,
  writeSummaryCacheEntry,
  type SummaryCacheInput,
} from '../../src/lib/summaryCacheStore';
import { SUMMARY_CACHE_FILE, createFileSummaryCache, type SummaryCacheFs } from '../../src/platform/summaryCacheFiles';

// PRD 011 Req 28+29: the desktop summary cache — the pure store arithmetic and
// the file-backed store over it. Everything here runs against a fake file
// layer: no real filesystem, no config directory, no provider and no network.

const CONFIG_DIR = '/home/ada/.config/marky-mark';

/**
 * A fake of the file slice of the Platform seam, recording every path any
 * operation touched — that ledger is what U547 reads to prove the store never
 * writes beside a document.
 */
function createFakeFs(): SummaryCacheFs & { files: Map<string, string>; touched: string[] } {
  const files = new Map<string, string>();
  const touched: string[] = [];
  const note = (path: string): string => {
    touched.push(path);
    return path;
  };
  return {
    files,
    touched,
    configDir: async () => note(CONFIG_DIR),
    join: (...parts) => parts.filter(Boolean).join('/'),
    readTextFile: async (path) => {
      const content = files.get(note(path));
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return content;
    },
    writeTextFile: async (path, content) => {
      files.set(note(path), content);
    },
    exists: async (path) => files.has(note(path)),
    remove: async (path) => {
      files.delete(note(path));
    },
    mkdirp: async (dir) => {
      note(dir);
    },
  };
}

/** A clock the test drives by hand — no `Date.now()` anywhere in the store. */
function createFakeClock(start = 1_000): { now: () => number; tick(ms?: number): void } {
  let value = start;
  return {
    now: () => value,
    tick: (ms = 1_000) => {
      value += ms;
    },
  };
}

const input = (key: string, summary: string): SummaryCacheInput => ({
  key,
  summary,
  providerId: 'fake',
  modelId: 'fake-small',
  promptVersion: 'p1',
});

const CTX: SummaryKeyContext = { level: 3, providerId: 'fake', modelId: 'fake-small' };

describe('PRD 011 Req 28 — the summary cache store keeps #110’s keys and survives a restart', () => {
  it('U540: an entry round-trips through serialize/parse with its provider, model, prompt version and stamp', () => {
    const file = writeSummaryCacheEntry(emptySummaryCache(), input('k1', 'a summary'), 1_234);
    const back = parseSummaryCache(serializeSummaryCache(file));
    expect(readSummaryCacheEntry(back, 'k1')).toEqual({
      key: 'k1',
      summary: 'a summary',
      providerId: 'fake',
      modelId: 'fake-small',
      promptVersion: 'p1',
      at: 1_234,
    });
    // PRD 011 Req 33: #119's usage numbers have somewhere to land, and are
    // absent rather than zeroed when no producer supplied them.
    const withUsage = writeSummaryCacheEntry(
      emptySummaryCache(),
      { ...input('k2', 's'), usage: { promptTokens: 120, completionTokens: 30 } },
      1,
    );
    expect(readSummaryCacheEntry(parseSummaryCache(serializeSummaryCache(withUsage)), 'k2')?.usage).toEqual({
      promptTokens: 120,
      completionTokens: 30,
    });
  });

  it('U541: summaries written through one store instance are read back by a second one over the same bytes', async () => {
    const fs = createFakeFs();
    const clock = createFakeClock();
    const first = createFileSummaryCache(fs, { now: clock.now });
    await first.put(input('kept', 'the first summary'));
    await first.put(input('also', 'the second summary'));

    // The app restarts / the document is reopened: a brand new store over the
    // same backing file, sharing nothing with the instance that wrote it.
    const second = createFileSummaryCache(fs, { now: createFakeClock(99).now });
    expect((await second.get('kept'))?.summary).toBe('the first summary');
    expect((await second.get('also'))?.summary).toBe('the second summary');
    expect(await second.size()).toEqual({ bytes: expect.any(Number), entries: 2 });
  });

  it('U542: a get for a key nothing wrote is a miss, not an error', async () => {
    const fs = createFakeFs();
    const store = createFileSummaryCache(fs, { now: createFakeClock().now });
    // The very first get, before anything exists at all.
    expect(await store.get('never-written')).toBeNull();
    expect(await store.size()).toEqual({ bytes: summaryCacheBytes(emptySummaryCache()), entries: 0 });
    await store.put(input('present', 's'));
    expect(await store.get('absent')).toBeNull();
  });

  it('U543: a truncated, wrong-shaped or wrong-versioned file reads as an empty cache instead of throwing', async () => {
    expect(parseSummaryCache('{"version":1,"entries":[{"key":"k1","sum').entries).toEqual([]);
    expect(parseSummaryCache('null').entries).toEqual([]);
    expect(parseSummaryCache('{"version":7,"entries":[{"key":"k1","summary":"s"}]}').entries).toEqual([]);
    expect(parseSummaryCache('').entries).toEqual([]);
    // One damaged row does not take the good ones with it.
    const mixed = parseSummaryCache(
      '{"version":1,"entries":[{"key":"good","summary":"s","providerId":"p","modelId":"m","promptVersion":"p1","at":1},{"key":42}]}',
    );
    expect(mixed.entries.map((e) => e.key)).toEqual(['good']);

    const fs = createFakeFs();
    fs.files.set(`${CONFIG_DIR}/${SUMMARY_CACHE_FILE}`, '{"version":1,"entries":[{"key');
    const store = createFileSummaryCache(fs, { now: createFakeClock().now });
    expect(await store.get('k1')).toBeNull();
    // And the store is usable afterwards — corruption costs a re-summarize.
    await store.put(input('k1', 'fresh'));
    expect((await store.get('k1'))?.summary).toBe('fresh');
  });

  it('U544: editing one section strands only that section’s key; a section that merely moved still hits', async () => {
    const before = '# One\n\nalpha\n\n# Two\n\nbeta\n\n# Three\n\ngamma\n';
    // Two is edited; Three moved ahead of it and is otherwise untouched.
    const after = '# One\n\nalpha\n\n# Three\n\ngamma\n\n# Two\n\nbeta edited\n';
    const previous = flattenSections(parseSections(before));
    const current = flattenSections(parseSections(after));

    const fs = createFakeFs();
    const store = createFileSummaryCache(fs, { now: createFakeClock().now });
    for (const section of previous) {
      await store.put(input(summaryKeyForSection(section, CTX), `summary of ${section.title}`));
    }

    const reconciled = reconcileSummaryKeys(previous, current, CTX);
    const hit = async (title: string): Promise<boolean> => {
      const section = current.find((s) => s.title === title);
      return (await store.get(summaryKeyForSection(section!, CTX))) !== null;
    };
    expect(await hit('One')).toBe(true);
    // Moved elsewhere in the document, content unchanged: still a hit.
    expect(await hit('Three')).toBe(true);
    // Edited: a miss, and the only one the reconciliation asks to generate.
    expect(await hit('Two')).toBe(false);
    expect(reconciled.missing).toEqual([summaryKeyForSection(current.find((s) => s.title === 'Two')!, CTX)]);
    expect(reconciled.stale).toEqual([summaryKeyForSection(previous.find((s) => s.title === 'Two')!, CTX)]);
  });
});

describe('PRD 011 Req 29 — the desktop store is byte-capped, oldest-out, and lives under configDir()', () => {
  it('U545: over the cap, the least recently written entries go first and the newest one always stays', () => {
    // A cap that fits three of these entries but not four.
    const three = writeSummaryCacheEntry(
      writeSummaryCacheEntry(writeSummaryCacheEntry(emptySummaryCache(), input('a', 'A'.repeat(200)), 1), input('b', 'B'.repeat(200)), 2),
      input('c', 'C'.repeat(200)),
      3,
    );
    const cap = summaryCacheBytes(three);

    const four = writeSummaryCacheEntry(three, input('d', 'D'.repeat(200)), 4, cap);
    expect(four.entries.map((e) => e.key)).toEqual(['d', 'c', 'b']);
    // The entry just written survives while a strictly older one remains.
    expect(readSummaryCacheEntry(four, 'd')).not.toBeNull();
    expect(readSummaryCacheEntry(four, 'a')).toBeNull();

    // Least recently WRITTEN, not used: a get never reorders anything, and a
    // re-put refreshes the entry to the head.
    expect(readSummaryCacheEntry(four, 'b')).not.toBeNull();
    const refreshed = writeSummaryCacheEntry(four, input('b', 'B'.repeat(200)), 5, cap);
    expect(refreshed.entries.map((e) => e.key)).toEqual(['b', 'd', 'c']);
    expect(summaryCacheBytes(refreshed)).toBeLessThanOrEqual(cap);
  });

  it('U546: an entry bigger than the cap on its own is refused and leaves the store exactly as it was', async () => {
    const seeded = writeSummaryCacheEntry(emptySummaryCache(), input('small', 'ok'), 1);
    const cap = summaryCacheBytes(seeded) + 50;
    const after = writeSummaryCacheEntry(seeded, input('huge', 'X'.repeat(cap * 2)), 2, cap);
    expect(after).toBe(seeded);
    expect(readSummaryCacheEntry(after, 'small')).not.toBeNull();

    // And through the file store: a refusal rewrites nothing.
    const fs = createFakeFs();
    const store = createFileSummaryCache(fs, { now: createFakeClock().now, maxBytes: 400 });
    await store.put(input('fits', 'ok'));
    const written = fs.files.get(`${CONFIG_DIR}/${SUMMARY_CACHE_FILE}`);
    await store.put(input('huge', 'X'.repeat(5_000)));
    expect(fs.files.get(`${CONFIG_DIR}/${SUMMARY_CACHE_FILE}`)).toBe(written);
    expect(await store.get('huge')).toBeNull();
    expect(await store.get('fits')).not.toBeNull();
  });

  it('U547: every path the store touches is under the config directory it was handed, and the cap is in bytes', async () => {
    const fs = createFakeFs();
    const store = createFileSummaryCache(fs, { now: createFakeClock().now });
    await store.get('k1');
    await store.put(input('k1', 'a summary'));
    await store.size();
    await store.clear();

    expect(fs.touched.length).toBeGreaterThan(0);
    for (const path of fs.touched) {
      expect(path.startsWith(CONFIG_DIR), `${path} must be under the config directory`).toBe(true);
    }
    // Only ever the one file — never a path derived from a document.
    expect([...new Set(fs.touched)].sort()).toEqual([CONFIG_DIR, `${CONFIG_DIR}/${SUMMARY_CACHE_FILE}`]);
    // The cap is a byte count, not an entry count.
    expect(SUMMARY_CACHE_MAX_BYTES).toBe(4 * 1024 * 1024);
  });

  it('U548: a missing file, a cleared store and an empty file all read as an empty cache', async () => {
    const fs = createFakeFs();
    const clock = createFakeClock();
    const store = createFileSummaryCache(fs, { now: clock.now });
    expect(await store.size()).toEqual({ bytes: summaryCacheBytes(emptySummaryCache()), entries: 0 });

    await store.put(input('k1', 'one'));
    clock.tick();
    await store.put(input('k2', 'two'));
    expect((await store.size()).entries).toBe(2);

    await store.clear();
    expect(await store.get('k1')).toBeNull();
    expect((await store.size()).entries).toBe(0);
    // Clearing twice is not an error, and neither is an empty file.
    await store.clear();
    fs.files.set(`${CONFIG_DIR}/${SUMMARY_CACHE_FILE}`, '');
    expect((await store.size()).entries).toBe(0);
  });

  it('U549: entry stamps and eviction order come from the injected clock, never from ambient time', async () => {
    const fs = createFakeFs();
    const clock = createFakeClock(5_000);
    const store = createFileSummaryCache(fs, { now: clock.now });
    await store.put(input('first', 'one'));
    clock.tick(60_000);
    await store.put(input('second', 'two'));

    expect((await store.get('first'))?.at).toBe(5_000);
    expect((await store.get('second'))?.at).toBe(65_000);
    // Pinned, not merely plausible: the same sequence on any machine at any
    // moment produces exactly these numbers.
    const stamps = parseSummaryCache(fs.files.get(`${CONFIG_DIR}/${SUMMARY_CACHE_FILE}`)!).entries.map((e) => e.at);
    expect(stamps).toEqual([65_000, 5_000]);
  });
});
