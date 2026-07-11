import { describe, expect, test } from 'vitest';
import { stepComment } from '../../src/lib/commentNav';

describe('SPEC14 comment stepping', () => {
  test('U26: empty → null; no/unknown active enters at first/last; steps and wraps both ways', () => {
    expect(stepComment([], null, 1)).toBeNull();
    expect(stepComment([], null, -1)).toBeNull();
    const ids = ['a', 'b', 'c'];
    expect(stepComment(ids, null, 1)).toBe('a');
    expect(stepComment(ids, null, -1)).toBe('c');
    expect(stepComment(ids, 'zzz', 1)).toBe('a'); // unknown = none
    expect(stepComment(ids, 'a', 1)).toBe('b');
    expect(stepComment(ids, 'b', -1)).toBe('a');
    expect(stepComment(ids, 'c', 1)).toBe('a'); // wrap forward
    expect(stepComment(ids, 'a', -1)).toBe('c'); // wrap back
  });
});
