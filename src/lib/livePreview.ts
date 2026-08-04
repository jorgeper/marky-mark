/**
 * PRD 006 §3/§8/§9/§13: the live-preview decoration core — a pure function
 * of document state (text + syntax tree + selection) and the view's visible
 * ranges to plain decoration specs: which marker characters to hide and
 * which content spans to style. Nothing here touches the DOM or the
 * document; the ViewPlugin in src/components/livePreview.ts maps these
 * specs onto CodeMirror decorations. #48 added blocks and links to the walk;
 * the next sub-issue (#49 checkboxes) extends it the same way.
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Text } from '@codemirror/state';

export type InlineStyle = 'strong' | 'emphasis' | 'strikethrough' | 'inline-code';

/** PRD 006 §6: mark-shaped styles beyond §3's inline set. */
export type MarkStyle = InlineStyle | 'list-number';

/** PRD 006 §4/§6: whole-line styles — heading sizes and the quote bar. */
export type LineStyle =
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'blockquote';

export type LivePreviewDeco =
  | { from: number; to: number; deco: 'hide' }
  | { from: number; to: number; deco: 'style'; style: MarkStyle }
  // PRD 006 §5: the link-text span carrying the URL for the click hand-off.
  | { from: number; to: number; deco: 'link'; url: string }
  // PRD 006 §6: a bullet-list marker rendered as a bullet glyph.
  | { from: number; to: number; deco: 'bullet' }
  // PRD 006 §6: a horizontal rule drawn over the raw ---/*** text.
  | { from: number; to: number; deco: 'rule' }
  // PRD 006 §4/§6: line-level styling; from/to span the full line.
  | { from: number; to: number; deco: 'line'; style: LineStyle };

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

/** PRD 006 §4: ATX heading nodes, keyed by Lezer node name → line style. */
const HEADING_NODES: Record<string, LineStyle> = {
  ATXHeading1: 'heading-1',
  ATXHeading2: 'heading-2',
  ATXHeading3: 'heading-3',
  ATXHeading4: 'heading-4',
  ATXHeading5: 'heading-5',
  ATXHeading6: 'heading-6',
};

/** PRD 006 §8: block constructs that cannot reveal line-by-line. */
const ATOMIC_BLOCKS = new Set(['FencedCode', 'CodeBlock']);

/**
 * PRD 006 §8: inline-shaped spans whose markers sit at both ends — these
 * reveal whole when they cross a line break. Links join §3's inline set:
 * a wrapped `[text](url)` cannot reveal line-by-line either.
 */
const INLINE_SPANS = new Set([...Object.keys(INLINE_NODES), 'Link']);

/**
 * PRD 006 §8: a construct that must reveal whole — an atomic block, or an
 * inline construct whose span crosses a line break (its markers sit on
 * different lines, so a partial reveal would orphan one of them).
 */
function revealsWhole(name: string, doc: Text, from: number, to: number): boolean {
  if (ATOMIC_BLOCKS.has(name)) return true;
  return INLINE_SPANS.has(name) && doc.lineAt(from).number !== doc.lineAt(to).number;
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
 * PRD 006 §3–§6/§8/§13: decoration specs for the visible ranges only.
 * Constructs outside every revealed region render (styled spans, hidden
 * markers, line styles, drawn rules); constructs overlapping a revealed
 * region are skipped (they show raw markdown) — per construct for inline
 * spans, headings, rules and fences, per line for blockquotes and lists,
 * which reveal line-by-line. Purely derived data — the document and
 * selection are never modified (§9).
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
    if (d.from >= d.to) return;
    let detail = '';
    if ('style' in d) detail = d.style;
    else if (d.deco === 'link') detail = d.url;
    const key = `${d.from}:${d.to}:${d.deco}:${detail}`;
    if (!seen.has(key)) {
      seen.add(key);
      decos.push(d);
    }
  };
  const doc = state.doc;
  // §8: any construct overlapping a revealed line shows raw.
  const overlapsRevealed = (from: number, to: number) =>
    revealed.some((r) => from < r.to && to > r.from);
  for (const vr of visibleRanges) {
    tree.iterate({
      from: vr.from,
      to: vr.to,
      enter(n) {
        const spec = INLINE_NODES[n.name];
        if (spec) {
          if (overlapsRevealed(n.from, n.to)) return;
          push({ from: n.from, to: n.to, deco: 'style', style: spec.style });
          // Direct marker children only: nested emphasis keeps each level's
          // markers on its own node, so hide spans never overlap.
          for (const mark of n.node.getChildren(spec.marker)) {
            push({ from: mark.from, to: mark.to, deco: 'hide' });
          }
          return;
        }
        // PRD 006 §4: ATX headings — per-level line style, markers hidden.
        const heading = HEADING_NODES[n.name];
        if (heading) {
          if (overlapsRevealed(n.from, n.to)) return;
          const line = doc.lineAt(n.from);
          push({ from: line.from, to: line.to, deco: 'line', style: heading });
          n.node.getChildren('HeaderMark').forEach((mark, i) => {
            // §4: the marker hides together with its separating space — the
            // one after the opening marks, the one before any closing marks.
            const from =
              i > 0 && doc.sliceString(mark.from - 1, mark.from) === ' ' ? mark.from - 1 : mark.from;
            const to =
              i === 0 && doc.sliceString(mark.to, mark.to + 1) === ' ' ? mark.to + 1 : mark.to;
            push({ from, to, deco: 'hide' });
          });
          return;
        }
        switch (n.name) {
          // PRD 006 §5: links — the [text](url) syntax hides; the text span
          // carries the URL so the component layer can wire cmd/ctrl-click.
          case 'Link': {
            if (overlapsRevealed(n.from, n.to)) return;
            const marks = n.node.getChildren('LinkMark');
            if (marks.length < 2) return;
            const url = n.node.getChild('URL');
            push({ from: marks[0].from, to: marks[0].to, deco: 'hide' });
            push({
              from: marks[0].to,
              to: marks[1].from,
              deco: 'link',
              url: url ? doc.sliceString(url.from, url.to) : '',
            });
            // One span from `]` to the construct's end covers the closing
            // bracket, parens, URL and any title.
            push({ from: marks[1].from, to: n.to, deco: 'hide' });
            return;
          }
          // PRD 006 §6: blockquotes — a quote-bar line style per line. §8:
          // quotes reveal line-by-line, so filter per line, not per node;
          // §13: bound the line walk to the visible range.
          case 'Blockquote': {
            let pos = Math.max(n.from, vr.from);
            const end = Math.min(n.to, vr.to);
            while (pos <= end) {
              const line = doc.lineAt(pos);
              if (!overlapsRevealed(line.from, line.to)) {
                push({ from: line.from, to: line.to, deco: 'line', style: 'blockquote' });
              }
              if (line.to >= end) break;
              pos = line.to + 1;
            }
            return;
          }
          // PRD 006 §6: the > marker (and its space) hides per line (§8).
          case 'QuoteMark': {
            const line = doc.lineAt(n.from);
            if (overlapsRevealed(line.from, line.to)) return;
            const to = doc.sliceString(n.to, n.to + 1) === ' ' ? n.to + 1 : n.to;
            push({ from: n.from, to, deco: 'hide' });
            return;
          }
          // PRD 006 §6: list markers stay visible — bullets render as a
          // bullet glyph, ordered markers keep their number, styled.
          case 'ListMark': {
            const line = doc.lineAt(n.from);
            if (overlapsRevealed(line.from, line.to)) return;
            const list = n.node.parent?.parent?.name;
            if (list === 'BulletList') push({ from: n.from, to: n.to, deco: 'bullet' });
            else if (list === 'OrderedList')
              push({ from: n.from, to: n.to, deco: 'style', style: 'list-number' });
            return;
          }
          // PRD 006 §6: horizontal rules draw as a rule over the raw text.
          case 'HorizontalRule': {
            if (overlapsRevealed(n.from, n.to)) return;
            push({ from: n.from, to: n.to, deco: 'rule' });
            return;
          }
          // PRD 006 §6: fence lines (backticks + info string) hide; the code
          // body gets no spans, keeping its existing syntax highlighting.
          case 'FencedCode': {
            if (overlapsRevealed(n.from, n.to)) return;
            for (const mark of n.node.getChildren('CodeMark')) {
              push({ from: mark.from, to: mark.to, deco: 'hide' });
            }
            const info = n.node.getChild('CodeInfo');
            if (info) push({ from: info.from, to: info.to, deco: 'hide' });
            return;
          }
        }
      },
    });
  }
  return decos.sort((a, b) => a.from - b.from || a.to - b.to);
}
