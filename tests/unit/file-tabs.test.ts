import { describe, expect, test } from 'vitest';
import { closeOthersTargets, fileTabContextMenu } from '../../src/lib/fileTabs';

// PRD 013 Req 7: the tab context menu's pure rules — the item model and the
// Close Others target order (the component renders, App runs the verbs).

describe('PRD 013 file tab menu', () => {
  test('U696: the menu model — exactly Close, Close Others, Close All, in that order', () => {
    expect(fileTabContextMenu()).toEqual([
      { id: 'close', label: 'Close' },
      { id: 'close-others', label: 'Close Others' },
      { id: 'close-all', label: 'Close All' },
    ]);
  });

  test('U697: Close Others targets — every other file, in the list\'s own (tree) order', () => {
    const open = ['/n/sub/deep/c.md', '/n/sub/b.md', '/n/a.md'];
    expect(closeOthersTargets(open, '/n/sub/b.md')).toEqual(['/n/sub/deep/c.md', '/n/a.md']);
    // First and last kept: order of the rest is untouched either way.
    expect(closeOthersTargets(open, '/n/sub/deep/c.md')).toEqual(['/n/sub/b.md', '/n/a.md']);
    expect(closeOthersTargets(open, '/n/a.md')).toEqual(['/n/sub/deep/c.md', '/n/sub/b.md']);
    // The input list is not mutated.
    expect(open).toHaveLength(3);
  });

  test('U698: Close Others edge cases — a single tab yields no targets; a keep not in the list drops nothing', () => {
    expect(closeOthersTargets(['/n/a.md'], '/n/a.md')).toEqual([]);
    expect(closeOthersTargets([], '/n/a.md')).toEqual([]);
    expect(closeOthersTargets(['/n/a.md', '/n/b.md'], '/n/gone.md')).toEqual(['/n/a.md', '/n/b.md']);
  });
});
