// PRD 016 Req 8: the three-way line merge a stale conditional save runs
// through, as a PURE module — no I/O and no provider import.
// It answers one question and nothing else: given the version the client
// loaded (`base`), the client's text (`ours`) and what the branch now holds
// (`theirs`), is there a single text that carries both sides' changes?
//
// Deliberately conservative: when the two sides touched the same stretch of
// the base differently, the answer is "conflicts" and the caller answers 412.
// A wrong clean merge silently destroys someone's work; an unnecessary
// conflict only shows the dialog that already exists.
//
// PRD 016 Req 8: no new runtime dependency — `diff-match-patch` is already a
// dependency and `src/lib/diffLines.ts` is the in-repo precedent for driving
// its line mode.

import DiffMatchPatch from 'diff-match-patch';

/** A clean merge carries its text; a conflict carries nothing to commit. */
export type MergeResult = { clean: true; text: string } | { clean: false };

// One instance for the module, as `diffLines.ts` does: it holds only the
// algorithm's settings, never per-diff state.
const dmp = new DiffMatchPatch();

/**
 * Lines keep their own terminator, so joining is concatenation and a line
 * neither side touched is copied back byte-for-byte. That is what makes the
 * merge newline-faithful: a file with no trailing newline keeps none, and a
 * CRLF line nobody edited stays CRLF.
 */
function splitLines(text: string): string[] {
  return text === '' ? [] : (text.match(/[^\n]*\n|[^\n]+/g) ?? []);
}

/** One stretch of `base` a side replaced with `lines` (either may be empty). */
interface Change {
  baseStart: number;
  /** Exclusive. Equal to `baseStart` for a pure insertion at that point. */
  baseEnd: number;
  lines: string[];
}

/**
 * `base` → `other` as a list of replaced base regions. Built from
 * diff-match-patch's line mode (the same three calls `diffLines.ts` makes),
 * with adjacent delete/insert runs folded into one region so a rewritten
 * paragraph is one change rather than two.
 */
function changesFrom(base: string, other: string): Change[] {
  const { chars1, chars2, lineArray } = dmp.diff_linesToChars_(base, other);
  const diffs = dmp.diff_main(chars1, chars2, false) as Array<[number, string]>;
  dmp.diff_charsToLines_(diffs, lineArray);

  const changes: Change[] = [];
  let baseIndex = 0;
  let pending: Change | null = null;
  for (const [op, text] of diffs) {
    const lines = splitLines(text);
    if (op === 0) {
      if (pending) {
        changes.push(pending);
        pending = null;
      }
      baseIndex += lines.length;
      continue;
    }
    pending ??= { baseStart: baseIndex, baseEnd: baseIndex, lines: [] };
    if (op === -1) {
      baseIndex += lines.length;
      pending.baseEnd = baseIndex;
    } else {
      pending.lines.push(...lines);
    }
  }
  if (pending) changes.push(pending);
  return changes;
}

/** Apply one side's changes to `base[start,end)` — that side's version of it. */
function render(group: Change[], baseLines: string[], start: number, end: number): string[] {
  const out: string[] = [];
  let at = start;
  for (const change of group) {
    out.push(...baseLines.slice(at, change.baseStart));
    out.push(...change.lines);
    at = change.baseEnd;
  }
  out.push(...baseLines.slice(at, end));
  return out;
}

/**
 * PRD 016 Req 8: the merge decision. Clean when every region of the base
 * was rewritten by at most one side — or by both sides identically — and a
 * conflict otherwise.
 *
 * The decision is symmetric in `ours`/`theirs` by construction: regions are
 * grown to a fixpoint over both sides at once and resolved by comparing the
 * two renderings, so swapping the arguments can never flip clean ↔ conflict.
 */
export function mergeThreeWay(base: string, ours: string, theirs: string): MergeResult {
  // Both saved the same text; nobody changed anything; only one side moved.
  // Each of these is answered without a diff, and each is trivially clean.
  if (ours === theirs) return { clean: true, text: ours };
  if (base === ours) return { clean: true, text: theirs };
  if (base === theirs) return { clean: true, text: ours };

  const baseLines = splitLines(base);
  const ourChanges = changesFrom(base, ours);
  const theirChanges = changesFrom(base, theirs);

  /** Where a side's next unconsumed change starts; past the end when it has none. */
  const nextStart = (changes: Change[], at: number): number =>
    at < changes.length ? changes[at].baseStart : Number.MAX_SAFE_INTEGER;

  const out: string[] = [];
  let copied = 0;
  let o = 0;
  let t = 0;
  while (o < ourChanges.length || t < theirChanges.length) {
    const start = Math.min(nextStart(ourChanges, o), nextStart(theirChanges, t));
    out.push(...baseLines.slice(copied, start));

    // Grow the region to a fixpoint. Two changes belong together when one
    // reaches INTO the other's base lines (`baseStart < end`) — regions that
    // merely touch end-to-end are left as separate, independently clean
    // regions. The `baseStart === start` arm is what seeds the region, and is
    // also what makes two insertions at the very same point — which overlap
    // in no base line at all, yet are plainly rival edits — meet each other.
    let end = start;
    const ourGroup: Change[] = [];
    const theirGroup: Change[] = [];
    const reaches = (change: Change): boolean => change.baseStart < end || change.baseStart === start;
    for (let grew = true; grew; ) {
      grew = false;
      while (o < ourChanges.length && reaches(ourChanges[o])) {
        end = Math.max(end, ourChanges[o].baseEnd);
        ourGroup.push(ourChanges[o]);
        o += 1;
        grew = true;
      }
      while (t < theirChanges.length && reaches(theirChanges[t])) {
        end = Math.max(end, theirChanges[t].baseEnd);
        theirGroup.push(theirChanges[t]);
        t += 1;
        grew = true;
      }
    }

    if (theirGroup.length === 0) out.push(...render(ourGroup, baseLines, start, end));
    else if (ourGroup.length === 0) out.push(...render(theirGroup, baseLines, start, end));
    else {
      const ourText = render(ourGroup, baseLines, start, end).join('');
      const theirText = render(theirGroup, baseLines, start, end).join('');
      if (ourText !== theirText) return { clean: false };
      out.push(ourText);
    }
    copied = end;
  }
  out.push(...baseLines.slice(copied));
  return { clean: true, text: out.join('') };
}
