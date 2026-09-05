import DiffMatchPatch from 'diff-match-patch';

/**
 * Pure anchoring logic, ported from ../md-with-comments (schema-compatible).
 * No DOM dependencies.
 *
 * Coordinate space: character offsets into the document's *rendered plain
 * text* (the concatenation of all DOM text nodes of the rendered markdown,
 * in document order). See ARCHITECTURE.md. This module itself is agnostic —
 * it just works on the string it is given, so unit tests feed it plain
 * strings directly.
 */

export const CONTEXT_LENGTH = 32;

/**
 * diff-match-patch match threshold: 0.0 = exact only, 1.0 = match anything.
 * 0.4 tolerates typo-level edits (a few characters) inside the anchored text
 * while rejecting matches to unrelated passages.
 */
const FUZZY_THRESHOLD = 0.4;

/** How far (in chars) from the expected location a fuzzy match may drift. */
const FUZZY_DISTANCE = 5000;

/** Bitap algorithm limit in diff-match-patch: patterns must be <= 32 chars. */
const MAX_PATTERN = 32;

/**
 * Keys a comment store held that this build does not know (PRD 004 Req 19).
 * Retained per object so a newer minor's fields survive a read → write
 * round-trip verbatim. In-memory only: the field itself is never serialized,
 * only its contents, spliced back in at the level they were read from. Always
 * optional and absent (not empty) when there was nothing unknown, so every
 * construction site elsewhere keeps building the same objects it always did.
 */
export type RetainedKeys = Record<string, unknown>;

export interface Anchor {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
  extra?: RetainedKeys;
}

export interface ReanchorMatch {
  start: number;
  end: number;
  strategy: 'exact' | 'quote' | 'fuzzy';
}

export interface ThreadReply {
  id: string;
  author: string;
  createdAt: string;
  body: string;
  extra?: RetainedKeys;
}

/**
 * PRD 023 §3 (issue #283): the marker colors the comment format admits —
 * exactly these four literals, nothing else. Format 2.0.0 swaps 1.1.0's
 * `blue` for `orange`: blue is the fixed comment tint now, never a highlight
 * hue. The wire-format's own list lives in commentFormat.ts (COMMENT_COLORS),
 * beside the rest of its vocabulary.
 */
export type CommentColor = 'yellow' | 'green' | 'orange' | 'pink';

/**
 * PRD 022 Reqs 1+4: the same vocabulary as a runtime list, in the popup's
 * display order, for callers outside the format seam (the swatch popup, the
 * lastMarkerColor setting) — only the two stores may import commentFormat.
 */
export const MARKER_COLORS: readonly CommentColor[] = ['yellow', 'green', 'orange', 'pink'];

/**
 * PRD 023 §1 (issue #283): the standing-card predicate, re-expressed against
 * the `kind` discriminant — a comment record has a standing panel card, a
 * navigator stop, and reply/resolve; a highlight record has none of those.
 * (It replaces PRD 022's `hasNote` empty-body test: under the kind split, a
 * note IS a comment record.) A type guard, so callers narrow to the branch
 * that actually carries `body`/`thread`/`resolved`.
 */
export function isComment(c: CommentData): c is CommentRecord {
  return c.kind === 'comment';
}

/** The fields both record kinds share (PRD 023 §1, issue #283). */
interface AnnotationBase {
  id: string;
  author: string;
  createdAt: string;
  anchor: Anchor;
  extra?: RetainedKeys;
  /**
   * The comment-format version this record's retained keys came from, so a
   * save can stamp the lowest version that still represents them (PRD Req 21,
   * 23, 24). Set by the seam on read, only for records that retained
   * something; in-memory only, like `extra` itself.
   */
  extraVersion?: string;
}

/**
 * PRD 023 §1 (issue #283): a comment — a note with a thread and a resolve
 * lifecycle, rendered in the one fixed comment tint. No `color`: reading one
 * off a comment is a type error, not a runtime `undefined`.
 */
export interface CommentRecord extends AnnotationBase {
  kind: 'comment';
  body: string;
  resolved: boolean;
  thread: ThreadReply[];
}

/**
 * PRD 023 §1 (issue #283): a highlight — a painted range in one of the four
 * marker colors, always colored, never resolved, never threaded. No `body`:
 * reading one off a highlight is a type error.
 */
export interface HighlightRecord extends AnnotationBase {
  kind: 'highlight';
  color: CommentColor;
}

/**
 * One stored annotation: the PRD 023 §1 discriminated union on `kind`
 * (issue #283). The name survives the split — every store, seam and caller
 * already traffics in `CommentData` sets.
 */
export type CommentData = CommentRecord | HighlightRecord;

export function createAnchor(text: string, start: number, end: number): Anchor {
  if (start < 0 || end > text.length || end < start) {
    throw new Error(`invalid anchor range ${start}..${end} for text of length ${text.length}`);
  }
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, Math.min(text.length, end + CONTEXT_LENGTH)),
    start,
    end,
  };
}

/** Find every index at which `needle` occurs in `haystack`. */
function allIndexes(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return out;
}

/** Length of the longest common suffix of a and b (used for prefix context). */
function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** Length of the longest common prefix of a and b (used for suffix context). */
function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Score a candidate occurrence of `exact` at `index` by how well the stored
 * prefix/suffix context agrees with the text around that occurrence.
 */
function contextScore(anchor: Anchor, text: string, index: number): number {
  const before = text.slice(Math.max(0, index - CONTEXT_LENGTH), index);
  const after = text.slice(index + anchor.exact.length, index + anchor.exact.length + CONTEXT_LENGTH);
  return commonSuffixLength(before, anchor.prefix) + commonPrefixLength(after, anchor.suffix);
}

function fuzzyMatch(anchor: Anchor, text: string): ReanchorMatch | null {
  const dmp = new DiffMatchPatch();
  dmp.Match_Threshold = FUZZY_THRESHOLD;
  dmp.Match_Distance = FUZZY_DISTANCE;
  const { exact, start, end } = anchor;

  if (exact.length <= MAX_PATTERN) {
    const loc = dmp.match_main(text, exact, start);
    if (loc === -1) return null;
    return { start: loc, end: Math.min(text.length, loc + exact.length), strategy: 'fuzzy' };
  }

  // Long selections exceed bitap's 32-char pattern limit, so locate the head
  // and tail of the exact text independently and stitch the range together.
  const head = exact.slice(0, MAX_PATTERN);
  const tail = exact.slice(-MAX_PATTERN);
  const headLoc = dmp.match_main(text, head, start);
  if (headLoc === -1) return null;
  const tailLoc = dmp.match_main(text, tail, end - MAX_PATTERN);
  if (tailLoc !== -1 && tailLoc + MAX_PATTERN > headLoc) {
    const matchEnd = tailLoc + MAX_PATTERN;
    // Reject if the stitched range is wildly different in size from the
    // original selection — that means head and tail matched unrelated spots.
    const len = matchEnd - headLoc;
    if (len <= exact.length * 2 && len >= exact.length / 2) {
      return { start: headLoc, end: matchEnd, strategy: 'fuzzy' };
    }
  }
  return {
    start: headLoc,
    end: Math.min(text.length, headLoc + exact.length),
    strategy: 'fuzzy',
  };
}

/**
 * PRD 022 Req 12 (issue #234): one editor-pane highlight — the entry's id
 * and color riding a SOURCE-offset range the exact quote confidently maps
 * to. The editor paints these as background decorations; color absent means
 * the fixed comment tint (issue #283), like the preview's mark.
 */
export interface SourceHighlight {
  id: string;
  from: number;
  to: number;
  color?: CommentColor;
}

/**
 * PRD 022 Req 12 (issue #234): best-effort mapping of rendered-text anchors
 * onto markdown SOURCE ranges for editor-pane painting. Anchors live in
 * rendered-plain-text space; the editor shows source — so only an exact
 * occurrence of `anchor.exact` in the source counts. A unique occurrence
 * maps; zero map nothing (rendered text that crosses markdown syntax is
 * simply absent); several map only when the stored context picks ONE
 * strictly best-scoring occurrence — a tie, or no context agreement at
 * all, skips. Skipping is the contract: a highlight the source cannot
 * place confidently does not paint, and is never guessed at.
 *
 * PRD 023 §1 (issue #283): both record kinds paint — a highlight rides its
 * required color; a comment record carries none, which the editor renders
 * as the fixed comment tint (the role `color: undefined` always had).
 */
export function mapHighlightsToSource(
  entries: readonly CommentData[],
  source: string
): SourceHighlight[] {
  const out: SourceHighlight[] = [];
  for (const e of entries) {
    const { exact } = e.anchor;
    if (!exact) continue;
    const occurrences = allIndexes(source, exact);
    let at: number | null = occurrences.length === 1 ? occurrences[0] : null;
    if (occurrences.length > 1) {
      let best: number | null = null;
      let bestScore = 0; // a winner must agree with SOME context, not just win a 0–0
      let tied = false;
      for (const idx of occurrences) {
        const score = contextScore(e.anchor, source, idx);
        if (score > bestScore) {
          best = idx;
          bestScore = score;
          tied = false;
        } else if (score === bestScore) {
          tied = true;
        }
      }
      at = tied ? null : best;
    }
    if (at === null) continue;
    out.push({ id: e.id, from: at, to: at + exact.length, ...(e.kind === 'highlight' ? { color: e.color } : {}) });
  }
  return out;
}

/**
 * Re-anchoring cascade (SPEC FR-7.5):
 *  1. exact text found at the stored offsets;
 *  2. unique quote search, using prefix/suffix context to disambiguate
 *     multiple occurrences;
 *  3. fuzzy match via diff-match-patch (threshold documented above);
 *  4. null — the caller should treat the comment as orphaned.
 */
export function reanchor(anchor: Anchor, text: string): ReanchorMatch | null {
  const { exact, start, end } = anchor;
  if (!exact) return null;

  // Step 1: exact match at stored offsets.
  if (text.slice(start, end) === exact) {
    return { start, end, strategy: 'exact' };
  }

  // Step 2: quote search across the whole document.
  const occurrences = allIndexes(text, exact);
  if (occurrences.length === 1) {
    return { start: occurrences[0], end: occurrences[0] + exact.length, strategy: 'quote' };
  }
  if (occurrences.length > 1) {
    let best = occurrences[0];
    let bestScore = -1;
    for (const idx of occurrences) {
      const score = contextScore(anchor, text, idx);
      const closer = Math.abs(idx - start) < Math.abs(best - start);
      if (score > bestScore || (score === bestScore && closer)) {
        best = idx;
        bestScore = score;
      }
    }
    return { start: best, end: best + exact.length, strategy: 'quote' };
  }

  // Step 3: fuzzy match.
  return fuzzyMatch(anchor, text);
}
