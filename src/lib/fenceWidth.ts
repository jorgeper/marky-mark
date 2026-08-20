/**
 * PRD 015 Reqs 1–3: the fence width token — a reader and a rewriter over the
 * `width=N` token (N a positive integer of CSS px) that sits in a fence's
 * info string *after* the language word, e.g. ```` ```lang width=500 ````.
 * Pure text surgery in the `imageResize.ts` shape: reading never mutates and
 * never throws; rewriting returns a replacement line with everything else —
 * indentation, fence character and run length, the language word, every other
 * meta token with its order and spacing, and any trailing line ending —
 * preserved verbatim. An opening fence line with *no language word* is
 * returned unchanged by the rewriter: appending there would make `width=N`
 * the fence's language. The module knows nothing about which languages have
 * renderers, and a `height=` token is never read and never written — it is
 * preserved like any other unknown token.
 */

// PRD 015 Req 3: only `width=<plain run of digits>` qualifies, name matched
// case-insensitively. `width`, `width=`, `width=abc`, `width=500px`,
// `width=12.5` never match; `width=0` matches and is rejected by value.
const WIDTH_TOKEN = /^width=(\d+)$/i;
const WIDTH_NAME = /^width=/i;

/**
 * PRD 015 Req 3: read the width out of an info string (the same value
 * `fenceLanguage` is handed — "lang", or "lang meta…"). Returns the width as
 * a positive integer, or null for: no string, no meta, no `width` token, a
 * malformed value, or zero/negative. The first qualifying token wins. The
 * first word is the language and is never read as a width token.
 */
export function readFenceWidth(info: string | null | undefined): number | null {
  if (info == null) return null;
  const tokens = info.split(/\s+/).filter(Boolean);
  for (const token of tokens.slice(1)) {
    const m = WIDTH_TOKEN.exec(token);
    if (m) {
      const n = Number(m[1]);
      if (n > 0) return n;
    }
  }
  return null;
}

// An opening fence line: indentation, the fence run (``` or ~~~, 3+ chars),
// then the info string. The rewrite is anchored here so everything outside
// the one token survives byte-for-byte.
const FENCE_LINE = /^([^\S\r\n]*)(`{3,}|~{3,})(.*)$/;

/**
 * PRD 015 Req 2: rewrite the opening fence line's width token surgically.
 * Takes the whole line as it sits in the document plus a target width (a
 * positive integer, or null to remove) and returns the replacement line:
 * an existing `width=…` token is replaced in place wherever it sits among
 * the meta tokens; ` width=N` is appended at the end of the meta when none
 * exists; removal deletes only the token and the single space before it.
 * Duplicate `width=…` tokens collapse to one, so a repeated rewrite is
 * idempotent. Removing from a line that has no width token — or writing the
 * width the line already carries — returns the input byte-identical, so a
 * caller can compare and skip the buffer write. A line that is not an
 * opening fence, has no language word, or is handed an invalid width is
 * returned unchanged.
 */
export function rewriteFenceWidth(line: string, width: number | null): string {
  if (width !== null && (!Number.isInteger(width) || width <= 0)) return line;
  const eol = /[\r\n]+$/.exec(line)?.[0] ?? '';
  const body = eol ? line.slice(0, -eol.length) : line;
  const m = FENCE_LINE.exec(body);
  if (!m) return line;
  const [, indent, run, info] = m;
  // No language word ⇒ no write: `width=N` must never become the language.
  if (!/\S/.test(info)) return line;

  // Locate every `width=…` meta token (the language word never counts).
  const spans: Array<{ start: number; end: number }> = [];
  const tokenRe = /\S+/g;
  let sawLanguage = false;
  for (let t = tokenRe.exec(info); t; t = tokenRe.exec(info)) {
    if (!sawLanguage) {
      sawLanguage = true;
      continue;
    }
    if (WIDTH_NAME.test(t[0])) spans.push({ start: t.index, end: t.index + t[0].length });
  }

  let out = info;
  // Right to left, so earlier span offsets stay valid: drop every duplicate
  // (and, on removal, the first too), each with the single space before it.
  const keepFirst = width !== null && spans.length > 0;
  for (let i = spans.length - 1; i >= (keepFirst ? 1 : 0); i--) {
    const { start, end } = spans[i];
    const cut = start > 0 && /[ \t]/.test(out[start - 1]) ? start - 1 : start;
    out = out.slice(0, cut) + out.slice(end);
  }
  if (width !== null) {
    const token = `width=${width}`; // writing always emits lowercase
    if (keepFirst) {
      out = out.slice(0, spans[0].start) + token + out.slice(spans[0].end);
    } else {
      const trailing = /\s*$/.exec(out)?.[0] ?? '';
      const content = trailing ? out.slice(0, -trailing.length) : out;
      out = `${content} ${token}${trailing}`;
    }
  } else if (spans.length === 0) {
    return line; // explicit no-op: nothing to remove
  }
  return indent + run + out + eol;
}
