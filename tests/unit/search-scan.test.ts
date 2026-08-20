import { describe, expect, test } from 'vitest';
import type { DirEntry } from '../../src/lib/folderTree';
import { collectMarkdownFiles, loadSearchFiles, matchDocOffsets, type ScanSeams } from '../../src/lib/searchScan';

/**
 * PRD 014 Reqs 4/5/8 (issue #151): the Search view's scan plumbing — scope
 * enumeration over injected seams, in-memory overrides for open buffers, and
 * the line-relative → absolute offset mapping the edit pane's highlight uses.
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
  test('U696: every root recursively, dotfiles and dot-directories excluded, non-markdown never listed', async () => {
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

  test('U697: an unreadable directory is skipped, the rest of the scan survives', async () => {
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
  test('U698: an override supplies the text and the disk is not read for it', async () => {
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
