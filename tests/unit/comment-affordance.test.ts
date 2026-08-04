import { describe, expect, test } from 'vitest';
import { commentAffordanceSurface, type AffordanceState } from '../../src/lib/commentAffordance';

const base: AffordanceState = {
  mode: 'preview',
  splitEdit: false,
  hasSelection: true,
  showComments: true,
  commentsEnabled: true,
  composerOpen: false,
  authoringFrozen: false,
};

describe('issue #38 comment affordance surface', () => {
  test('U155: the predicate mirrors the button gate — every common gate kills both surfaces, and the surface follows the mode', () => {
    // The three live surfaces (SPEC7, SPEC25, #19): full preview and the
    // split-edit live preview anchor from the rendered DOM; plain edit mode
    // routes through the SPEC25 carry.
    expect(commentAffordanceSurface(base)).toBe('preview');
    expect(commentAffordanceSurface({ ...base, mode: 'edit', splitEdit: true })).toBe('preview');
    expect(commentAffordanceSurface({ ...base, mode: 'edit' })).toBe('edit');
    // splitEdit is a persisted setting: it must not drag preview mode anywhere.
    expect(commentAffordanceSurface({ ...base, splitEdit: true })).toBe('preview');

    // Each common gate closes every surface (SPEC7 §2, PRD 004 Req 15).
    for (const mode of ['preview', 'edit'] as const) {
      const on: AffordanceState = { ...base, mode };
      expect(commentAffordanceSurface({ ...on, hasSelection: false })).toBeNull();
      expect(commentAffordanceSurface({ ...on, showComments: false })).toBeNull();
      expect(commentAffordanceSurface({ ...on, commentsEnabled: false })).toBeNull();
      expect(commentAffordanceSurface({ ...on, composerOpen: true })).toBeNull();
      expect(commentAffordanceSurface({ ...on, authoringFrozen: true })).toBeNull();
    }
    expect(commentAffordanceSurface({ ...base, mode: 'edit', splitEdit: true, authoringFrozen: true })).toBeNull();
  });
});
