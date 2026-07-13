import { describe, expect, test } from 'vitest';
import {
  ancestorsOf,
  compareEntries,
  EXPANDED_CAP,
  isMarkdownFile,
  parseFolderState,
  serializeFolderState,
  visibleEntries,
} from '../../src/lib/folderTree';

const dirname = (p: string) => p.split('/').slice(0, -1).join('/') || '/';

describe('SPEC34 folder tree', () => {
  test('U60: markdown detection, folder-first sort, dotfile filtering, reveal ancestry, state round-trip', () => {
    // Markdown detection is extension-based, case-insensitive.
    expect(isMarkdownFile('notes.md')).toBe(true);
    expect(isMarkdownFile('README.MARKDOWN')).toBe(true);
    expect(isMarkdownFile('notes.md.bak')).toBe(false);
    expect(isMarkdownFile('image.png')).toBe(false);

    // Folders first, then case-insensitive alpha; dotfiles/dot-dirs hidden.
    const listed = visibleEntries([
      { name: 'zeta.md', isDir: false },
      { name: '.git', isDir: true },
      { name: 'Alpha', isDir: true },
      { name: '.DS_Store', isDir: false },
      { name: 'beta', isDir: true },
      { name: 'apple.md', isDir: false },
    ]);
    expect(listed.map((e) => e.name)).toEqual(['Alpha', 'beta', 'apple.md', 'zeta.md']);
    expect(compareEntries({ name: 'b', isDir: true }, { name: 'a', isDir: false })).toBeLessThan(0);

    // Reveal ancestry: outermost-first chain including the root itself.
    expect(ancestorsOf('/notes', '/notes/deep/nested/file.md', dirname)).toEqual([
      '/notes',
      '/notes/deep',
      '/notes/deep/nested',
    ]);
    expect(ancestorsOf('/notes', '/notes/top.md', dirname)).toEqual(['/notes']);
    // Outside the root (including sneaky prefixes) ⇒ empty, caller retargets.
    expect(ancestorsOf('/notes', '/elsewhere/file.md', dirname)).toEqual([]);
    expect(ancestorsOf('/notes', '/notes-other/file.md', dirname)).toEqual([]);

    // State round-trip; corruption and shape violations tolerated; cap holds.
    const state = { version: 1 as const, root: '/notes', expanded: ['/notes', '/notes/deep'] };
    expect(parseFolderState(serializeFolderState(state))).toEqual(state);
    expect(parseFolderState('not json')).toEqual({ version: 1, root: null, expanded: [] });
    expect(parseFolderState('{"root":7,"expanded":"x"}')).toEqual({ version: 1, root: null, expanded: [] });
    const over = { version: 1 as const, root: '/r', expanded: Array.from({ length: 300 }, (_, i) => `/r/d${i}`) };
    expect(parseFolderState(serializeFolderState(over)).expanded.length).toBe(EXPANDED_CAP);
  });
});
