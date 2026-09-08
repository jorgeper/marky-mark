import { describe, expect, test } from 'vitest';
import type { CommentData } from '../../src/lib/anchoring';
import { marginLinkLabel, marginLinkPick, recordAtOffset } from '../../src/lib/marginLink';

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

describe('Issue #343 margin copy-link — which record the control addresses', () => {
  test('U1359: the pick is the PRD 023 §5 kind-aware rule over the ids under the head, labelled for its kind; plain text picks nothing', () => {
    const records = [highlight('h', 0, 20), comment('c', 0, 20), comment('inner', 5, 9)];
    // A comment beats the highlight sharing its text; the innermost comment wins.
    expect(marginLinkPick(['h', 'c', 'inner'], records)).toEqual({ id: 'inner', label: 'Copy link to comment' });
    expect(marginLinkPick(['h'], records)).toEqual({ id: 'h', label: 'Copy link to highlight' });
    // No painted range under the head, or ids naming no record: no control.
    expect(marginLinkPick([], records)).toBeNull();
    expect(marginLinkPick(['gone'], records)).toBeNull();
    expect(marginLinkLabel(records[0])).toBe('Copy link to highlight');
    expect(marginLinkLabel(records[1])).toBe('Copy link to comment');
  });

  test('U1360: the preview asks with the painted ranges covering a selection start — document order, end exclusive, unpainted records never candidates', () => {
    const records = [highlight('h', 0, 20), comment('c', 0, 20), comment('late', 30, 40)];
    const positions = { h: { start: 0, end: 20 }, c: { start: 0, end: 20 }, late: null };
    expect(recordAtOffset(5, positions, records)?.id).toBe('c');
    expect(recordAtOffset(0, positions, records)?.id).toBe('c');
    expect(recordAtOffset(20, positions, records)).toBeNull(); // the range's end is exclusive
    expect(recordAtOffset(35, positions, records)).toBeNull(); // painted nowhere on this surface
    expect(recordAtOffset(5, { h: { start: 0, end: 20 } }, records)?.id).toBe('h'); // a highlight alone
  });
});
