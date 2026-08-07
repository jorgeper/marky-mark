/**
 * PRD 011 Req 22: without a configured provider every zoom level still works —
 * each section shows a deterministic excerpt (its opening sentences or first
 * lines, truncated) in place of a summary, and the result is tagged as an
 * excerpt so the view can say plainly that it is not a summary.
 *
 * PRD 011 Req 34: pure and deterministic — the same body always yields the
 * same excerpt. No clock, no randomness, no locale-dependent formatting.
 */

export interface Excerpt {
  /** Always `'excerpt'`: never presented as an LLM summary (Req 22). */
  kind: 'excerpt';
  text: string;
  /** True when quotable text was dropped to fit `maxLength`. */
  truncated: boolean;
  /** True when the body held nothing quotable and `text` is the placeholder. */
  placeholder: boolean;
}

/** Bound on an excerpt, in characters, before the ellipsis is appended. */
export const EXCERPT_MAX_LENGTH = 240;

/** Shown when a section body has no prose to quote (never an empty string). */
export const EXCERPT_PLACEHOLDER = 'No text to excerpt in this section.';

const ELLIPSIS = '…';

const FENCE = /^\s{0,3}(?:```|~~~)/;
const THEMATIC_BREAK = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_ROW = /^\s*\|/;
const HTML_LINE = /^\s{0,3}</;
const HEADING = /^\s{0,3}#{1,6}\s/;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
const QUOTE_MARKER = /^\s*(?:>\s?)+/;

/** Strip inline markdown noise, leaving the words a reader would say aloud. */
function stripInline(text: string): string {
  return (
    text
      // Images reduce to their alt text; links reduce to their link text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
      .replace(/<((?:https?|mailto):[^>]+)>/g, '$1')
      // Inline code keeps its text, loses its backticks.
      .replace(/`+([^`]*)`+/g, '$1')
      // Emphasis, strong and strikethrough unwrap.
      .replace(/(\*\*\*|___)(.+?)\1/g, '$2')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(\*|_)(.+?)\1/g, '$2')
      .replace(/~~(.+?)~~/g, '$1')
      // Backslash escapes surrender to the character they protect.
      .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Quotable prose from a section body: fenced code and tables are skipped
 * rather than emitted raw, list and blockquote markers are dropped, and the
 * remaining lines are flattened to a single paragraph.
 */
function quotableText(body: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const raw of body.split('\n')) {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (raw.trim() === '') continue;
    if (TABLE_ROW.test(raw) || THEMATIC_BREAK.test(raw) || HTML_LINE.test(raw) || HEADING.test(raw)) continue;
    const line = stripInline(raw.replace(QUOTE_MARKER, '').replace(LIST_MARKER, ''));
    if (line !== '') out.push(line);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** Split into sentences, keeping their terminators. */
function sentences(text: string): string[] {
  return text.match(/[^.!?]+(?:[.!?]+(?:["'”’)\]]+)?|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

/**
 * PRD 011 Req 22: the deterministic stand-in for a summary. Whole sentences
 * are kept while they fit; a first sentence longer than the bound is cut at a
 * word boundary. Either way the cut is marked with an explicit ellipsis.
 */
export function excerptFromBody(body: string, maxLength: number = EXCERPT_MAX_LENGTH): Excerpt {
  const limit = Math.max(1, Math.floor(maxLength));
  const text = quotableText(body ?? '');
  if (text === '') {
    return { kind: 'excerpt', text: EXCERPT_PLACEHOLDER, truncated: false, placeholder: true };
  }
  if (text.length <= limit) {
    return { kind: 'excerpt', text, truncated: false, placeholder: false };
  }

  const parts = sentences(text);
  let kept = '';
  for (const part of parts) {
    const next = kept === '' ? part : `${kept} ${part}`;
    if (next.length > limit) break;
    kept = next;
  }
  if (kept === '') {
    // The opening sentence alone overruns: cut it at the last word boundary.
    const head = text.slice(0, limit);
    const space = head.lastIndexOf(' ');
    kept = (space > 0 ? head.slice(0, space) : head).replace(/[\s,;:]+$/, '');
  }
  return { kind: 'excerpt', text: `${kept}${ELLIPSIS}`, truncated: true, placeholder: false };
}
