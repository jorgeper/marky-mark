/**
 * PRD 006 §3/§8/§9/§13: the live-preview decoration core — a pure function
 * of document state (text + syntax tree + selection) and the view's visible
 * ranges to plain decoration specs: which marker characters to hide and
 * which content spans to style. Nothing here touches the DOM or the
 * document; the ViewPlugin in src/components/livePreview.ts maps these
 * specs onto CodeMirror decorations. Later sub-issues (#48 blocks, #49
 * checkboxes) extend the node tables below rather than replacing the walk.
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Text } from '@codemirror/state';

export type InlineStyle = 'strong' | 'emphasis' | 'strikethrough' | 'inline-code';

export type LivePreviewDeco =
  | { from: number; to: number; deco: 'hide' }
  | { from: number; to: number; deco: 'style'; style: InlineStyle };

export interface VisibleRange {
  readonly from: number;
  readonly to: number;
}

/**
 * PRD 006 §3: the inline constructs that render styled with their markers
 * hidden, keyed by Lezer node name → the style to paint and the marker
 * child node whose characters vanish.
 */
const INLINE_NODES: Record<string, { style: InlineStyle; marker: string }> = {
  StrongEmphasis: { style: 'strong', marker: 'EmphasisMark' },
  Emphasis: { style: 'emphasis', marker: 'EmphasisMark' },
  Strikethrough: { style: 'strikethrough', marker: 'StrikethroughMark' },
  InlineCode: { style: 'inline-code', marker: 'CodeMark' },
};

/** PRD 006 §8: block constructs that cannot reveal line-by-line. */
const ATOMIC_BLOCKS = new Set(['FencedCode', 'CodeBlock']);

/**
 * PRD 006 §8: a construct that must reveal whole — an atomic block, or an
 * inline construct whose span crosses a line break (its markers sit on
 * different lines, so a partial reveal would orphan one of them).
 */
function revealsWhole(name: string, doc: Text, from: number, to: number): boolean {
  if (ATOMIC_BLOCKS.has(name)) return true;
  return name in INLINE_NODES && doc.lineAt(from).number !== doc.lineAt(to).number;
}

/** Sort by start and merge overlapping or touching ranges into one. */
function mergeRanges(ranges: { from: number; to: number }[]): { from: number; to: number }[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: { from: number; to: number }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else out.push({ from: r.from, to: r.to });
  }
  return out;
}

/**
 * PRD 006 §8: the reveal rule. The raw-markdown regions for the current
 * selection: every line a selection range touches (a cursor is an empty
 * range — its line), grown to whole constructs where line-by-line reveal is
 * impossible (code fences/blocks, inline spans crossing a newline), until
 * stable. Returned merged and sorted; offsets are full-line spans.
 */
export function revealedRanges(state: EditorState): { from: number; to: number }[] {
  const doc = state.doc;
  const tree = syntaxTree(state);
  let ranges = state.selection.ranges.map((r) => ({
    from: doc.lineAt(r.from).from,
    to: doc.lineAt(r.to).to,
  }));
  // Growing can pull in a construct that overlaps yet another line, so
  // repeat until a pass changes nothing. Work stays proportional to the
  // revealed region, never the document (PRD 006 §13).
  let grew: boolean;
  do {
    grew = false;
    for (const r of ranges) {
      tree.iterate({
        from: r.from,
        to: r.to,
        enter(n) {
          if (!revealsWhole(n.name, doc, n.from, n.to)) return;
          const from = doc.lineAt(n.from).from;
          const to = doc.lineAt(n.to).to;
          if (from < r.from || to > r.to) {
            r.from = Math.min(r.from, from);
            r.to = Math.max(r.to, to);
            grew = true;
          }
        },
      });
    }
    if (grew) ranges = mergeRanges(ranges);
  } while (grew);
  return mergeRanges(ranges);
}

/**
 * PRD 006 §3/§8/§13: decoration specs for the visible ranges only. Inline
 * constructs outside every revealed region get a style span over the whole
 * construct and a hide span per marker; constructs overlapping a revealed
 * region are skipped (they show raw markdown). Purely derived data — the
 * document and selection are never modified (§9).
 */
export function computeLivePreviewDecos(
  state: EditorState,
  visibleRanges: readonly VisibleRange[]
): LivePreviewDeco[] {
  const tree = syntaxTree(state);
  const revealed = revealedRanges(state);
  const decos: LivePreviewDeco[] = [];
  // A construct straddling a gap between visible ranges is entered once per
  // range it overlaps; dedupe so it decorates once.
  const seen = new Set<string>();
  const push = (d: LivePreviewDeco) => {
    const key = `${d.from}:${d.to}:${d.deco === 'style' ? d.style : 'hide'}`;
    if (!seen.has(key)) {
      seen.add(key);
      decos.push(d);
    }
  };
  for (const vr of visibleRanges) {
    tree.iterate({
      from: vr.from,
      to: vr.to,
      enter(n) {
        const spec = INLINE_NODES[n.name];
        if (!spec) return;
        // §8: any construct overlapping a revealed line shows raw.
        if (revealed.some((r) => n.from < r.to && n.to > r.from)) return;
        push({ from: n.from, to: n.to, deco: 'style', style: spec.style });
        // Direct marker children only: nested emphasis keeps each level's
        // markers on its own node, so hide spans never overlap.
        for (const mark of n.node.getChildren(spec.marker)) {
          push({ from: mark.from, to: mark.to, deco: 'hide' });
        }
      },
    });
  }
  return decos.sort((a, b) => a.from - b.from || a.to - b.to);
}
