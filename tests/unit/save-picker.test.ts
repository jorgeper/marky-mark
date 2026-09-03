import { describe, expect, test } from 'vitest';
import {
  canOfferNewFile,
  checkPickerName,
  defaultFolder,
  defaultName,
  pickerFolders,
  scratchSaveName,
  withDefaultExtension,
} from '../../src/lib/savePicker';

const dir = (name: string) => ({ name, isDir: true });
const file = (name: string) => ({ name, isDir: false });

describe('PRD 009 Req 13/14 save picker', () => {
  test('U330: the folder list is the workspace tree and nothing outside it', () => {
    const children = {
      '/ws': [dir('notes'), file('a.md'), dir('archive')],
      '/ws/notes': [dir('2026'), file('b.md')],
      '/ws/notes/2026': [file('c.md')],
      // A listing the sidebar happens to hold for something outside the
      // roots: it must never become a selectable folder.
      '/elsewhere': [dir('secret')],
    };
    const folders = pickerFolders({ roots: ['/ws'], children });
    expect(folders.map((f) => f.path)).toEqual(['/ws', '/ws/archive', '/ws/notes', '/ws/notes/2026']);
    // Root first, then its descendants sorted; labels read from the root down.
    expect(folders.map((f) => f.label)).toEqual(['ws', 'ws/archive', 'ws/notes', 'ws/notes/2026']);
    expect(folders.some((f) => f.path.includes('elsewhere') || f.path.includes('secret'))).toBe(false);

    // Files are not folders, and an unlisted subtree simply contributes nothing.
    expect(pickerFolders({ roots: ['/ws'], children: { '/ws': [file('a.md')] } }).map((f) => f.path)).toEqual(['/ws']);

    // Several roots keep their sidebar order, each with its own subtree.
    const two = pickerFolders({
      roots: ['/b', '/a'],
      children: { '/b': [dir('inner')], '/a': [] },
    });
    expect(two.map((f) => f.path)).toEqual(['/b', '/b/inner', '/a']);

    // The open document's directory joins the list even when the sidebar has
    // not listed its parent — but only when it is inside a root.
    const withDoc = pickerFolders({ roots: ['/ws'], children: { '/ws': [] }, docDir: '/ws/deep/er' });
    expect(withDoc.map((f) => f.path)).toEqual(['/ws', '/ws/deep/er']);
    const outside = pickerFolders({ roots: ['/ws'], children: { '/ws': [] }, docDir: '/other/dir' });
    expect(outside.map((f) => f.path)).toEqual(['/ws']);
    // A root is never duplicated when it is also the document's directory.
    expect(pickerFolders({ roots: ['/ws'], children: {}, docDir: '/ws' }).map((f) => f.path)).toEqual(['/ws']);

    // Windows paths keep their separators in the value, '/' in the label.
    const win = pickerFolders({ roots: ['C:\\ws'], children: { 'C:\\ws': [dir('notes')] } });
    expect(win.map((f) => f.path)).toEqual(['C:\\ws', 'C:\\ws\\notes']);
    expect(win[1].label).toBe('ws/notes');

    // The caller may inject the platform's own join (hosted paths are '/').
    const joined = pickerFolders({
      roots: ['/ws'],
      children: { '/ws': [dir('sub')] },
      join: (d, n) => `${d}|${n}`,
    });
    expect(joined[1].path).toBe('/ws|sub');
  });

  test('U331: the picker opens on the document’s folder, else the first root', () => {
    const folders = pickerFolders({ roots: ['/ws'], children: { '/ws': [dir('notes')] } });
    expect(defaultFolder(folders, '/ws/notes')).toBe('/ws/notes');
    expect(defaultFolder(folders, null)).toBe('/ws');
    // A directory that is not offered (outside the workspace) falls back.
    expect(defaultFolder(folders, '/tmp')).toBe('/ws');
    // No workspace at all: '' — the caller has nowhere to write.
    expect(defaultFolder([], '/ws/notes')).toBe('');
  });

  test('U332: the pre-filled name — a free Untitled.md for New, the basename for Save As', () => {
    expect(defaultName('new', { existing: [] })).toBe('Untitled.md');
    expect(defaultName('new', { existing: ['Untitled.md', 'untitled 2.md'] })).toBe('Untitled 3.md');
    expect(defaultName('saveAs', { docBasename: 'report.md', existing: ['report.md'] })).toBe('report.md');
    // An untitled buffer has no basename to suggest.
    expect(defaultName('saveAs', { docBasename: null, existing: ['Untitled.md'] })).toBe('Untitled 2.md');
  });

  test('U333: a name with no extension gets .md', () => {
    expect(withDefaultExtension('notes')).toBe('notes.md');
    expect(withDefaultExtension('  notes  ')).toBe('notes.md');
    expect(withDefaultExtension('notes.md')).toBe('notes.md');
    expect(withDefaultExtension('notes.markdown')).toBe('notes.markdown');
    expect(withDefaultExtension('notes.v2')).toBe('notes.v2'); // any extension counts
  });

  test('U334: invalid names and collisions are refused, with the reason to show', () => {
    // The sidebar rename row's own rules, on the raw input.
    for (const bad of ['', '   ', 'a/b', 'a\\b', '..', '.hidden', 'name.', 'x'.repeat(256), 'con']) {
      const res = checkPickerName(bad, []);
      expect(res.ok, JSON.stringify(bad)).toBe(false);
      if (!res.ok) expect(res.error).toBeTypeOf('string');
    }
    // Empty input complains about the missing name, not about the '.md' the
    // extension default would otherwise have produced.
    expect(checkPickerName('', [])).toEqual({ ok: false, error: 'Name required' });

    // A valid name commits, with the extension defaulted in.
    expect(checkPickerName('notes', ['other.md'])).toEqual({ ok: true, name: 'notes.md' });
    // Surrounding whitespace is the user's typing, not a bad name: it is
    // trimmed away rather than reported (a trailing space inside one still is).
    expect(checkPickerName(' notes.md ', [])).toEqual({ ok: true, name: 'notes.md' });
    expect(checkPickerName('notes ', [])).toEqual({ ok: true, name: 'notes.md' });

    // Collisions are refused — case-insensitively, and after the default
    // extension is applied, so `notes` cannot clobber `Notes.md`.
    const clash = checkPickerName('notes', ['Notes.md']);
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.error).toContain('already exists');
    expect(checkPickerName('notes.md', ['notes.md']).ok).toBe(false);
    expect(checkPickerName('notes.md', ['notes.markdown']).ok).toBe(true);

    // The defaulted '.md' is part of the name that lands on disk: a stem that
    // fits the 255-character limit but does not once extended is refused.
    expect(checkPickerName('x'.repeat(252), []).ok).toBe(true); // 252 + '.md' = 255
    const tooLong = checkPickerName('x'.repeat(253), []);
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error).toBe('Name too long');
  });

  test('U852: New File is offered with a save dialog, else only in a writable workspace', () => {
    // A save dialog keeps the untitled buffer offered everywhere — mode,
    // listing seam and grants never enter into it.
    expect(canOfferNewFile({ hasSaveDialog: true, inWorkspace: false, canList: false, canCreate: false })).toBe(true);
    // Without one it takes a workspace, the listing seam the picker's folders
    // come from, and the file.create grant.
    expect(canOfferNewFile({ hasSaveDialog: false, inWorkspace: true, canList: true, canCreate: true })).toBe(true);
    expect(canOfferNewFile({ hasSaveDialog: false, inWorkspace: false, canList: true, canCreate: true })).toBe(false);
    expect(canOfferNewFile({ hasSaveDialog: false, inWorkspace: true, canList: false, canCreate: true })).toBe(false);
    expect(canOfferNewFile({ hasSaveDialog: false, inWorkspace: true, canList: true, canCreate: false })).toBe(false);
  });
});

describe('PRD 019 Req 12 scratch save name', () => {
  // The clock comes in as `now`, so every expectation can pin the timestamp.
  const now = new Date(2026, 8, 3, 14, 5);

  test('U1039: the scratch pre-fill takes the first heading — ATX or setext — over the first line', () => {
    // The first ATX heading wins even when prose precedes it.
    expect(scratchSaveName('intro prose\n\n# Meeting Notes\n\nbody\n', { existing: [], now })).toBe(
      'Meeting Notes.md'
    );
    // A closing '#' run is ATX decoration, not part of the title.
    expect(scratchSaveName('## Plan ##\n', { existing: [], now })).toBe('Plan.md');
    // A setext underline promotes the line above it to the heading.
    expect(scratchSaveName('intro prose\n\nQuarterly Report\n====\n', { existing: [], now })).toBe(
      'Quarterly Report.md'
    );
    // No heading anywhere: the first non-empty line names the buffer.
    expect(scratchSaveName('\n\n  a plain first line\nmore\n', { existing: [], now })).toBe('a plain first line.md');
  });

  test('U1040: markup is stripped and the text sanitized into a name validateEntryName accepts', () => {
    // Inline formatting goes; a link keeps only its text.
    expect(scratchSaveName('# **Bold** `code` and [a link](https://x.y)\n', { existing: [], now })).toBe(
      'Bold code and a link.md'
    );
    // Path separators cannot survive into a filename; whitespace collapses.
    expect(scratchSaveName('notes/2026\\draft\n', { existing: [], now })).toBe('notes 2026 draft.md');
    // Leading dots would hide the file from the tree; trailing dots are invalid.
    expect(scratchSaveName('# ...hidden agenda...\n', { existing: [], now })).toBe('hidden agenda.md');
    // Overlong titles are cut so the name with its .md stays within 255.
    const long = scratchSaveName(`# ${'x'.repeat(300)}\n`, { existing: [], now });
    expect(long).toBe(`${'x'.repeat(252)}.md`);
  });

  test('U1041: an empty or unusable buffer pre-fills the timestamp, zero-padded', () => {
    expect(scratchSaveName('', { existing: [], now })).toBe('2026-09-03 14.05.md');
    expect(scratchSaveName('   \n\t\n', { existing: [], now })).toBe('2026-09-03 14.05.md');
    // A first line that sanitizes away entirely is as good as empty.
    expect(scratchSaveName('***\n', { existing: [], now })).toBe('2026-09-03 14.05.md');
    // A reserved Windows stem would fail validateEntryName: fall back too.
    expect(scratchSaveName('con\n', { existing: [], now })).toBe('2026-09-03 14.05.md');
  });

  test('U1042: .md is appended only when the derived name lacks an extension, and collisions dedupe', () => {
    // An extension already present is kept, exactly like withDefaultExtension.
    expect(scratchSaveName('notes.markdown\n', { existing: [], now })).toBe('notes.markdown');
    expect(scratchSaveName('plain title\n', { existing: [], now })).toBe('plain title.md');
    // Collisions dedupe through uniqueChildName, matching defaultName's use.
    expect(scratchSaveName('# Plan\n', { existing: ['Plan.md', 'plan 2.md'], now })).toBe('Plan 3.md');
    expect(scratchSaveName('', { existing: ['2026-09-03 14.05.md'], now })).toBe('2026-09-03 14.05 2.md');
  });
});
