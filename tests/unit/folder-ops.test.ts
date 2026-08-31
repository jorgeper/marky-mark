import { describe, expect, test } from 'vitest';
import {
  folderContextMenu,
  moveTarget,
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

describe('PRD 007 Req 18 sidebar drag-and-drop + Req 17 menu gating', () => {
  test('U841: a drop target is judged before any I/O — no self-nesting, no no-op, no clobber', () => {
    // The ordinary case: a file dragged into a sibling folder.
    expect(moveTarget('/w/1/files/a.md', '/w/1/files/notes', ['b.md'])).toEqual({
      ok: true,
      path: '/w/1/files/notes/a.md',
    });
    // A folder into its own descendant would detach the subtree — refused
    // with a reason the user sees.
    expect(moveTarget('/w/1/files/notes', '/w/1/files/notes/deep', [])).toEqual({
      ok: false,
      reason: 'A folder cannot be moved inside itself',
    });
    expect(moveTarget('/w/1/files/notes', '/w/1/files/notes', [])).toEqual({
      ok: false,
      reason: 'A folder cannot be moved inside itself',
    });
    // A drop back into the row's CURRENT parent is a no-op, not an error: a
    // null reason means "do nothing, say nothing".
    expect(moveTarget('/w/1/files/a.md', '/w/1/files', ['a.md'])).toEqual({ ok: false, reason: null });
    // A name already taken in the target never silently replaces it.
    const clash = moveTarget('/w/1/files/notes/a.md', '/w/1/files/archive', ['A.MD']);
    expect(clash.ok).toBe(false);
    expect(clash.ok === false && clash.reason).toMatch(/already exists/);
    // Separators survive: a Windows target keeps backslashes.
    expect(moveTarget('C:\\docs\\a.md', 'C:\\docs\\sub', [])).toEqual({ ok: true, path: 'C:\\docs\\sub\\a.md' });
    // A trailing separator on the target does not double up.
    expect(moveTarget('/root/a.md', '/root/sub/', [])).toEqual({ ok: true, path: '/root/sub/a.md' });
  });

  test('U842: the menu offers only what the platform CAN do and the user MAY do', () => {
    const seams = { isMac: false, canReveal: false, canTrash: true, canRename: true, canCopy: false };
    const ids = (kind: 'dir' | 'file' | 'root', opts: Partial<Parameters<typeof folderContextMenu>[1]> = {}) =>
      folderContextMenu(kind, { ...seams, ...opts })
        .filter((i): i is { id: string; label: string } => i !== 'sep')
        .map((i) => i.id);

    // Pre-#76 call sites are unchanged: creation on, transfer rows absent.
    expect(ids('dir')).toEqual(['new-file', 'new-folder', 'rename', 'delete']);
    expect(ids('file')).toEqual(['rename', 'delete']);
    expect(ids('root')).toEqual(['new-file', 'new-folder']);

    // PRD 007 Req 19: the transfer rows appear only with the verb.
    expect(ids('dir', { canUpload: true })).toContain('upload');
    expect(ids('file', { canDownload: true })).toContain('download');
    expect(ids('root', { canUpload: true })).toContain('upload');
    expect(ids('file', { canUpload: true })).not.toContain('upload'); // upload targets folders

    // PRD 007 Req 17: a Viewer — no create, no rename, no delete, no upload;
    // download is the only thing left, and the dir/root menus go empty.
    const viewer = { canTrash: false, canRename: false, canCreate: false, canDownload: true };
    expect(ids('file', viewer)).toEqual(['download']);
    expect(ids('dir', viewer)).toEqual([]);
    expect(ids('root', viewer)).toEqual([]);

    // Folder creation is gated separately (hosted: folder.manage), so a
    // Contributor keeps New File and loses New Folder.
    expect(ids('dir', { canCreate: true, canCreateFolder: false })).toEqual([
      'new-file',
      'rename',
      'delete',
    ]);
  });
});
