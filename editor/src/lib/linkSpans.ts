/**
 * SPEC43 §11 (issue #270): the rendered-links view's pure core, in the
 * codeBlockSpans.ts two-file shape — span computation here, view wiring in
 * src/components/linkView.ts. With the `linkView` setting on, an inline link
 * reads as just its styled link text: the `[`, `](`, the URL, any title and
 * the `)` hide as PURE DECORATION (nothing here ever changes document text,
 * history or the dirty state).
 *
 * Scope boundary: only Lezer `Link` nodes carrying a `URL` child collapse.
 * Reference-style links (`[text][ref]`), bare/autolinked URLs (`Autolink`
 * nodes), image references (`Image` nodes) and anything inside a fenced code
 * block (never parsed as `Link`) have no URL on the node to render or open —
 * they stay raw. The collapse geometry is the SAME rule the live preview
 * hides (livePreview.ts `linkSpanSpec`), so the two can never diverge.
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { linkSpanSpec, type VisibleRange } from './livePreview';
import type { Span } from './codeBlockSpans';

/** One inline link's decoration inputs, in document order. */
export interface LinkView {
  /** The whole Link node. */
  from: number;
  to: number;
  /** Caret/selection touches the node — it shows raw (`hide` is empty). */
  revealed: boolean;
  /** The `[` mark and the `]…)` tail to hide; empty while revealed. */
  hide: Span[];
  /** The link text between the markers — carries the link styling. */
  text: Span;
  /** The raw href (always present: URL-less links are not emitted). */
  url: string;
}

/**
 * SPEC43 §11 (issue #270): the ONE offset→link resolution — the menu row's
 * enabled flag, the openLink hotkey and the modifier-click all resolve the
 * link under a document offset through this helper; there is no second,
 * view-only parse. Both node boundaries count as inside (the caret right
 * after the `)` still names the link, matching the reveal rule below).
 * Returns null on an image reference, a reference-style link (no URL child)
 * or anywhere outside a link.
 */
export function linkAt(state: EditorState, pos: number): { from: number; to: number; url: string } | null {
  const tree = syntaxTree(state);
  for (const side of [-1, 1] as const) {
    for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) {
      // An Image node is its own construct (`![alt](src)` is not a link) —
      // the walk never crosses one on the way up.
      if (n.name === 'Image') break;
      if (n.name === 'Link') {
        const spec = linkSpanSpec(n, state.doc);
        if (!spec || spec.url === null) return null;
        return { from: n.from, to: n.to, url: spec.url };
      }
    }
  }
  return null;
}

/**
 * Every inline link in the visible ranges as a view spec. Reveal-on-cursor:
 * when the caret or ANY part of the selection touches the node (boundaries
 * inclusive, the codeBlockSpans convention) the whole construct shows raw and
 * stays editable in place. `excluded` spans (the SPEC40 table-grid regions —
 * grids pad columns by raw character count, so a hidden span would pull the
 * pipes out of column) drop their links entirely, the guard codeBlockView
 * already applies via tableModeField.
 */
export function computeLinkViews(
  state: EditorState,
  visibleRanges: readonly VisibleRange[],
  excluded: readonly Span[] = []
): LinkView[] {
  const out: LinkView[] = [];
  const ranges = state.selection.ranges;
  const tree = syntaxTree(state);
  const seen = new Set<number>();
  for (const vr of visibleRanges) {
    tree.iterate({
      from: vr.from,
      to: vr.to,
      enter(n) {
        if (n.name !== 'Link' || seen.has(n.from)) return;
        if (excluded.some((s) => n.from < s.to && n.to > s.from)) return false;
        const spec = linkSpanSpec(n.node, state.doc);
        if (!spec || spec.url === null) return;
        seen.add(n.from);
        const revealed = ranges.some((r) => r.from <= n.to && r.to >= n.from);
        out.push({
          from: n.from,
          to: n.to,
          revealed,
          hide: revealed ? [] : spec.hide.filter((h) => h.from < h.to),
          text: spec.text,
          url: spec.url,
        });
      },
    });
  }
  return out.sort((a, b) => a.from - b.from);
}
