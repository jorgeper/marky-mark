import { describe, expect, test } from 'vitest';
import {
  compileQuery,
  findMatches,
  groupResults,
  searchFile,
  searchFiles,
  type SearchFile,
  type SearchMatcher,
  type SearchOptions,
} from '../../src/lib/searchCore';

/**
 * PRD 014 Req 12: the search core, tested straight — plain data in, plain
 * data out, no component and no DOM. These are the shared semantics both the
 * Search view (#151–#153) and the in-file find bar (#154) will render, so a
 * behaviour pinned here cannot drift apart between the two surfaces.
 */

const opts = (over: Partial<SearchOptions> = {}): SearchOptions => ({
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  ...over,
});

/** Compile expecting success — the matcher branch of the discriminated result. */
const matcher = (query: string, over: Partial<SearchOptions> = {}): SearchMatcher => {
  const compiled = compileQuery(query, opts(over));
  if (compiled.kind !== 'matcher') throw new Error(`expected matcher, got ${compiled.kind}`);
  return compiled.matcher;
};

describe('PRD 014 Req 6 — query compilation from the option state', () => {
  test('U678: default is a case-insensitive literal substring match', () => {
    const m = matcher('cat');
    expect(m.findAll('Cat catalogue CAT')).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 14, end: 17 },
    ]);
    expect(m.test('conCATenate')).toBe(true);
    expect(m.test('dog')).toBe(false);
  });

  test('U679: a literal query escapes regex metacharacters', () => {
    const m = matcher('a.b');
    expect(m.findAll('a.b axb')).toEqual([{ start: 0, end: 3 }]);
    expect(m.test('axb')).toBe(false);
    // The full metacharacter set survives literal matching untouched.
    const meta = 'x*+?^${}()|[]\\';
    expect(matcher(meta).findAll(`. ${meta} .`)).toEqual([{ start: 2, end: 2 + meta.length }]);
  });

  test('U680: case-sensitive matches the exact case only', () => {
    const m = matcher('Cat', { caseSensitive: true });
    expect(m.findAll('Cat cat CAT')).toEqual([{ start: 0, end: 3 }]);
  });

  test('U681: whole-word uses word boundaries, not substring containment', () => {
    const m = matcher('cat', { wholeWord: true });
    expect(m.test('concatenate')).toBe(false);
    expect(m.test('the cat sat')).toBe(true);
    expect(m.findAll('cat scat cat.')).toEqual([
      { start: 0, end: 3 },
      { start: 9, end: 12 },
    ]);
  });

  test('U682: regex mode compiles the pattern instead of matching it literally', () => {
    const m = matcher('c.t', { regex: true });
    expect(m.findAll('cat cot c.t czzt')).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
  });

  test('U683: case-sensitive regex combines both options', () => {
    const insensitive = matcher('ca+t', { regex: true });
    expect(insensitive.test('CAAT')).toBe(true);
    const m = matcher('Ca+t', { regex: true, caseSensitive: true });
    expect(m.findAll('Caaat caat Cat')).toEqual([
      { start: 0, end: 5 },
      { start: 11, end: 14 },
    ]);
  });

  test('U684: whole-word regex bounds the whole pattern, alternation included', () => {
    const m = matcher('cat|dog', { regex: true, wholeWord: true });
    expect(m.test('concatenate dogma')).toBe(false);
    expect(m.findAll('cat and dog')).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  test('U685: an invalid regex returns the structured error — no throw, no literal fallback', () => {
    const compiled = compileQuery('foo(', opts({ regex: true }));
    expect(compiled.kind).toBe('invalid-regex');
    if (compiled.kind === 'invalid-regex') {
      // A message the UI can render inline on the query box.
      expect(compiled.message.length).toBeGreaterThan(0);
    }
    // Never silently a literal: 'foo(' occurs verbatim here, yet nothing matches
    // because there is no matcher at all to run.
    expect(compiled.kind === 'matcher').toBe(false);
    // The other two toggles do not rescue an invalid pattern either.
    expect(compileQuery('a[', opts({ regex: true, caseSensitive: true, wholeWord: true })).kind).toBe(
      'invalid-regex'
    );
  });

  test('U686: an empty query compiles to a matcher that finds nothing', () => {
    for (const over of [{}, { regex: true }, { wholeWord: true }] as Partial<SearchOptions>[]) {
      const m = matcher('', over);
      expect(m.findAll('anything at all')).toEqual([]);
      expect(m.test('anything at all')).toBe(false);
    }
  });
});

describe('PRD 014 Req 7 — per-file match extraction with line context', () => {
  test('U687: each match carries its 1-based line, the line text, and in-line offsets', () => {
    const text = 'first line\nthe cat here\nlast line with cat';
    expect(findMatches(text, matcher('cat'))).toEqual([
      { line: 2, lineText: 'the cat here', start: 4, end: 7 },
      { line: 3, lineText: 'last line with cat', start: 15, end: 18 },
    ]);
  });

  test('U688: multiple matches on one line are all returned, in order', () => {
    expect(findMatches('cat catalog cat', matcher('cat'))).toEqual([
      { line: 1, lineText: 'cat catalog cat', start: 0, end: 3 },
      { line: 1, lineText: 'cat catalog cat', start: 4, end: 7 },
      { line: 1, lineText: 'cat catalog cat', start: 12, end: 15 },
    ]);
  });

  test('U689: zero-length regex matches advance instead of looping forever', () => {
    const hits = findMatches('ab', matcher('a*', { regex: true }));
    // Terminates, and still reports the real 'a' run alongside the empty hits.
    expect(hits).toContainEqual({ line: 1, lineText: 'ab', start: 0, end: 1 });
    expect(hits.length).toBeLessThanOrEqual(3);
    for (const h of hits) expect(h.end).toBeGreaterThanOrEqual(h.start);
  });

  test('U690: \\r\\n and \\n line endings produce the same line numbers and text', () => {
    const unix = 'one\ntwo cat\nthree';
    const windows = 'one\r\ntwo cat\r\nthree';
    const expected = [{ line: 2, lineText: 'two cat', start: 4, end: 7 }];
    expect(findMatches(unix, matcher('cat'))).toEqual(expected);
    expect(findMatches(windows, matcher('cat'))).toEqual(expected);
  });
});

describe('PRD 014 Req 7 — result grouping and ordering', () => {
  const files: SearchFile[] = [
    { path: '/notes/alpha.md', name: 'alpha.md', text: 'a cat\nno hit here' },
    { path: '/notes/cat-care.md', name: 'cat-care.md', text: 'nothing relevant' },
    { path: '/notes/beta.md', name: 'beta.md', text: 'cat cat' },
    { path: '/notes/empty.md', name: 'empty.md', text: 'dogs only' },
  ];

  test('U691: filename matches order before content matches, with per-file counts and totals', () => {
    const results = searchFiles(files, matcher('cat'));
    // 'cat-care.md' leads on its name despite sitting mid-list; hitless 'empty.md' is dropped.
    expect(results.files.map((f) => f.path)).toEqual([
      '/notes/cat-care.md',
      '/notes/alpha.md',
      '/notes/beta.md',
    ]);
    expect(results.files.map((f) => [f.nameMatch, f.matchCount])).toEqual([
      [true, 0],
      [false, 1],
      [false, 2],
    ]);
    expect(results.fileCount).toBe(3);
    expect(results.matchCount).toBe(3);
    // The group keeps the matches themselves for the result rows.
    expect(results.files[2].matches.map((m) => m.start)).toEqual([0, 4]);
  });

  test('U692: a zero-match query returns empty groups and zero totals', () => {
    const results = searchFiles(files, matcher('zebra'));
    expect(results).toEqual({ files: [], fileCount: 0, matchCount: 0 });
  });

  test('U693: the empty file list returns empty groups and zero totals', () => {
    expect(searchFiles([], matcher('cat'))).toEqual({ files: [], fileCount: 0, matchCount: 0 });
    expect(groupResults([])).toEqual({ files: [], fileCount: 0, matchCount: 0 });
  });

  test('U694: group order is deterministic — each bucket keeps the caller\'s file order', () => {
    const m = matcher('cat');
    const perFile = files.map((f) => searchFile(f, m));
    const once = groupResults(perFile);
    const twice = groupResults(perFile);
    expect(twice.files.map((f) => f.path)).toEqual(once.files.map((f) => f.path));
    // Content bucket preserves input order: alpha.md (index 0) before beta.md (index 2).
    expect(once.files.filter((f) => !f.nameMatch).map((f) => f.name)).toEqual([
      'alpha.md',
      'beta.md',
    ]);
  });
});
