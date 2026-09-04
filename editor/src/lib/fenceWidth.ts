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

// PRD 015 Req 3: only `width=<plain run of digits>` qualifies as a value the
// reader returns, name matched case-insensitively. `width`, `width=`,
// `width=abc`, `width=500px`, `width=12.5` never match; `width=0` matches and
// is rejected by value. WIDTH_NAME is the looser "this token is the width
// slot" test the rewriter uses, so a malformed value is overwritten in place
// rather than left beside a second, well-formed token.
const WIDTH_VALUE = /^width=(\d+)$/i;
const WIDTH_NAME = /^width=/i;

interface MetaToken {
  text: string;
  /** Offsets into the info string the token was read from. */
  start: number;
  end: number;
}

/**
 * PRD 015 Req 1: the meta tokens of an info string — every whitespace-
 * delimited token *after* the language word, with its offsets. Both exports
 * go through here, so they agree on what counts as meta: the first word is
 * the language and is never a width token.
 */
function metaTokens(info: string): MetaToken[] {
  const tokens: MetaToken[] = [];
  const re = /\S+/g;
  for (let m = re.exec(info); m; m = re.exec(info)) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens.slice(1);
}

/**
 * PRD 015 Req 3: read the width out of an info string (the same value
 * `fenceLanguage` is handed — "lang", or "lang meta…"). Returns the width as
 * a positive integer, or null for: no string, no meta, no `width` token, a
 * malformed value, or zero/negative. The first qualifying token wins.
 */
export function readFenceWidth(info: string | null | undefined): number | null {
  if (info == null) return null;
  for (const { text } of metaTokens(info)) {
    const m = WIDTH_VALUE.exec(text);
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

  const present = metaTokens(info).filter((t) => WIDTH_NAME.test(t.text));
  if (width === null && present.length === 0) return line; // no-op: nothing to remove

  // The first `width=…` is the one the reader sees, so it is the one a write
  // replaces in place; every other is a duplicate. On a removal all of them
  // go, which is what leaves a repeated rewrite idempotent either way.
  const keep = width !== null && present.length > 0 ? present[0] : null;
  const drop = present.filter((t) => t !== keep);

  let out = info;
  // Right to left, so the offsets of the tokens still to come stay valid.
  // Each deleted token takes the single space before it with it.
  for (let i = drop.length - 1; i >= 0; i--) {
    const { start, end } = drop[i];
    const cut = /[ \t]/.test(out[start - 1]) ? start - 1 : start;
    out = out.slice(0, cut) + out.slice(end);
  }

  if (width !== null) {
    const token = `width=${width}`; // writing always emits lowercase
    if (keep) {
      out = out.slice(0, keep.start) + token + out.slice(keep.end);
    } else {
      // Append at the end of the meta, leaving any trailing whitespace last.
      const trailing = /\s*$/.exec(out)?.[0] ?? '';
      const content = trailing ? out.slice(0, -trailing.length) : out;
      out = `${content} ${token}${trailing}`;
    }
  }
  return indent + run + out + eol;
}
