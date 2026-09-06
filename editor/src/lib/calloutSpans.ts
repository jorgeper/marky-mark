/**
 * Issue #318: the edit-pane callout view's pure core, in the linkSpans.ts
 * two-file shape — span computation here, view wiring in
 * src/components/calloutView.ts. With the `calloutView` setting on, a
 * callout blockquote reads in the editor as it does in the preview: every
 * line of the block carries the kind's tint and accent edge, and the
 * `[!KIND]` marker gives way to the kind's label as PURE DECORATION (nothing
 * here ever changes document text, history or the dirty state).
 *
 * Scope boundary: the SAME rule the preview transform applies
 * (lib/callouts.ts) — a Lezer `Blockquote` whose first line is exactly the
 * quote mark plus a recognised marker. A nested blockquote inside a callout
 * is left to its parent's tint (one line, one tint), and a blockquote whose
 * marker is not alone on its first line, or names an unknown kind, is not a
 * callout: it keeps the plain quote styling it has today.
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { VisibleRange } from './livePreview';
import type { Span } from './codeBlockSpans';
import { calloutKindOf } from './callouts';
import type { CalloutKind } from './smartEdit';

/** One callout block's decoration inputs. */
export interface CalloutView {
  /** The whole Blockquote node. */
  from: number;
  to: number;
  kind: CalloutKind;
  /** 1-based document line numbers of the block's first and last lines. */
  firstLine: number;
  lastLine: number;
  /** The `[!KIND]` marker's span on the first line — replaced by the label. */
  marker: Span;
  /** Caret/selection touches the marker line — it shows raw (tint stays). */
  revealed: boolean;
}

/**
 * The first line of a blockquote, as a callout marker line: the quote mark,
 * at most one blank, the marker, trailing blanks only. Group 1 is the kind.
 */
const MARKER_LINE = /^>[ \t]?\[!([A-Za-z]+)\][ \t]*$/;

/**
 * Every callout blockquote in the visible ranges as a view spec. Reveal
 * rule: when the caret or ANY part of the selection touches the marker's
 * line (boundaries inclusive, the codeBlockSpans convention) the marker
 * shows raw and stays editable in place; the block's tint never lifts, so
 * the block reads as one object while its kind is being retyped.
 * `excluded` spans (the SPEC40 table-grid regions) drop a block that
 * overlaps them, the guard every view sibling applies via tableModeField.
 */
export function computeCalloutViews(
  state: EditorState,
  visibleRanges: readonly VisibleRange[],
  excluded: readonly Span[] = []
): CalloutView[] {
  const out: CalloutView[] = [];
  const doc = state.doc;
  const ranges = state.selection.ranges;
  const tree = syntaxTree(state);
  const seen = new Set<number>();
  for (const vr of visibleRanges) {
    tree.iterate({
      from: vr.from,
      to: vr.to,
      enter(n) {
        if (n.name !== 'Blockquote') return;
        // Never descend: a callout's inner blockquotes ride its tint, and a
        // plain quote's inner callouts would double-paint the shared lines.
        if (seen.has(n.from)) return false;
        seen.add(n.from);
        if (excluded.some((s) => n.from < s.to && n.to > s.from)) return false;
        const first = doc.lineAt(n.from);
        const head = first.text.slice(n.from - first.from);
        const m = MARKER_LINE.exec(head);
        const kind = m ? calloutKindOf(m[1]) : null;
        if (!m || !kind) return false;
        const markerFrom = n.from + head.indexOf('[!');
        const marker = { from: markerFrom, to: markerFrom + m[1].length + 3 };
        // A Blockquote node can end on the newline that closes its last
        // line; the block's last line is the last one it has text on.
        const endLine = doc.lineAt(n.to);
        const lastLine = n.to === endLine.from && n.to > n.from ? endLine.number - 1 : endLine.number;
        const revealed = ranges.some((r) => r.from <= first.to && r.to >= first.from);
        out.push({ from: n.from, to: n.to, kind, firstLine: first.number, lastLine, marker, revealed });
        return false;
      },
    });
  }
  return out.sort((a, b) => a.from - b.from);
}
