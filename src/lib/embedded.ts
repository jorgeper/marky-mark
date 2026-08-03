import type { CommentData } from './anchoring';
import { commentPayload, readCommentPayload } from './commentFormat';

/**
 * Embedded comment storage (SPEC2 §5): comments live in an invisible HTML
 * comment trailer at the very end of the markdown file:
 *
 *   <!-- marky-mark-comments
 *   {"version":"1.0.0","comments":[ …sidecar schema… ]}
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

// SPEC32 §2: the marker renamed at 0.4 — new files write marky-mark-comments,
// but legacy markimark-comments trailers still parse (first save migrates).
const TRAILER_RE = /\n?<!-- (?:marky-mark|markimark)-comments\n([\s\S]*?)\n-->\s*$/;

export interface SplitDoc {
  /** Markdown content with the trailer removed (byte-exact otherwise). */
  content: string;
  /** Comments parsed from the trailer; [] when there is no trailer. */
  comments: CommentData[];
  /** True when a trailer block was present (even if it parsed to zero comments). */
  hadTrailer: boolean;
  /**
   * False when a trailer was present but this build could not interpret it —
   * an unsupported version (PRD Req 12) or JSON that does not parse. True
   * whenever there was no trailer at all: nothing there is not unreadable.
   * What the app does about it (indication, byte preservation) is issue #16.
   */
  readable: boolean;
  /** Set only when `readable` is false: the version exactly as declared. */
  declaredVersion?: unknown;
  /**
   * The trailer block exactly as found — marker, JSON text, whitespace and
   * all — so `content + trailerBytes` reproduces the input byte-for-byte.
   * Set whenever `hadTrailer` is true; it is what an unreadable trailer is
   * re-emitted from (PRD 004 Req 14).
   */
  trailerBytes?: string;
}

/** Split a file's text into markdown content and embedded comments. */
export function splitEmbedded(text: string): SplitDoc {
  const m = TRAILER_RE.exec(text);
  if (!m) return { content: text, comments: [], hadTrailer: false, readable: true };
  const content = text.slice(0, m.index);
  const trailerBytes = text.slice(m.index); // the whole match, whitespace included
  let payload: unknown;
  try {
    payload = JSON.parse(m[1]);
  } catch {
    // Unparseable trailer: treat as content-less rather than crashing; the
    // block is still stripped so it never leaks into the editor.
    return { content, comments: [], hadTrailer: true, readable: false, trailerBytes };
  }
  const read = readCommentPayload(payload); // never throws, by the seam's contract
  if (!read.supported) {
    return {
      content,
      comments: [],
      hadTrailer: true,
      readable: false,
      declaredVersion: read.declaredVersion,
      trailerBytes,
    };
  }
  return { content, comments: read.comments, hadTrailer: true, readable: true, trailerBytes };
}

/** Serialize the trailer block for a comment set ('' when there are none). */
export function serializeTrailer(comments: CommentData[]): string {
  if (comments.length === 0) return ''; // PRD Req 28: no trailer, not an empty versioned one
  const json = JSON.stringify(commentPayload(comments), null, 2)
    // Keep the enclosing HTML comment intact even if a body contains "-->".
    .replace(/-->/g, '-\\u002d>');
  return `\n<!-- marky-mark-comments\n${json}\n-->\n`;
}

/**
 * Compose file text: content + trailer (no trailer for zero comments).
 *
 * `preserved` (PRD 004 Req 14) re-emits an unreadable trailer's original
 * bytes verbatim instead of serializing `comments`: a document this build
 * cannot interpret keeps its comment payload bit-identical across any number
 * of saves. Idempotent either way — an already-attached trailer is stripped
 * before the new one goes on, so the trailer is never doubled.
 */
export function attachEmbedded(content: string, comments: CommentData[], preserved?: string | null): string {
  const base = splitEmbedded(content).content; // idempotent: never double-attach
  return `${base}${preserved ?? serializeTrailer(comments)}`;
}

/**
 * Merge sidecar and trailer comment sets by id; trailer entries win
 * (SPEC2 FR-C.4). Order: trailer comments first, then sidecar-only ones.
 */
export function mergeComments(trailer: CommentData[], sidecar: CommentData[]): CommentData[] {
  const seen = new Set(trailer.map((c) => c.id));
  return [...trailer, ...sidecar.filter((c) => !seen.has(c.id))];
}
