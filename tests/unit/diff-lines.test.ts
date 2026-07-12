import { describe, expect, test } from 'vitest';
import { diffLineSets } from '../../src/lib/diffLines';

const SAVED = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].join('\n');

describe('SPEC16 diff line sets', () => {
  test('U30: identical, insert, delete, replace, and edge edits produce the right 1-based line sets', () => {
    // Identical → both empty.
    expect(diffLineSets(SAVED, SAVED)).toEqual({ changed: [], deletedAfter: [] });

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
