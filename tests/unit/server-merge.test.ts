import { describe, expect, it } from 'vitest';
import { mergeThreeWay } from '../../server/merge';

// PRD 010 Req 12: the merge itself, as a pure function — no server, no
// provider, no GitHub. Everything the save route is allowed to assume about
// "clean or conflicting" is pinned here.

const doc = (...lines: string[]): string => lines.join('\n');

describe('PRD 010 Req 12 three-way line merge', () => {
  it('U415: edits to non-overlapping line regions merge clean, carrying both sides', () => {
    const base = doc('# Title', '', 'alpha', 'beta', 'gamma', 'delta', '');
    const ours = doc('# Title', '', 'ALPHA', 'beta', 'gamma', 'delta', '');
    const theirs = doc('# Title', '', 'alpha', 'beta', 'gamma', 'DELTA', '');
    // Both sides' changes are in the answer — not just one of them, and not
    // one of them plus the base's version of the other.
    expect(mergeThreeWay(base, ours, theirs)).toEqual({
      clean: true,
      text: doc('# Title', '', 'ALPHA', 'beta', 'gamma', 'DELTA', ''),
    });
  });

  it('U416: both sides saved the same text, and a client that changed nothing', () => {
    const base = doc('one', 'two', '');
    const same = doc('one', 'TWO', '');
    // ours === theirs: clean, and the answer is that text.
    expect(mergeThreeWay(base, same, same)).toEqual({ clean: true, text: same });
    // base === ours: the client changed nothing, so the head wins outright.
    const theirs = doc('one', 'two', 'three', '');
    expect(mergeThreeWay(base, base, theirs)).toEqual({ clean: true, text: theirs });
    // The mirror image: only the client moved.
    expect(mergeThreeWay(base, theirs, base)).toEqual({ clean: true, text: theirs });
  });

  it('U417: the same line region changed differently on both sides conflicts', () => {
    const base = doc('# Notes', '', 'the shared line', '');
    expect(
      mergeThreeWay(base, doc('# Notes', '', 'my version', ''), doc('# Notes', '', 'their version', '')),
    ).toEqual({ clean: false });
  });

  it('U418: one side deleting a region the other edited conflicts', () => {
    const base = doc('keep', 'first', 'second', 'tail', '');
    const ours = doc('keep', 'first EDITED', 'second', 'tail', '');
    const theirs = doc('keep', 'tail', ''); // both middle lines gone
    expect(mergeThreeWay(base, ours, theirs)).toEqual({ clean: false });
  });

  it('U419: newline fidelity — no trailing newline stays that way, untouched line endings survive', () => {
    // A file that does not end in a newline still does not after a merge —
    // `doc(…)` joins without a trailing one, so the expectation below says it.
    const base = doc('alpha', 'beta', 'omega');
    const ours = doc('ALPHA', 'beta', 'omega');
    const theirs = doc('alpha', 'BETA', 'omega');
    expect(mergeThreeWay(base, ours, theirs)).toEqual({ clean: true, text: doc('ALPHA', 'BETA', 'omega') });

    // A CRLF line neither side touched is copied back byte-for-byte.
    const crlf = 'first\r\nsecond\r\nthird\r\n';
    const oursCrlf = 'FIRST\r\nsecond\r\nthird\r\n';
    const theirsCrlf = 'first\r\nsecond\r\nTHIRD\r\n';
    expect(mergeThreeWay(crlf, oursCrlf, theirsCrlf)).toEqual({
      clean: true,
      text: 'FIRST\r\nsecond\r\nTHIRD\r\n',
    });
  });

  it('U420: decision symmetry — swapping ours and theirs never flips clean ↔ conflict', () => {
    const cases: Array<[string, string, string]> = [
      [doc('a', 'b', 'c', ''), doc('A', 'b', 'c', ''), doc('a', 'b', 'C', '')],
      [doc('a', 'b', 'c', ''), doc('a', 'X', 'c', ''), doc('a', 'Y', 'c', '')],
      [doc('a', 'b', 'c', ''), doc('a', 'b EDIT', 'c', ''), doc('a', 'c', '')],
      [doc('a', ''), doc('a', 'appended', ''), doc('prepended', 'a', '')],
      ['no newline', 'no newline!', 'no newline'],
    ];
    for (const [base, ours, theirs] of cases) {
      expect(mergeThreeWay(base, ours, theirs).clean).toBe(mergeThreeWay(base, theirs, ours).clean);
    }
  });

  it('U421: an empty base, and a merge of insertions at opposite ends', () => {
    // Both sides created the file with different content: nothing to anchor.
    expect(mergeThreeWay('', 'mine\n', 'theirs\n')).toEqual({ clean: false });
    // Insertions at opposite ends of a real document merge clean.
    const base = doc('middle', '');
    expect(mergeThreeWay(base, doc('top', 'middle', ''), doc('middle', 'bottom', ''))).toEqual({
      clean: true,
      text: doc('top', 'middle', 'bottom', ''),
    });
  });
});
