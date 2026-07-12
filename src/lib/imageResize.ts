/**
 * SPEC20 §4.2: pure text surgery for preview resize. Given the markdown
 * source span of an image (stamped as data-mm-src-start/end by markdown.ts)
 * and a target width, produce the replacement text for that span:
 *
 *   - a span that is already an `<img …>` tag keeps all its other attributes
 *     and just gets `width` set (or removed);
 *   - markdown/reference syntax is rewritten to a fresh `<img>` built from
 *     the rendered image's own src/alt/title — except that *removing* the
 *     width from never-rewritten markdown syntax is a no-op (null): the
 *     source only turns into HTML when a size actually needs persisting.
 */

export interface ImageTagParts {
  /** The image's original (unresolved) src, exactly as the source spelled it. */
  src: string;
  alt: string;
  title?: string;
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildImgTag(parts: ImageTagParts, width: number | null): string {
  let tag = `<img src="${escapeAttr(parts.src)}" alt="${escapeAttr(parts.alt)}"`;
  if (parts.title) tag += ` title="${escapeAttr(parts.title)}"`;
  if (width !== null) tag += ` width="${width}"`;
  return `${tag}>`;
}

const IMG_TAG = /^<img(\s[^<>]*)?\/?>$/i;
const WIDTH_ATTR = /\swidth\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/i;

/**
 * Replacement text for the image span, or null when nothing should change
 * (removing a width from plain markdown syntax that never carried one).
 */
export function rewriteImageSpan(spanText: string, parts: ImageTagParts, width: number | null): string | null {
  const trimmed = spanText.trim();
  if (IMG_TAG.test(trimmed)) {
    let tag = trimmed.replace(WIDTH_ATTR, '');
    if (width !== null) tag = tag.replace(/\s*\/?>$/, ` width="${width}">`);
    return tag;
  }
  if (width === null) return null;
  return buildImgTag(parts, width);
}

/** Splice the rewrite into the document; null (no-op) returns the text as-is. */
export function applyImageRewrite(
  source: string,
  start: number,
  end: number,
  parts: ImageTagParts,
  width: number | null
): { text: string; newEnd: number } | null {
  const replacement = rewriteImageSpan(source.slice(start, end), parts, width);
  if (replacement === null) return null;
  // A line-leading <img …> starts a CommonMark HTML block that swallows every
  // following line until a blank one — the image (and the swallowed text)
  // would vanish from the render. Guarantee the blank line.
  let suffix = '';
  const atLineStart = start === 0 || source[start - 1] === '\n';
  if (atLineStart) {
    const after = source.slice(end);
    if (after !== '' && after !== '\n') {
      if (!after.startsWith('\n')) suffix = '\n\n'; // trailing text on the same line
      else if (after[1] !== '\n') suffix = '\n'; // next line is not blank
    }
  }
  return {
    text: source.slice(0, start) + replacement + suffix + source.slice(end),
    newEnd: start + replacement.length,
  };
}
