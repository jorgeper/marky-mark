/**
 * Issue #341: the editor-pane activation gesture — a ⌘ (macOS) / Ctrl click
 * over a painted comment/highlight range reports the ids of EVERY range
 * covering the position (document order) to the owner and claims the event.
 * It is the SPEC43 §11 link gesture (linkViewMousedown) applied to painted
 * ranges: the same `metaKey || ctrlKey` predicate, the same resolution
 * through the document offset under the pointer, the same preventDefault —
 * so CodeMirror neither moves the caret nor adds a second cursor (its
 * default clickAddsSelectionRange is that very modifier). A plain click
 * returns false and reports nothing: caret placement only. Text that is
 * both a link and a painted range belongs to the link handler — this one
 * yields (never claims, never reports) so exactly one thing happens: the
 * link opens, whatever order the two handlers run in.
 *
 * A pure factory (the linkViewMousedown / U1159 shape): the painted ranges
 * and the owner callback are read per call, so a unit test drives it with
 * plain objects and no browser, and callback identity churn never rebuilds
 * the extension.
 */
import type { EditorState } from '@codemirror/state';
import { linkAt } from '../lib/linkSpans';

/** A painted range in EDITOR-document offsets (the owner's canonical offsets already mapped). */
export interface PaintedRange {
  id: string;
  from: number;
  to: number;
}

export function highlightViewMousedown(
  painted: (state: EditorState) => readonly PaintedRange[],
  onHit: () => ((ids: readonly string[]) => void) | undefined
) {
  return (
    event: {
      metaKey: boolean;
      ctrlKey: boolean;
      clientX: number;
      clientY: number;
      preventDefault(): void;
    },
    view: {
      posAtCoords(coords: { x: number; y: number }): number | null;
      state: EditorState;
    }
  ): boolean => {
    if (!event.metaKey && !event.ctrlKey) return false;
    const report = onHit();
    if (!report) return false; // absent ⇒ painting is display-only
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    if (linkAt(view.state, pos)) return false; // the link gesture keeps precedence
    // PRD 023 §5 (issue #285): overlapping records stack — report EVERY
    // painted range covering the position and let the owner's kind-aware
    // rule pick, instead of whichever range the array yields first.
    const hits = painted(view.state).filter((h) => pos >= h.from && pos <= h.to);
    if (hits.length === 0) return false;
    event.preventDefault();
    report(hits.map((h) => h.id));
    return true;
  };
}
