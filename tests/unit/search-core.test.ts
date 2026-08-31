import { describe, expect, test } from 'vitest';
import { SearchQuery } from '@codemirror/search';
import { Text } from '@codemirror/state';
import {
  compileQuery,
  findMatches,
  findMatchRanges,
  groupResults,
  literalReplacement,
  searchFile,
  searchFiles,
  type CompiledPattern,
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
    // Terminates, reports the real 'a' run, and each empty hit sits one
    // position further on — the exact sequence, so a regression in the
    // advance shows up as a diff rather than as a hang.
    expect(findMatches('ab', matcher('a*', { regex: true }))).toEqual([
      { line: 1, lineText: 'ab', start: 0, end: 1 },
      { line: 1, lineText: 'ab', start: 1, end: 1 },
      { line: 1, lineText: 'ab', start: 2, end: 2 },
    ]);
  });

  test('U690: \\r\\n and \\n line endings produce the same line numbers and text', () => {
    const unix = 'one\ntwo cat\nthree';
    const windows = 'one\r\ntwo cat\r\nthree';
    const expected = [{ line: 2, lineText: 'two cat', start: 4, end: 7 }];
    expect(findMatches(unix, matcher('cat'))).toEqual(expected);
    expect(findMatches(windows, matcher('cat'))).toEqual(expected);
  });

  test('U695: matching is per line — anchors bind to the line, and no pattern spans a break', () => {
    const text = 'one\ntwo one';
    // `^` and `$` bind to each line, not to the file: `one$` hits both lines.
    expect(findMatches(text, matcher('one$', { regex: true })).map((h) => h.line)).toEqual([1, 2]);
    expect(findMatches(text, matcher('^one', { regex: true })).map((h) => h.line)).toEqual([1]);
    // The terminator is not part of any line, so nothing can match across one.
    expect(findMatches(text, matcher('one\\ntwo', { regex: true }))).toEqual([]);
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

/** One hit as CodeMirror's search cursor reports it (it carries more; these are the fields under test). */
interface CmMatch {
  from: number;
  to: number;
}

/**
 * The edit engine's query, built exactly as `Editor.tsx` builds it from a
 * compiled pattern: regexp mode over the compiled source, CM's own whole-word
 * and escaping deliberately unused. This is the oracle the parity tests below
 * measure `searchCore` against, so it must not drift from that call site.
 */
const cmQuery = (pattern: CompiledPattern, replace?: string): SearchQuery =>
  new SearchQuery({ search: pattern.source, regexp: true, caseSensitive: pattern.caseSensitive, literal: true, replace });

/** Every match CM's own cursor finds in `doc`, in order. */
const cmMatches = (query: SearchQuery, doc: string): CmMatch[] => {
  const cursor = query.getCursor(Text.of(doc.split('\n'))) as Iterator<CmMatch>;
  const out: CmMatch[] = [];
  for (let r = cursor.next(); !r.done; r = cursor.next()) out.push(r.value);
  return out;
};

describe('PRD 014 Req 10 (issue #154) — the compiled pattern and find-bar/Search-view parity', () => {
  /** Compile expecting success — the whole matcher arm, pattern included. */
  const compiled = (query: string, over: Partial<SearchOptions> = {}) => {
    const c = compileQuery(query, opts(over));
    if (c.kind !== 'matcher') throw new Error(`expected matcher, got ${c.kind}`);
    return c;
  };

  test('U923: the matcher arm carries the pattern the engines share — source and case decision', () => {
    // Literal mode: metacharacters escaped, case-insensitive by default.
    expect(compiled('a.b').pattern).toEqual({ source: 'a\\.b', caseSensitive: false });
    expect(compiled('cat', { caseSensitive: true }).pattern.caseSensitive).toBe(true);
    // Whole-word wraps, regex passes through grouped — exactly what matched.
    expect(compiled('cat', { wholeWord: true }).pattern.source).toBe('\\b(?:cat)\\b');
    expect(compiled('c.t', { regex: true }).pattern.source).toBe('(?:c.t)');
    expect(compiled('c.t', { regex: true, wholeWord: true }).pattern.source).toBe('\\b(?:(?:c.t))\\b');
    // The empty query's pattern is the empty source — "no query" downstream.
    expect(compiled('').pattern.source).toBe('');
    // The pattern IS what the matcher runs: rebuilt, it finds the same hits.
    const { matcher: m, pattern } = compiled('cat', { wholeWord: true });
    const re = new RegExp(pattern.source, pattern.caseSensitive ? 'g' : 'gi');
    expect([...'Cat concatenate cat'.matchAll(re)].map((h) => h.index)).toEqual(
      m.findAll('Cat concatenate cat').map((h) => h.start)
    );
  });

  test('U924: CodeMirror driven by the pattern agrees with compileQuery over the option table', () => {
    // This pins that the two modes return the same ranges for every option
    // combination. Patterns with class escapes like \s are excluded: CM's
    // multiline cursor lets those span line breaks where searchCore is
    // line-scoped by contract (U695).
    const doc = 'Cat sat\nconcatenate cat\ncut Cot CAT\ncafé au lait';
    const table: Array<[string, Partial<SearchOptions>]> = [
      ['cat', {}],
      ['cat', { caseSensitive: true }],
      ['cat', { wholeWord: true }],
      ['cat', { caseSensitive: true, wholeWord: true }],
      ['c.t', { regex: true }],
      ['c.t', { regex: true, caseSensitive: true }],
      ['c.t', { regex: true, wholeWord: true }],
      ['c[au]t', { regex: true, caseSensitive: true, wholeWord: true }],
      // The unicode word-boundary corner: \b is searchCore's rule, and the
      // edit engine runs the same \b — NOT CM's own categorizer-based rule.
      ['café', { wholeWord: true }],
      ['a.b', {}], // literal-mode escaping reaches CM escaped too
    ];
    for (const [query, over] of table) {
      const { matcher: m, pattern } = compiled(query, over);
      const ours = findMatchRanges(doc, m).map((r) => [r.start, r.end]);
      const cms = cmMatches(cmQuery(pattern), doc).map((r) => [r.from, r.to]);
      expect(cms, `query=${JSON.stringify(query)} options=${JSON.stringify(over)}`).toEqual(ours);
    }
  });

  test('U925: findMatchRanges maps the line-scoped scan to absolute offsets across every terminator', () => {
    const text = 'cat\r\nno hit\rcat cat\nx^cat';
    const m = matcher('cat');
    expect(findMatchRanges(text, m)).toEqual([
      { start: 0, end: 3 },
      { start: 12, end: 15 },
      { start: 16, end: 19 },
      { start: 22, end: 25 },
    ]);
    // Same hits, same order as findMatches — only the offset space differs.
    expect(findMatchRanges(text, m).length).toBe(findMatches(text, m).length);
    // Line-scoped like findMatches: nothing spans a terminator.
    expect(findMatchRanges('one\ntwo', matcher('one\\ntwo', { regex: true }))).toEqual([]);
    expect(findMatchRanges('', m)).toEqual([]);
  });

  test('U926: literalReplacement neutralizes every $ so a regex-mode engine replaces byte-literally', () => {
    expect(literalReplacement('plain')).toBe('plain');
    expect(literalReplacement('$& $1 $$ $')).toBe('$$& $$1 $$$$ $$');
    // Proof against the real engine: CM's regex replace of the neutralized
    // text yields exactly what the user typed.
    const q = cmQuery(compiled('cat').pattern, literalReplacement('$& costs $1'));
    const first = cmMatches(q, 'a cat')[0];
    if (!first) throw new Error('expected a match');
    // `create()` is CM's internal query object — the only route to its
    // replacement expansion without mounting an editor.
    const created = (q as unknown as { create(): { getReplacement(m: CmMatch): string } }).create();
    expect(created.getReplacement(first)).toBe('$& costs $1');
  });
});
