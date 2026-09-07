import { describe, expect, test } from 'vitest';
import { headingTextColumn } from '../src/lib/headingCaret';

describe('PRD 012 Req 6 (issue #300): the heading-text caret column', () => {
  test('U1282: ATX headings land after the markers and their whitespace; setext and plain lines after indentation; nested headings after their container prefix', () => {
    // ATX: the `#` run and the whitespace after it, however wide.
    expect(headingTextColumn('# Guide')).toBe(2);
    expect(headingTextColumn('## Deep Section')).toBe(3);
    expect(headingTextColumn('###### Six')).toBe(7);
    expect(headingTextColumn('##   padded')).toBe(5);
    expect(headingTextColumn('  ## indented')).toBe(5);
    // A bare marker run with no title: the end of the line, not past it.
    expect(headingTextColumn('##')).toBe(2);
    expect(headingTextColumn('## ')).toBe(3);
    // Setext: the text line carries no markers — column 0, or past indentation.
    expect(headingTextColumn('Setext title')).toBe(0);
    expect(headingTextColumn('  Setext title')).toBe(2);
    // Not a heading (a stale map): never mid-word — `#hashtag` is text.
    expect(headingTextColumn('#hashtag')).toBe(0);
    expect(headingTextColumn('')).toBe(0);
    // Container-nested headings (issue #226): after the `> ` / `- ` / `1. ` prefix.
    expect(headingTextColumn('> ## Quoted')).toBe(5);
    expect(headingTextColumn('- ## In a list')).toBe(5);
    expect(headingTextColumn('1. ### Numbered')).toBe(7);
    expect(headingTextColumn('> > # Nested twice')).toBe(6);
    // Seven `#` is a paragraph, not a heading: only its indentation.
    expect(headingTextColumn('####### seven')).toBe(0);
  });
});
