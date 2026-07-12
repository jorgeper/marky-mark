import type { CommentData } from './anchoring';
import { parseSidecar } from './sidecar';

/**
 * Embedded comment storage (SPEC2 §5): comments live in an invisible HTML
 * comment trailer at the very end of the markdown file:
 *
 *   <!-- markimark-comments
 *   {"version":1,"comments":[ …sidecar schema… ]}
 *   -->
 *
 * HTML comments are stripped by Marky Mark's sanitizer and hidden by GitHub
 * and every mainstream renderer, so the document looks untouched.
 *
 * The "-->" hazard: a comment body containing "-->" would terminate the HTML
 * comment early. serializeTrailer therefore rewrites every "-->" in the JSON
 * text as "-" + "-" + ">" — a plain JSON string escape that JSON.parse
 * restores losslessly. ("-->" can only occur inside JSON string literals, so
 * the blanket replace is safe.) Pure module — no DOM, no platform imports.
 */

const TRAILER_RE = /\n?<!-- markimark-comments\n([\s\S]*?)\n-->\s*$/;

export interface SplitDoc {
  /** Markdown content with the trailer removed (byte-exact otherwise). */
  content: string;
  /** Comments parsed from the trailer; [] when there is no trailer. */
  comments: CommentData[];
  /** True when a trailer block was present (even if it parsed to zero comments). */
  hadTrailer: boolean;
}

/** Split a file's text into markdown content and embedded comments. */
export function splitEmbedded(text: string): SplitDoc {
  const m = TRAILER_RE.exec(text);
  if (!m) return { content: text, comments: [], hadTrailer: false };
  let comments: CommentData[] = [];
  try {
    comments = parseSidecar(m[1]);
  } catch {
    // Unparseable trailer: treat as content-less rather than crashing; the
    // block is still stripped so it never leaks into the editor.
  }
  return { content: text.slice(0, m.index), comments, hadTrailer: true };
}

/** Serialize the trailer block for a comment set ('' when there are none). */
export function serializeTrailer(comments: CommentData[]): string {
  if (comments.length === 0) return '';
  const json = JSON.stringify({ version: 1, comments }, null, 2)
    // Keep the enclosing HTML comment intact even if a body contains "-->".
    .replace(/-->/g, '-\\u002d>');
  return `\n<!-- markimark-comments\n${json}\n-->\n`;
}

/** Compose file text: content + trailer (no trailer for zero comments). */
export function attachEmbedded(content: string, comments: CommentData[]): string {
  const base = splitEmbedded(content).content; // idempotent: never double-attach
  return `${base}${serializeTrailer(comments)}`;
}

/**
 * Merge sidecar and trailer comment sets by id; trailer entries win
 * (SPEC2 FR-C.4). Order: trailer comments first, then sidecar-only ones.
 */
export function mergeComments(trailer: CommentData[], sidecar: CommentData[]): CommentData[] {
  const seen = new Set(trailer.map((c) => c.id));
  return [...trailer, ...sidecar.filter((c) => !seen.has(c.id))];
}
