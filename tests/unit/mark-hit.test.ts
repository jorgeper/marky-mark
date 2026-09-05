import { describe, expect, test } from 'vitest';
import type { CommentData } from '../../src/lib/anchoring';
import { pickHitRecord } from '../../src/lib/markHit';

const anchor = (start: number, end: number) => ({ exact: 'x', prefix: '', suffix: '', start, end });
const comment = (id: string, start: number, end: number): CommentData => ({
  kind: 'comment',
  id,
  author: 'Reader',
  createdAt: '2026-01-01T00:00:00.000Z',
  body: 'note',
  resolved: false,
  thread: [],
  anchor: anchor(start, end),
});
const highlight = (id: string, start: number, end: number): CommentData => ({
  kind: 'highlight',
  id,
  author: 'Reader',
  createdAt: '2026-01-01T00:00:00.000Z',
  color: 'green',
  anchor: anchor(start, end),
});

describe('PRD 023 §5 click hit resolution — the kind-aware pick (issue #285)', () => {
  test('U1135: a comment wins over a highlight covering the same click, whatever order the candidates arrive in', () => {
    const records = [highlight('h', 0, 20), comment('c', 0, 20)];
    expect(pickHitRecord(['h', 'c'], records)).toBe('c');
    expect(pickHitRecord(['c', 'h'], records)).toBe('c');
  });

  test('U1136: a highlight alone resolves to itself — kind preference never erases the only record under the click', () => {
    const records = [highlight('h', 5, 12), comment('c', 40, 50)];
    expect(pickHitRecord(['h'], records)).toBe('h');
    // Several highlights, no comment: the first candidate stands.
    const two = [highlight('h1', 0, 20), highlight('h2', 5, 12)];
    expect(pickHitRecord(['h2', 'h1'], two)).toBe('h2');
  });

  test('U1137: among overlapping comments the innermost wins — pinned as the greatest anchor.start, candidate order breaking a tie', () => {
    const records = [comment('outer', 0, 30), comment('inner', 10, 18), highlight('h', 0, 30)];
    expect(pickHitRecord(['outer', 'inner', 'h'], records)).toBe('inner');
    expect(pickHitRecord(['inner', 'outer'], records)).toBe('inner');
    // Identical starts: the earlier candidate keeps the pick (stable).
    const twins = [comment('a', 4, 9), comment('b', 4, 20)];
    expect(pickHitRecord(['a', 'b'], twins)).toBe('a');
    expect(pickHitRecord(['b', 'a'], twins)).toBe('b');
  });

  test('U1138: ids naming no record are ignored; a set with nothing hostable resolves to null', () => {
    const records = [comment('c', 0, 9)];
    expect(pickHitRecord(['stale', 'c'], records)).toBe('c');
    expect(pickHitRecord(['stale', 'gone'], records)).toBe(null);
    expect(pickHitRecord([], records)).toBe(null);
  });
});
