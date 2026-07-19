/**
 * SPEC23 §1: preview-selection → source-offset mapping (pure, no DOM).
 *
 * The split preview renders markdown; a selection there is plain visible
 * text. To mirror it into the editor we reconstruct, per source line, the
 * text the renderer shows (inline markers stripped) together with a map
 * from every visible character back to its source offset. The selection's
 * visible text is then located — whitespace-normalized — inside the line
 * range the blocks' data-mm-line stamps bound, yielding exact source
 * offsets. Anything we cannot place confidently returns null and the
 * caller falls back to the covering line range (never a wrong guess).
 */

export interface StripResult {
  /** The line's rendered-visible text (approximation, inline level). */
  visible: string;
  /** map[i] = source offset (within the line) of visible[i]. */
  map: number[];
}

const isWordChar = (ch: string | undefined): boolean => !!ch && /[A-Za-z0-9]/.test(ch);

/**
 * Strip block prefixes and inline markdown from one source line.
 * Handled: heading/quote/list prefixes, emphasis and strong markers
 * (asterisks and word-boundary underscores), ~~strike~~, inline code
 * backticks, [text](url) links, ![alt](url) images (no visible text),
 * backslash escapes.
 */
export function stripInline(line: string): StripResult {
  const visible: string[] = [];
  const map: number[] = [];
  let i = 0;

  // Block prefixes: quotes can nest, then one heading or list marker.
  let m: RegExpMatchArray | null;
  const prefix = /^(\s*(?:>\s?)*)(?:(#{1,6}\s+)|([-*+]\s+)|(\d+[.)]\s+))?/;
  if ((m = line.match(prefix)) && m[0]) i = m[0].length;

  const emit = (ch: string, at: number) => {
    visible.push(ch);
    map.push(at);
  };

  while (i < line.length) {
    const ch = line[i];
    // Escapes: the backslash is invisible, the escaped char shows.
    if (ch === '\\' && i + 1 < line.length) {
      emit(line[i + 1], i + 1);
      i += 2;
      continue;
    }
    // Images render no selectable text: skip ![alt](url) wholesale.
    if (ch === '!' && line[i + 1] === '[') {
      const close = line.indexOf(']', i + 2);
      if (close !== -1 && line[close + 1] === '(') {
        const paren = line.indexOf(')', close + 2);
        if (paren !== -1) {
          i = paren + 1;
          continue;
        }
      }
    }
    // Links: [text](url) → text.
    if (ch === '[') {
      const close = line.indexOf(']', i + 1);
      if (close !== -1 && line[close + 1] === '(') {
        const paren = line.indexOf(')', close + 2);
        if (paren !== -1) {
          const inner = stripInline(line.slice(i + 1, close));
          for (let k = 0; k < inner.visible.length; k++) emit(inner.visible[k], i + 1 + inner.map[k]);
          i = paren + 1;
          continue;
        }
      }
    }
    // Inline code: the backticks vanish, the content shows verbatim.
    if (ch === '`') {
      let run = 1;
      while (line[i + run] === '`') run++;
      const fence = line.slice(i, i + run);
      const end = line.indexOf(fence, i + run);
      if (end !== -1) {
        for (let k = i + run; k < end; k++) emit(line[k], k);
        i = end + run;
        continue;
      }
    }
    // Strong/emphasis/strike markers vanish. Underscores only act at word
    // boundaries (snake_case stays literal), matching the renderer.
    if (ch === '*' || ch === '~') {
      i++;
      continue;
    }
    if (ch === '_' && !(isWordChar(line[i - 1]) && isWordChar(line[i + 1]))) {
      i++;
      continue;
    }
    emit(ch, i);
    i++;
  }
  return { visible: visible.join(''), map };
}

/**
 * Locate `selectedText` (as rendered) within source lines
 * `fromLine..toLine` (1-based, inclusive) and return exact source offsets,
 * or null when it cannot be located unambiguously.
 */
export function mapSelectionToSource(
  source: string,
  fromLine: number,
  toLine: number,
  selectedText: string
): { from: number; to: number } | null {
  const lines = source.split('\n');
  const lo = Math.min(Math.max(fromLine, 1), lines.length);
  const hi = Math.min(Math.max(toLine, lo), lines.length);

  // Line start offsets in the full source.
  const starts: number[] = [0];
  for (let n = 0; n < lines.length - 1; n++) starts.push(starts[n] + lines[n].length + 1);

  // Whitespace-normalized haystack over the stripped lines, mapping every
  // kept character to its absolute source offset.
  const hay: string[] = [];
  const hayMap: number[] = [];
  let pendingSpace = false;
  for (let n = lo; n <= hi; n++) {
    const stripped = stripInline(lines[n - 1]);
    for (let k = 0; k < stripped.visible.length; k++) {
      const ch = stripped.visible[k];
      if (/\s/.test(ch)) {
        pendingSpace = hay.length > 0;
        continue;
      }
      if (pendingSpace) {
        hay.push(' ');
        hayMap.push(starts[n - 1] + stripped.map[k]); // space anchors to the next char
        pendingSpace = false;
      }
      hay.push(ch);
      hayMap.push(starts[n - 1] + stripped.map[k]);
    }
    pendingSpace = hay.length > 0; // line breaks collapse like spaces
  }
  const haystack = hay.join('');

  const needle = selectedText.replace(/\s+/g, ' ').trim();
  if (!needle) return null;

  const first = haystack.indexOf(needle);
  if (first === -1) return null;
  if (haystack.indexOf(needle, first + 1) !== -1) return null; // ambiguous → fall back

  const from = hayMap[first];
  const to = hayMap[first + needle.length - 1] + 1;
  return { from, to };
}

/**
 * SPEC24 §1: the inverse direction — the rendered-visible text of source
 * range [from, to). Each covered line contributes the visible characters
 * whose source offsets fall inside the range; lines join with a space.
 */
export function visibleTextForRange(source: string, from: number, to: number): string {
  if (to <= from) return '';
  const lines = source.split('\n');
  const parts: string[] = [];
  let lineStart = 0;
  for (const line of lines) {
    const lineEnd = lineStart + line.length;
    if (lineEnd >= from && lineStart < to) {
      const { visible, map } = stripInline(line);
      let piece = '';
      for (let k = 0; k < visible.length; k++) {
        const abs = lineStart + map[k];
        if (abs >= from && abs < to) piece += visible[k];
      }
      if (piece) parts.push(piece);
    }
    lineStart = lineEnd + 1;
    if (lineStart >= to) break;
  }
  return parts.join(' ');
}

/**
 * SPEC24 §1: locate the whitespace-normalized `needle` inside a raw
 * `haystack`, returning RAW haystack offsets of the match — null when the
 * needle is absent or matches more than once (the caller falls back).
 */
export function findNormalized(haystack: string, needle: string): { start: number; end: number } | null {
  const want = needle.replace(/\s+/g, ' ').trim();
  if (!want) return null;
  const { hay, map } = flattenWhitespace(haystack);
  const first = hay.indexOf(want);
  if (first === -1) return null;
  if (hay.indexOf(want, first + 1) !== -1) return null; // ambiguous
  return { start: map[first], end: map[first + want.length - 1] + 1 };
}

/** Whitespace runs collapse to single spaces; map[i] = raw offset of flat[i]. */
function flattenWhitespace(haystack: string): { hay: string; map: number[] } {
  const flat: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < haystack.length; i++) {
    const ch = haystack[i];
    if (/\s/.test(ch)) {
      pendingSpace = flat.length > 0;
      continue;
    }
    if (pendingSpace) {
      flat.push(' ');
      map.push(i); // the space anchors to the next raw char
      pendingSpace = false;
    }
    flat.push(ch);
    map.push(i);
  }
  return { hay: flat.join(''), map };
}

/**
 * SPEC44 §3.1: occurrence counting in the normalized space — how many
 * (possibly overlapping) matches of `needle` occur in `haystack`. Both
 * panes count with the SAME rule, so an index computed on the source side
 * selects the matching rendered occurrence.
 */
export function countNormalized(haystack: string, needle: string): number {
  const want = needle.replace(/\s+/g, ' ').trim();
  if (!want) return 0;
  const { hay } = flattenWhitespace(haystack);
  let n = 0;
  for (let at = hay.indexOf(want); at !== -1; at = hay.indexOf(want, at + 1)) n++;
  return n;
}

/** SPEC44 §3.1: like findNormalized but returns the nth (0-based) match. */
export function findNormalizedNth(haystack: string, needle: string, nth: number): { start: number; end: number } | null {
  const want = needle.replace(/\s+/g, ' ').trim();
  if (!want || nth < 0) return null;
  const { hay, map } = flattenWhitespace(haystack);
  let at = hay.indexOf(want);
  for (let k = 0; k < nth && at !== -1; k++) at = hay.indexOf(want, at + 1);
  if (at === -1) return null;
  return { start: map[at], end: map[at + want.length - 1] + 1 };
}

/**
 * SPEC44 §3.1: the rendered offset (raw, within `rendered`) where source
 * offset `at` lands — via the normalized-flat length of the source-visible
 * prefix [blockStart, at). Clamps into the rendered text; null only when
 * the rendered text has no visible characters at all.
 */
export function renderedOffsetForSource(source: string, blockStart: number, at: number, rendered: string): number | null {
  const prefix = visibleTextForRange(source, blockStart, Math.max(blockStart, at));
  const n = flattenWhitespace(prefix).hay.length;
  const { hay, map } = flattenWhitespace(rendered);
  if (map.length === 0) return null;
  const atCh = source[at];
  // Affinity by the SOURCE character under the caret: on whitespace or at
  // the end (a word/line/item boundary) stay LEFT — the last prefix char's
  // rendered spot — so an end-of-item caret never rolls into the next item.
  if (atCh === undefined || /\s/.test(atCh)) {
    return map[Math.max(0, Math.min(n, hay.length) - 1)];
  }
  let i = n;
  if (hay[i] === ' ') i++; // a visible caret char sits AFTER the flat space
  if (i >= hay.length) return map[map.length - 1] + 1;
  return map[i];
}

/**
 * SPEC44 §4.1: the reverse trip — the source offset where raw rendered
 * offset `local` (within the block's rendered text) lands, mapped through
 * the visible text of 1-based source lines [fromLine, toLine].
 */
export function sourceOffsetForRendered(
  source: string,
  fromLine: number,
  toLine: number,
  rendered: string,
  local: number
): number | null {
  const n = flattenWhitespace(rendered.slice(0, Math.max(0, local))).hay.length;
  const lines = source.split('\n');
  const abs: number[] = [];
  const visible: string[] = [];
  let lineStart = 0;
  for (let k = 0; k < lines.length; k++) {
    if (k + 1 >= fromLine && k + 1 <= toLine) {
      if (visible.length > 0) {
        visible.push(' ');
        abs.push(lineStart);
      }
      const { visible: v, map } = stripInline(lines[k]);
      for (let i = 0; i < v.length; i++) {
        visible.push(v[i]);
        abs.push(lineStart + map[i]);
      }
    }
    lineStart += lines[k].length + 1;
  }
  const flatAbs: number[] = [];
  {
    // flatten the visible text while carrying the absolute source offsets
    let pendingSpace = false;
    for (let i = 0; i < visible.length; i++) {
      if (/\s/.test(visible[i])) {
        pendingSpace = flatAbs.length > 0;
        continue;
      }
      if (pendingSpace) {
        flatAbs.push(abs[i]);
        pendingSpace = false;
      }
      flatAbs.push(abs[i]);
    }
  }
  if (flatAbs.length === 0) return null;
  return flatAbs[Math.min(n, flatAbs.length - 1)];
}

/**
 * SPEC44 §4.1: the click-side inverse — source offsets of the nth
 * (0-based, normalized counting) visible occurrence of `needle` within
 * 1-based source lines [fromLine, toLine]. Null when absent.
 */
export function sourceRangeForVisibleMatch(
  source: string,
  fromLine: number,
  toLine: number,
  needle: string,
  nth: number
): { from: number; to: number } | null {
  const want = needle.replace(/\s+/g, ' ').trim();
  if (!want || nth < 0) return null;
  const lines = source.split('\n');
  const visible: string[] = [];
  const abs: number[] = [];
  let lineStart = 0;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (n + 1 >= fromLine && n + 1 <= toLine) {
      if (visible.length > 0) {
        visible.push(' ');
        abs.push(lineStart); // the joiner anchors to the next line's start
      }
      const { visible: v, map } = stripInline(line);
      for (let k = 0; k < v.length; k++) {
        visible.push(v[k]);
        abs.push(lineStart + map[k]);
      }
    }
    lineStart += line.length + 1;
  }
  const hit = findNormalizedNth(visible.join(''), want, nth);
  if (!hit) return null;
  return { from: abs[hit.start], to: abs[hit.end - 1] + 1 };
}
