import { describe, expect, test } from 'vitest';
import { countWords } from '../../src/lib/wordCount';

describe('SPEC16 word count', () => {
  test('U33: prose, unicode, punctuation-only tokens, empty text, reading-time math', () => {
    expect(countWords('one two three')).toEqual({ words: 3, minutes: 1 });
    expect(countWords('')).toEqual({ words: 0, minutes: 0 });
    expect(countWords('   \n\t ')).toEqual({ words: 0, minutes: 0 });
    // Punctuation-only tokens don't count; hyphenated/apostrophe words do.
    expect(countWords('--- *** !!!').words).toBe(0);
    expect(countWords("it's a test — really").words).toBe(4);
    // Unicode words count.
    expect(countWords('ναι こんにちは désolé 123').words).toBe(4);
    // Reading time: ceil(words / 220), floor of 1 minute when any words.
    expect(countWords('word '.repeat(220)).minutes).toBe(1);
    expect(countWords('word '.repeat(221)).minutes).toBe(2);
    expect(countWords('word').minutes).toBe(1);
  });
});
