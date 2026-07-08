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

export interface Anchor {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
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
}

export interface CommentData {
  id: string;
  author: string;
  createdAt: string;
  body: string;
  resolved: boolean;
  thread: ThreadReply[];
  anchor: Anchor;
}

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
