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
import { readFenceWidth } from './fenceWidth';
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
  /**
   * PRD 015 Req 4: the persisted `width=N` from the fence's info string
   * (`readFenceWidth` — tolerant, PRD 015 Req 3: absent or intolerable ⇒
   * null, natural size). Read-only: computing spans never writes the buffer.
   */
  width: number | null;
  /** Caret inside the block — it shows raw source for editing (no widget). */
  revealed: boolean;
}

/**
 * PRD 015 Req 4: what makes two spans the SAME DRAWING — source, tag and
 * persisted width. The widget's `eq` (components/diagramView.ts) keys on
 * this, so a width change redraws its block (the render cache keyed on
 * theme/tag/source absorbs the redraw — mermaid never re-runs for a
 * width-only change) while a caret move elsewhere keeps the DOM. Position
 * and reveal state are deliberately not identity: the drawing is the same
 * wherever the fence sits.
 */
export function sameDiagramDrawing(a: DiagramSpan, b: DiagramSpan): boolean {
  return a.source === b.source && a.tag === b.tag && a.width === b.width;
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
      const infoText = info ? doc.sliceString(info.from, info.to) : null;
      const tag = fenceLanguage(infoText);
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
      // PRD 015 Req 4: the CodeInfo slice IS the full info string
      // (`lang meta…`) — exactly the shape readFenceWidth reads.
      spans.push({ from, to, tag, source, width: readFenceWidth(infoText), revealed });
      return false; // fences never nest — no need to descend into the body
    },
  });
  return spans;
}
