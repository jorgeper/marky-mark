import { describe, expect, test } from 'vitest';
import {
  folderContextMenu,
  relativePath,
  remapPath,
  uniqueChildName,
  validateEntryName,
} from '../../src/lib/folderOps';

describe('SPEC35 folder ops', () => {
  test('U63: name validation, unique child names, path remap, relative paths, menu model', () => {
    // --- validateEntryName: valid names --------------------------------------
    for (const ok of ['notes.md', 'New Folder', 'a', 'com0.md', 'con2.md', 'lpt10.txt', 'x'.repeat(255)]) {
      expect(validateEntryName(ok), ok).toBeNull();
    }
    // Rejection classes: empty/whitespace, separators, dots, leading dot,
    // trailing dot/space, length.
    for (const bad of ['', '   ', 'a/b', 'a\\b', '.', '..', '.hidden', 'name.', 'name ', 'x'.repeat(256)]) {
      expect(validateEntryName(bad), JSON.stringify(bad)).toBeTypeOf('string');
    }
    // Every Windows-reserved stem, bare + extension + case variants, judged
    // on the name before its FIRST dot.
    const reserved = ['aux', 'con', 'prn', 'nul'];
    for (let n = 1; n <= 9; n++) reserved.push(`com${n}`, `lpt${n}`);
    for (const stem of reserved) {
      for (const name of [stem, `${stem}.md`, stem.toUpperCase(), `${stem.toUpperCase()}.md`]) {
        expect(validateEntryName(name), name).toMatch(/reserved/i);
      }
    }
    expect(validateEntryName('Lpt3.backup.md')).toMatch(/reserved/i); // stem before the first dot
    expect(validateEntryName('backup.lpt3.md')).toBeNull(); // reserved only as the stem

    // --- uniqueChildName -----------------------------------------------------
    expect(uniqueChildName([], 'Untitled.md')).toBe('Untitled.md');
    expect(uniqueChildName(['a.md'], 'Untitled.md')).toBe('Untitled.md');
    expect(uniqueChildName(['Untitled.md'], 'Untitled.md')).toBe('Untitled 2.md'); // number before the extension
    expect(uniqueChildName(['Untitled.md', 'Untitled 2.md'], 'Untitled.md')).toBe('Untitled 3.md');
    expect(uniqueChildName(['untitled.md'], 'Untitled.md')).toBe('Untitled 2.md'); // case-insensitive collision
    expect(uniqueChildName(['New Folder'], 'New Folder')).toBe('New Folder 2');
    expect(uniqueChildName(['new folder', 'NEW FOLDER 2'], 'New Folder')).toBe('New Folder 3');

    // --- remapPath -----------------------------------------------------------
    expect(remapPath('/a/b', '/a/b', '/a/x')).toBe('/a/x'); // exact entry
    expect(remapPath('/a/b/c.md', '/a/b', '/a/x')).toBe('/a/x/c.md'); // descendant
    expect(remapPath('/other/c.md', '/a/b', '/a/x')).toBeNull(); // unaffected
    expect(remapPath('/a/bc', '/a/b', '/a/x')).toBeNull(); // separator boundary
    expect(remapPath('C:\\n\\sub\\f.md', 'C:\\n\\sub', 'C:\\n\\stuff')).toBe('C:\\n\\stuff\\f.md');

    // --- relativePath --------------------------------------------------------
    expect(relativePath('/notes', '/notes/sub/b.md')).toBe('sub/b.md');
    expect(relativePath('/notes', '/notes')).toBe('.'); // the root itself
    expect(relativePath('/notes/', '/notes')).toBe('.');
    expect(relativePath('C:\\notes', 'C:\\notes\\a.md')).toBe('a.md'); // Windows separators preserved
    expect(relativePath('C:\\notes', 'C:\\notes\\sub\\a.md')).toBe('sub\\a.md');

    // --- folderContextMenu: exact item sets and order ------------------------
    const all = { isMac: true, canReveal: true, canTrash: true, canRename: true, canCopy: true };
    expect(folderContextMenu('dir', all)).toEqual([
      { id: 'new-file', label: 'New File' },
      { id: 'new-folder', label: 'New Folder' },
      'sep',
      { id: 'rename', label: 'Rename' },
      { id: 'delete', label: 'Delete' },
      'sep',
      { id: 'reveal', label: 'Reveal in Finder' },
      'sep',
      { id: 'copy-path', label: 'Copy Path' },
      { id: 'copy-relative-path', label: 'Copy Relative Path' },
    ]);
    expect(folderContextMenu('file', all)).toEqual([
      { id: 'reveal', label: 'Reveal in Finder' },
      'sep',
      { id: 'rename', label: 'Rename' },
      { id: 'delete', label: 'Delete' },
      'sep',
      { id: 'copy-path', label: 'Copy Path' },
      { id: 'copy-relative-path', label: 'Copy Relative Path' },
    ]);
    expect(folderContextMenu('root', all)).toEqual([
      { id: 'new-file', label: 'New File' },
      { id: 'new-folder', label: 'New Folder' },
      'sep',
      { id: 'reveal', label: 'Reveal in Finder' },
      'sep',
      { id: 'copy-path', label: 'Copy Path' },
    ]);
    // Windows reveal label.
    expect(folderContextMenu('file', { ...all, isMac: false })[0]).toEqual({
      id: 'reveal',
      label: 'Reveal in File Explorer',
    });
    // Capability omission collapses flanking separators.
    expect(folderContextMenu('dir', { ...all, canReveal: false })).toEqual([
      { id: 'new-file', label: 'New File' },
      { id: 'new-folder', label: 'New Folder' },
      'sep',
      { id: 'rename', label: 'Rename' },
      { id: 'delete', label: 'Delete' },
      'sep',
      { id: 'copy-path', label: 'Copy Path' },
      { id: 'copy-relative-path', label: 'Copy Relative Path' },
    ]);
    expect(folderContextMenu('root', { ...all, canCopy: false })).toEqual([
      { id: 'new-file', label: 'New File' },
      { id: 'new-folder', label: 'New Folder' },
      'sep',
      { id: 'reveal', label: 'Reveal in Finder' },
    ]);
    expect(folderContextMenu('file', { ...all, canRename: false, canTrash: false })).toEqual([
      { id: 'reveal', label: 'Reveal in Finder' },
      'sep',
      { id: 'copy-path', label: 'Copy Path' },
      { id: 'copy-relative-path', label: 'Copy Relative Path' },
    ]);
    expect(folderContextMenu('file', { isMac: true, canReveal: false, canTrash: false, canRename: false, canCopy: false })).toEqual(
      []
    );
  });
});
