/**
 * SPEC23 §3 (issue #123): where the selection tint has to be re-painted.
 *
 * CodeMirror draws its selection (SPEC24 §5's `drawSelection()`) into a layer
 * *behind* `.cm-content`, so any inline span carrying its own background —
 * `.mm-md-code`, `.mm-lp-code` — paints over it. Nearly every bundled theme
 * sets `--mm-code-bg` to a fully opaque colour, so a selection inside a code
 * construct was invisible. The editor fixes that by marking the selected part
 * of each code construct and tinting *that* span, which nests inside the code
 * span and therefore paints above its background and below its text.
 *
 * This module is the pure half: the range arithmetic, with no CodeMirror
 * types in sight, so it can be unit-tested on its own.
 */

/** A half-open `[from, to)` document range. */
export interface CodeRange {
  from: number;
  to: number;
}

/**
 * The parts of `sel` that fall inside `code`, sorted and merged.
 *
 * Inputs may arrive unsorted and with duplicates — the syntax tree is walked
 * once per visible range, so a code node spanning two of them is reported
 * twice. Empty overlaps are dropped: a zero-length mark decoration is not
 * something a `RangeSetBuilder` accepts.
 */
export function intersectCodeSelection(
  code: readonly CodeRange[],
  sel: readonly CodeRange[],
): CodeRange[] {
  const out: CodeRange[] = [];
  for (const c of code) {
    for (const s of sel) {
      const from = Math.max(c.from, s.from);
      const to = Math.min(c.to, s.to);
      if (from < to) out.push({ from, to });
    }
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: CodeRange[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else merged.push({ ...r });
  }
  return merged;
}
