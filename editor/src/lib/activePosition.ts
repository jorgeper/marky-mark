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

/**
 * SPEC44 §3.1: map an offset between two texts that share LINE structure
 * but differ in intra-line whitespace (the table grid vs its canonical
 * form): same line, same count of non-whitespace characters before the
 * caret. A caret ON a content character lands on the corresponding
 * content character; boundary carets keep left affinity.
 */
export function mapOffsetByLineFlat(from: string, to: string, offset: number): number {
  const at = Math.max(0, Math.min(offset, from.length));
  const fLines = from.split('\n');
  const tLines = to.split('\n');
  let li = 0;
  let lineStart = 0;
  while (li < fLines.length - 1 && at > lineStart + fLines[li].length) {
    lineStart += fLines[li].length + 1;
    li++;
  }
  const col = at - lineStart;
  let n = 0;
  for (let i = 0; i < Math.min(col, fLines[li].length); i++) if (!/\s/.test(fLines[li][i])) n++;
  const tIdx = Math.min(li, tLines.length - 1);
  let tStart = 0;
  for (let i = 0; i < tIdx; i++) tStart += tLines[i].length + 1;
  const tl = tLines[tIdx];
  const onContent = col < fLines[li].length && !/\s/.test(fLines[li][col]);
  let seen = 0;
  for (let i = 0; i < tl.length; i++) {
    if (!/\s/.test(tl[i])) {
      seen++;
      if (onContent && seen === n + 1) return tStart + i; // ON the (n+1)th content char
      if (!onContent && seen === n) return tStart + i + 1; // just AFTER the nth (left affinity)
    }
  }
  if (!onContent && n === 0) return tStart + Math.min(col, tl.length);
  return tStart + tl.length;
}
