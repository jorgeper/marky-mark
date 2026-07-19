/**
 * SPEC44 §1: pure placement math for the active line & word cues — no DOM.
 * The word test is Unicode-aware (letters, numbers, underscore); block
 * resolution runs over the sorted data-mm-line anchor list the preview
 * already carries (SPEC15).
 */

const WORD = /[\p{L}\p{N}_]/u;

/**
 * The word containing `offset` — with left affinity: an offset sitting just
 * past a word's last character (the caret "at the end of" a word) still
 * yields that word. Null on whitespace/punctuation runs and empty text.
 */
export function wordAt(text: string, offset: number): { start: number; end: number } | null {
  if (text.length === 0) return null;
  let at = Math.max(0, Math.min(offset, text.length));
  const isWord = (i: number) => i >= 0 && i < text.length && WORD.test(text[i]);
  if (!isWord(at)) {
    if (isWord(at - 1)) at -= 1; // left affinity at word end
    else return null;
  }
  let start = at;
  let end = at + 1;
  while (isWord(start - 1)) start--;
  while (isWord(end)) end++;
  return { start, end };
}

/**
 * The anchor line of the block containing 1-based source `line`: the
 * greatest anchor ≤ line. Null before the first anchor (front matter,
 * un-stamped leading content) or with no anchors at all.
 */
export function blockLineFor(anchors: number[], line: number): number | null {
  let best: number | null = null;
  for (const a of anchors) {
    if (a <= line) best = a;
    else break;
  }
  return best;
}
