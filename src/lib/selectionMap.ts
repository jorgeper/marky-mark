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
