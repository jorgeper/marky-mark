/**
 * PRD 013 Req 5: the edit-pane diagram view's pure span computation. With
 * the `diagramView` setting on, every fenced block whose language has a
 * registered fence renderer (`fenceRenderers.ts`) qualifies to draw as its
 * diagram in place of the fence text — as PURE DECORATION, like the SPEC41
 * image view and the issue #157 code cards. Registration is what qualifies
 * a fence: this module names no concrete language, so a second registered
 * language draws with no edit here (the `fenceDiagrams.ts` preview rule,
 * restated for the editor).
 *
 * Caret-reveal follows `computeCodeCards` (`codeBlockSpans.ts`): both
 * boundaries count as inside, because a caret landing on a delimiter line
 * must reveal the block it opens. Grid exclusion follows SPEC41 §2.4: a
 * fence overlapping a SPEC40 table-grid span stays raw — the grid's
 * geometry owns those lines.
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { fenceLanguage } from './fenceRenderers';
import type { Span } from './codeBlockSpans';

/** One qualifying fence's decoration inputs, in document order. */
export interface DiagramSpan {
  /** Full-line bounds of the fence — what the block widget replaces. */
  from: number;
  to: number;
  /** The fence's normalized language tag (registered — what qualified it). */
  tag: string;
  /** The fence body handed to the renderer: the lines between the delimiters. */
  source: string;
  /** Caret inside the block — it shows raw source for editing (no widget). */
  revealed: boolean;
}

/**
 * PRD 013 Req 5: every registered-language fence as a widget spec. A fence
 * whose language has no registration (```js, ```text, no info string) is
 * not returned at all — it keeps exactly today's edit-pane rendering.
 * Disabled callers pass `enabled: false` and get no spans.
 */
export function computeDiagramSpans(
  state: EditorState,
  enabled: boolean,
  isRegistered: (tag: string) => boolean,
  excluded: readonly Span[] = []
): DiagramSpan[] {
  if (!enabled) return [];
  const spans: DiagramSpan[] = [];
  const head = state.selection.main.head;
  const doc = state.doc;
  syntaxTree(state).iterate({
    enter(n) {
      if (n.name !== 'FencedCode') return;
      // PRD 013 Req 5: the registry decides — the info string's first word,
      // normalized by the seam's own reader, looked up by the caller.
      const info = n.node.getChild('CodeInfo');
      const tag = fenceLanguage(info ? doc.sliceString(info.from, info.to) : null);
      if (tag == null || !isRegistered(tag)) return false;
      // Grid exclusion, like SPEC41 §2.4 / computeCodeCards.
      if (excluded.some((s) => n.from < s.to && n.to > s.from)) return false;
      // A block widget replaces whole lines; a fence indented up to three
      // spaces still swaps out from its line start.
      const from = doc.lineAt(n.from).from;
      const to = doc.lineAt(n.to).to;
      const revealed = from <= head && head <= to;
      const text = n.node.getChild('CodeText');
      const source = text ? doc.sliceString(text.from, text.to) : '';
      spans.push({ from, to, tag, source, revealed });
      return false; // fences never nest — no need to descend into the body
    },
  });
  return spans;
}
