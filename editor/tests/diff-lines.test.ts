import { describe, expect, test } from 'vitest';
import { diffLineSets } from '../src/lib/diffLines';

const SAVED = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].join('\n');

describe('SPEC16 diff line sets', () => {
  test('U30: identical, insert, delete, replace, and edge edits produce the right 1-based line sets', () => {
    // Identical → both empty.
    expect(diffLineSets(SAVED, SAVED)).toEqual({ changed: [], deletedAfter: [], removed: [] });

    // Append two lines → they are changed; nothing deleted.
    const appended = `${SAVED}\nfoxtrot\ngolf`;
    const app = diffLineSets(SAVED, appended);
    expect(app.changed).toEqual([6, 7]);
    expect(app.deletedAfter).toEqual([]);

    // Delete the middle line (charlie) → deletion marker after bravo (line 2).
    const deleted = ['alpha', 'bravo', 'delta', 'echo'].join('\n');
    const del = diffLineSets(SAVED, deleted);
    expect(del.changed).toEqual([]);
    expect(del.deletedAfter).toEqual([2]);

    // Replace a line → that line is changed (and the old one counts as deleted there).
    const replaced = ['alpha', 'bravo', 'CHANGED', 'delta', 'echo'].join('\n');
    const rep = diffLineSets(SAVED, replaced);
    expect(rep.changed).toEqual([3]);

    // Deletion at the very start → marker at 0 (before line 1).
    const headless = ['bravo', 'charlie', 'delta', 'echo'].join('\n');
    expect(diffLineSets(SAVED, headless).deletedAfter).toEqual([0]);

    // Insertion at the very start → line 1 changed.
    const prefixed = `zero\n${SAVED}`;
    expect(diffLineSets(SAVED, prefixed).changed).toEqual([1]);
  });
});

// SPEC16 §2 (issue #315): the seam carries the removed lines' TEXT per
// deleted run, so the editor can show what vanished instead of only where.
describe('SPEC16 §2 (issue #315): removed runs carry their text', () => {
  test('U1252: a middle-line deletion carries that line at anchor 2, and identical inputs carry none', () => {
    const deleted = ['alpha', 'bravo', 'delta', 'echo'].join('\n');
    expect(diffLineSets(SAVED, deleted).removed).toEqual([{ after: 2, lines: ['charlie'] }]);
    expect(diffLineSets(SAVED, SAVED).removed).toEqual([]);
    expect(diffLineSets(`${SAVED}\n`, SAVED).removed).toEqual([]); // trailing-newline normalisation
  });

  test('U1253: a multi-line run is ONE entry carrying all its lines in order', () => {
    const gutted = ['alpha', 'echo'].join('\n');
    const out = diffLineSets(SAVED, gutted);
    expect(out.removed).toEqual([{ after: 1, lines: ['bravo', 'charlie', 'delta'] }]);
    expect(out.deletedAfter).toEqual([1]);
  });

  test('U1254: a deletion before line 1 carries its text at anchor 0', () => {
    const headless = ['bravo', 'charlie', 'delta', 'echo'].join('\n');
    expect(diffLineSets(SAVED, headless).removed).toEqual([{ after: 0, lines: ['alpha'] }]);
  });

  test('U1255: a replaced line carries the old text alongside the changed line — the edge marker stays dropped', () => {
    const replaced = ['alpha', 'bravo', 'CHANGED', 'delta', 'echo'].join('\n');
    const rep = diffLineSets(SAVED, replaced);
    expect(rep.changed).toEqual([3]);
    expect(rep.removed).toEqual([{ after: 2, lines: ['charlie'] }]);
    // The 3px edge on line 2 is still dropped for a replacement (U30's rule):
    // the red block itself now sits between line 2 and the green line 3.
    expect(rep.deletedAfter).toEqual([]);
    // Two runs, two entries, each with its own anchor in the CURRENT buffer.
    const two = ['alpha', 'X', 'charlie', 'Y', 'echo'].join('\n');
    expect(diffLineSets(SAVED, two).removed).toEqual([
      { after: 1, lines: ['bravo'] },
      { after: 3, lines: ['delta'] },
    ]);
    // Removing the trailing line anchors after the new last line.
    expect(diffLineSets(SAVED, ['alpha', 'bravo', 'charlie', 'delta'].join('\n')).removed).toEqual([
      { after: 4, lines: ['echo'] },
    ]);
  });
});
