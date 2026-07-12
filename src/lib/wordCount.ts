/**
 * SPEC16 §5: the word-count chip's math. Unicode-aware — a token counts as
 * a word iff it contains a letter or digit, so `---` and `***` don't.
 * Reading time at 220 wpm, ceiling, floor of one minute when any words. Pure.
 */

const WORDISH = /[\p{L}\p{N}]/u;
const WPM = 220;

export function countWords(text: string): { words: number; minutes: number } {
  let words = 0;
  for (const token of text.split(/\s+/)) {
    if (token && WORDISH.test(token)) words++;
  }
  return { words, minutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / WPM)) };
}
