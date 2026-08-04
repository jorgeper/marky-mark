import { describe, expect, it } from 'vitest';
import { isDirtyText, normalizeEol } from '../../src/lib/dirty';
import { canonicalizeDetected } from '../../src/components/tableMode';

describe('Issue #42 dirty predicate', () => {
  it('U162: identical text is clean; a real one-character edit is dirty', () => {
    expect(isDirtyText('# Title\n\nbody\n', '# Title\n\nbody\n')).toBe(false);
    expect(isDirtyText('# Title\n\nbody!\n', '# Title\n\nbody\n')).toBe(true);
    // A whitespace-only edit is still a real edit.
    expect(isDirtyText('# Title \n\nbody\n', '# Title\n\nbody\n')).toBe(true);
  });

  it('U163: a CRLF-vs-LF-only difference is clean, in either direction', () => {
    expect(isDirtyText('a\nb\nc\n', 'a\r\nb\r\nc\r\n')).toBe(false);
    expect(isDirtyText('a\r\nb\r\nc\r\n', 'a\nb\nc\n')).toBe(false);
    // Lone CR (classic-Mac) and mixed endings are representation too.
    expect(isDirtyText('a\rb\rc', 'a\nb\nc')).toBe(false);
    expect(isDirtyText('a\r\nb\nc\r', 'a\nb\nc\n')).toBe(false);
    // …but an edit inside a CRLF file is still dirty.
    expect(isDirtyText('a\nB\nc\n', 'a\r\nb\r\nc\r\n')).toBe(true);
  });

  it('U164: normalizeEol maps every ending to LF and leaves LF text alone', () => {
    expect(normalizeEol('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
    expect(normalizeEol('a\nb\nc')).toBe('a\nb\nc');
    expect(normalizeEol('')).toBe('');
  });

  it('U165: a parked table-mode buffer whose canonical form equals the saved text is clean', () => {
    // The display grid (padded cells) vs the compact on-disk form — the very
    // pair a parked entry raw-compared before issue #42 (SPEC38 §3.5).
    const grid = '| alpha    | b        |\n| -------- | -------- |\n| c        | d        |\n';
    const compact = canonicalizeDetected(grid);
    expect(compact).not.toBe(grid); // the dress really differs byte-wise
    expect(isDirtyText(canonicalizeDetected(grid), compact)).toBe(false);
    // A real cell edit in the grid stays dirty after canonicalization.
    const edited = grid.replace('alpha', 'ALPHA');
    expect(isDirtyText(canonicalizeDetected(edited), compact)).toBe(true);
  });
});
