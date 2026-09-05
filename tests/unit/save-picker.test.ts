import { describe, expect, test } from 'vitest';
import {
  canOfferNewFile,
  checkPickerName,
  defaultFolder,
  defaultName,
  pickerFolders,
  withDefaultExtension,
} from '../../src/lib/savePicker';
import * as savePicker from '../../src/lib/savePicker';
import { uniqueChildName } from '../../src/lib/folderOps';

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

describe('PRD 023 Req 9 scratch save pre-fill', () => {
  // PRD 023 Req 9 replaces PRD 019 Req 12: the scratch buffer's first save
  // pre-fills through defaultName like every other untitled buffer — a free
  // Untitled.md, never a name derived from the buffer's content.

  test('U1039: an untitled Save As pre-fills a free Untitled.md — content never enters', () => {
    // The pre-fill is not a function of the buffer's text: defaultName takes
    // no content, and the retired content-derived namer is gone outright.
    expect(defaultName('saveAs', { docBasename: null, existing: [] })).toBe('Untitled.md');
    expect(savePicker).not.toHaveProperty('scratchSaveName');
  });

  test('U1040: the pre-fill dedupes through uniqueChildName exactly as the sidebar’s New File does', () => {
    // Case-insensitive, gap-free suffixes — and literally the same answer
    // uniqueChildName gives, so the two surfaces cannot drift apart.
    const existing = ['Untitled.md', 'untitled 2.md', 'notes.md'];
    expect(defaultName('saveAs', { docBasename: null, existing })).toBe('Untitled 3.md');
    expect(defaultName('saveAs', { docBasename: null, existing })).toBe(uniqueChildName([...existing], 'Untitled.md'));
  });

  test('U1041: an empty buffer gets the same pre-fill — saving nothing still asks with Untitled.md', () => {
    // PRD 023 Req 11: emptiness cannot change the answer, because content is
    // not an input to the pre-fill at all.
    expect(defaultName('saveAs', { docBasename: null, existing: [] })).toBe('Untitled.md');
    expect(defaultName('saveAs', { docBasename: null, existing: ['Untitled.md'] })).toBe('Untitled 2.md');
  });

  test('U1042: ordinary callers keep their pre-fills — New File and a named document’s Save As unchanged', () => {
    expect(defaultName('new', { existing: ['Untitled.md'] })).toBe('Untitled 2.md');
    expect(defaultName('saveAs', { docBasename: 'report.md', existing: ['report.md'] })).toBe('report.md');
  });

  test('U1131: the scratch pre-fill is free against the scratch root’s live listing', () => {
    // The dedupe walks the listing the picker fetched, whatever crowds it.
    expect(defaultName('saveAs', { docBasename: null, existing: ['kept.md', 'Plan.md'] })).toBe('Untitled.md');
    expect(defaultName('saveAs', { docBasename: null, existing: ['Untitled.md'] })).toBe('Untitled 2.md');
    expect(defaultName('saveAs', { docBasename: null, existing: ['Untitled.md', 'Untitled 2.md'] })).toBe(
      'Untitled 3.md'
    );
    // A freed suffix is reused: the guess is the first free name, not a counter.
    expect(defaultName('saveAs', { docBasename: null, existing: ['Untitled.md', 'Untitled 3.md'] })).toBe(
      'Untitled 2.md'
    );
  });
});
