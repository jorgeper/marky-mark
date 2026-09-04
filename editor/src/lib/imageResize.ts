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

function buildImgTag(parts: ImageTagParts, width: number | null, height: number | null = null): string {
  let tag = `<img src="${escapeAttr(parts.src)}" alt="${escapeAttr(parts.alt)}"`;
  if (parts.title) tag += ` title="${escapeAttr(parts.title)}"`;
  if (width !== null) tag += ` width="${width}"`;
  if (height !== null) tag += ` height="${height}"`;
  return `${tag}>`;
}

const IMG_TAG = /^<img(\s[^<>]*)?\/?>$/i;
const WIDTH_ATTR = /\swidth\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/i;
const HEIGHT_ATTR = /\sheight\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/i;

/**
 * Replacement text for the image span, or null when nothing should change
 * (removing a size from plain markdown syntax that never carried one).
 * SPEC41 §5.2: the optional `height` joins width with the same idempotence
 * rules; omitting it keeps the SPEC20 behavior byte-identical (U45/U46).
 */
export function rewriteImageSpan(
  spanText: string,
  parts: ImageTagParts,
  width: number | null,
  height?: number | null
): string | null {
  const trimmed = spanText.trim();
  const h = height === undefined ? null : height;
  const touchHeight = height !== undefined;
  if (IMG_TAG.test(trimmed)) {
    let tag = trimmed.replace(WIDTH_ATTR, '');
    if (touchHeight) tag = tag.replace(HEIGHT_ATTR, '');
    if (width !== null) tag = tag.replace(/\s*\/?>$/, ` width="${width}">`);
    if (touchHeight && h !== null) tag = tag.replace(/\s*\/?>$/, ` height="${h}">`);
    return tag;
  }
  if (width === null && (!touchHeight || h === null)) return null;
  return buildImgTag(parts, width, touchHeight ? h : null);
}

/** Splice the rewrite into the document; null (no-op) returns the text as-is. */
export function applyImageRewrite(
  source: string,
  start: number,
  end: number,
  parts: ImageTagParts,
  width: number | null,
  height?: number | null
): { text: string; newEnd: number } | null {
  const replacement = rewriteImageSpan(source.slice(start, end), parts, width, height);
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

// ---------------------------------------------------------------------------
// SPEC41 §5.1: the image-reference scan.

export interface ImageRef {
  start: number;
  end: number;
  kind: 'md' | 'html';
  src: string;
  alt: string;
  title?: string;
  width?: number;
  height?: number;
}

const MD_IMAGE = /!\[([^\]\n]*)\]\(([^)\s\n]*)(?:\s+"([^"\n]*)")?\)/g;
const HTML_IMAGE = /<img\s[^<>\n]*>/gi;
const ATTR = /([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function decodeEntities(v: string): string {
  return v
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Every image reference in document order — inline markdown and <img> tags. */
export function allImageRefs(text: string): ImageRef[] {
  const out: ImageRef[] = [];
  MD_IMAGE.lastIndex = 0;
  for (let m = MD_IMAGE.exec(text); m; m = MD_IMAGE.exec(text)) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'md',
      src: m[2],
      alt: m[1],
      ...(m[3] !== undefined ? { title: m[3] } : {}),
    });
  }
  HTML_IMAGE.lastIndex = 0;
  for (let m = HTML_IMAGE.exec(text); m; m = HTML_IMAGE.exec(text)) {
    const attrs: Record<string, string> = {};
    const body = m[0].slice(4, -1);
    ATTR.lastIndex = 0;
    for (let a = ATTR.exec(body); a; a = ATTR.exec(body)) {
      if (a.index === ATTR.lastIndex) ATTR.lastIndex++;
      attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
    }
    if (!attrs.src) continue;
    const width = /^\d+$/.test(attrs.width ?? '') ? Number(attrs.width) : undefined;
    const height = /^\d+$/.test(attrs.height ?? '') ? Number(attrs.height) : undefined;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'html',
      src: attrs.src,
      alt: attrs.alt ?? '',
      ...(attrs.title ? { title: attrs.title } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * SPEC41 §1.3: remove the image reference at `offset` — a reference alone on
 * its line takes the line (and one separating blank line) with it. Null when
 * the offset is not on a reference.
 */
export function deleteImageAt(text: string, offset: number): { text: string; from: number; to: number } | null {
  const ref = allImageRefs(text).find((r) => offset >= r.start && offset <= r.end);
  if (!ref) return null;
  let lineStart = text.lastIndexOf('\n', ref.start - 1) + 1;
  if (ref.start === 0) lineStart = 0;
  let lineEnd = text.indexOf('\n', ref.end);
  if (lineEnd === -1) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);
  const alone = line.trim() === text.slice(ref.start, ref.end).trim();
  let start = ref.start;
  let end = ref.end;
  if (alone) {
    start = lineStart;
    end = lineEnd;
    if (text[end] === '\n') end += 1; // the line's own newline
    // The one-blank-line cleanup prefers the blank BEFORE the reference —
    // the resulting text is identical, but the deleted range stays clear of
    // anything that follows (a SPEC40 grid span starting on the next line
    // would otherwise see an abutting change and cancel it).
    const prevBlank = start >= 1 && text[start - 1] === '\n' && (start === 1 || text[start - 2] === '\n');
    if (prevBlank) start -= 1;
    else if (text[end] === '\n') end += 1;
  }
  return { text: text.slice(0, start) + text.slice(end), from: start, to: start };
}
