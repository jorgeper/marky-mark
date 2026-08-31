import { describe, expect, test } from 'vitest';
import type { DirEntry } from '../../src/lib/folderTree';
import { compileQuery, type SearchMatcher } from '../../src/lib/searchCore';
import {
  collectMarkdownFiles,
  loadSearchFiles,
  matchDocOffsets,
  runSearchScan,
  type ScanSeams,
} from '../../src/lib/searchScan';

/**
 * PRD 014 Reqs 4/5/8 (issue #151): the Search view's scan plumbing — scope
 * enumeration over injected seams, in-memory overrides for open buffers, and
 * the line-relative → absolute offset mapping the edit pane's highlight uses.
 * Req 9 (issue #153): the chunked, supersession-aware scan run on top of it.
 */

/** A fake fs: dir → entries. Reads outside it throw, like a real seam. */
const seamsFor = (tree: Record<string, DirEntry[]>, reads: string[] = []): ScanSeams => ({
  readDirEntries: (dir) => {
    const entries = tree[dir];
    return entries ? Promise.resolve(entries) : Promise.reject(new Error(`unreadable: ${dir}`));
  },
  readTextFile: (path) => {
    reads.push(path);
    return Promise.resolve(`text of ${path}`);
  },
  join: (...parts) => parts.join('/'),
});

const f = (name: string): DirEntry => ({ name, isDir: false });
const d = (name: string): DirEntry => ({ name, isDir: true });

describe('PRD 014 Req 4: collectMarkdownFiles — the folder tree scope', () => {
  test('U918: every root recursively, dotfiles and dot-directories excluded, non-markdown never listed', async () => {
    const seams = seamsFor({
      '/notes': [f('a.md'), f('pic.png'), f('zzz.txt'), f('.hidden.md'), d('.git'), d('sub')],
      '/notes/sub': [f('b.markdown'), d('deep')],
      '/notes/sub/deep': [f('c.md')],
      '/other': [f('d.md')],
    });
    const files = await collectMarkdownFiles(['/notes', '/other'], seams);
    expect(files).toEqual([
      { path: '/notes/sub/deep/c.md', name: 'c.md' },
      { path: '/notes/sub/b.markdown', name: 'b.markdown' },
      { path: '/notes/a.md', name: 'a.md' },
      { path: '/other/d.md', name: 'd.md' },
    ]);
  });

  test('U919: an unreadable directory is skipped, the rest of the scan survives', async () => {
    const seams = seamsFor({
      // '/notes/broken' is missing from the fake fs — its listing rejects.
      '/notes': [d('broken'), f('a.md')],
    });
    await expect(collectMarkdownFiles(['/notes'], seams)).resolves.toEqual([
      { path: '/notes/a.md', name: 'a.md' },
    ]);
    // A wholly unreadable root is the same story: skipped, not thrown.
    await expect(collectMarkdownFiles(['/gone'], seams)).resolves.toEqual([]);
  });
});

describe('PRD 014 Req 5: loadSearchFiles — in-memory buffers over stale disk text', () => {
  test('U920: an override supplies the text and the disk is not read for it', async () => {
    const reads: string[] = [];
    const seams = seamsFor({}, reads);
    const files = await loadSearchFiles(
      [
        { path: '/notes/a.md', name: 'a.md' },
        { path: '/notes/b.md', name: 'b.md' },
      ],
      new Map([['/notes/a.md', 'unsaved buffer text']]),
      seams.readTextFile
    );
    expect(files).toEqual([
      { path: '/notes/a.md', name: 'a.md', text: 'unsaved buffer text' },
      { path: '/notes/b.md', name: 'b.md', text: 'text of /notes/b.md' },
    ]);
    expect(reads).toEqual(['/notes/b.md']); // the dirty buffer's disk copy stayed unread
  });

  test('U699: an unreadable file is skipped rather than failing the scan', async () => {
    const readTextFile = (path: string) =>
      path === '/notes/bad.md' ? Promise.reject(new Error('io')) : Promise.resolve('ok');
    await expect(
      loadSearchFiles(
        [
          { path: '/notes/bad.md', name: 'bad.md' },
          { path: '/notes/good.md', name: 'good.md' },
        ],
        new Map(),
        readTextFile
      )
    ).resolves.toEqual([{ path: '/notes/good.md', name: 'good.md', text: 'ok' }]);
  });
});

/** The all-off literal matcher the runner tests scan with. */
const matcherFor = (query: string): SearchMatcher => {
  const compiled = compileQuery(query, { caseSensitive: false, wholeWord: false, regex: false });
  if (compiled.kind !== 'matcher') throw new Error('test query must compile');
  return compiled.matcher;
};

describe('PRD 014 Req 9 (issue #153): runSearchScan — chunked, supersession-aware scan run', () => {
  test('U706: a completed run yields between chunks and returns the grouped results — overrides honored, disk unread for them', async () => {
    const reads: string[] = [];
    const seams = seamsFor({ '/r': [f('a.md'), f('b.md'), f('c.md')] }, reads);
    let yields = 0;
    const results = await runSearchScan(
      ['/r'],
      seams,
      new Map([['/r/b.md', 'cherry here\ncherry again']]),
      matcherFor('cherry'),
      {
        chunkSize: 2,
        yieldNow: () => {
          yields++;
          return Promise.resolve();
        },
      }
    );
    // b.md's two hits from the OVERRIDE text (its disk copy never read); a.md
    // and c.md read, matched nothing, dropped — same grouping as searchFiles.
    expect(results).toEqual({
      files: [
        {
          path: '/r/b.md',
          name: 'b.md',
          nameMatch: false,
          matches: [
            { line: 1, lineText: 'cherry here', start: 0, end: 6 },
            { line: 2, lineText: 'cherry again', start: 0, end: 6 },
          ],
          matchCount: 2,
        },
      ],
      fileCount: 1,
      matchCount: 2,
    });
    expect(reads).toEqual(['/r/a.md', '/r/c.md']);
    expect(yields).toBeGreaterThan(0); // 4 seam ops at chunkSize 2 crossed a boundary
  });

  test('U707: superseded at a chunk boundary mid-load — the run resolves null and issues NO further readTextFile', async () => {
    const reads: string[] = [];
    let current = true;
    let yields = 0;
    const seams = seamsFor({ '/r': [f('a.md'), f('b.md'), f('c.md'), f('d.md'), f('e.md')] }, reads);
    const results = await runSearchScan(['/r'], seams, new Map(), matcherFor('text'), {
      chunkSize: 2,
      isCurrent: () => current,
      yieldNow: () => {
        // The SECOND yield is where the newer query lands (ops: dir, a | b, c | d…).
        if (++yields === 2) current = false;
        return Promise.resolve();
      },
    });
    expect(results).toBeNull();
    expect(reads).toEqual(['/r/a.md', '/r/b.md', '/r/c.md']); // d.md and e.md never read
  });

  test('U708: superseded while still enumerating — no further readDirEntries either', async () => {
    const dirReads: string[] = [];
    let current = true;
    let yields = 0;
    const tree: Record<string, DirEntry[]> = {
      '/r': [d('s1'), d('s2'), d('s3'), d('s4'), d('s5')],
      '/r/s1': [f('a.md')],
      '/r/s2': [f('b.md')],
      '/r/s3': [f('c.md')],
      '/r/s4': [f('d.md')],
      '/r/s5': [f('e.md')],
    };
    const base = seamsFor(tree);
    const seams: ScanSeams = {
      ...base,
      readDirEntries: (dir) => {
        dirReads.push(dir);
        return base.readDirEntries(dir);
      },
    };
    const results = await runSearchScan(['/r'], seams, new Map(), matcherFor('text'), {
      chunkSize: 2,
      isCurrent: () => current,
      yieldNow: () => {
        if (++yields === 2) current = false;
        return Promise.resolve();
      },
    });
    expect(results).toBeNull();
    // Dir reads stop at the boundary the supersession was seen on: /r, s1 |
    // s2, s3 | (yield #2 flips) — s4 and s5 are never listed.
    expect(dirReads).toEqual(['/r', '/r/s1', '/r/s2', '/r/s3']);
  });

  test('U709: superseded at the finish line still discards — and error paths settle to a result, never a stuck run', async () => {
    // No chunk boundary is crossed (huge chunk), so the only check is the
    // final one — the run read everything and must STILL hand back null.
    const seams = seamsFor({ '/r': [f('a.md')] });
    await expect(
      runSearchScan(['/r'], seams, new Map(), matcherFor('text'), {
        chunkSize: 1000,
        isCurrent: () => false,
        yieldNow: () => Promise.resolve(),
      })
    ).resolves.toBeNull();
    // An unreadable directory and an unreadable file both SETTLE (a result,
    // not a hang or a throw) so the caller's indicator always clears.
    const broken = seamsFor({ '/r': [d('gone'), f('a.md'), f('bad.md')] });
    const flaky: ScanSeams = {
      ...broken,
      readTextFile: (path) =>
        path === '/r/bad.md' ? Promise.reject(new Error('io')) : Promise.resolve('text here'),
    };
    const results = await runSearchScan(['/r'], flaky, new Map(), matcherFor('text'), {
      yieldNow: () => Promise.resolve(),
    });
    expect(results?.fileCount).toBe(1);
    expect(results?.matchCount).toBe(1);
    // A wholly empty scope settles to the zero result — the no-results state.
    const empty = await runSearchScan(['/gone'], seamsFor({}), new Map(), matcherFor('x'), {
      yieldNow: () => Promise.resolve(),
    });
    expect(empty).toEqual({ files: [], fileCount: 0, matchCount: 0 });
  });
});

describe('PRD 014 Req 8: matchDocOffsets — line-relative match → absolute offsets', () => {
  test('U700: counts every terminator style as one break, exactly as findMatches split', () => {
    const text = 'first\r\nsecond\rthird\nfourth target here';
    expect(matchDocOffsets(text, { line: 1, lineText: 'first', start: 0, end: 5 })).toEqual({ from: 0, to: 5 });
    expect(matchDocOffsets(text, { line: 4, lineText: 'fourth target here', start: 7, end: 13 })).toEqual({
      from: text.indexOf('target'),
      to: text.indexOf('target') + 6,
    });
  });

  test('U701: null when the text no longer has the line or the offsets overrun it', () => {
    expect(matchDocOffsets('one line', { line: 3, lineText: 'x', start: 0, end: 1 })).toBeNull();
    expect(matchDocOffsets('ab', { line: 1, lineText: 'abcdef', start: 2, end: 6 })).toBeNull();
  });
});
