/**
 * Issue #157: the fenced-code card view's pure span computation. With the
 * `codeBlockView` setting on, every fenced block in the edit pane reads as
 * the preview's code card: the fence delimiter lines and the info string
 * hide, and the block's lines carry card chrome — as PURE DECORATION, like
 * the SPEC41 image view. The body stays real, editable editor text (no
 * widget replaces it), so `codeSyntax` colouring and typing work untouched.
 *
 * The delimiter/info spans are exactly the ones livePreview's FencedCode
 * case hides (PRD 006 §6) — when both features are on the two hide the
 * same ranges, so nothing double-hides or shifts.
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export interface Span {
  from: number;
  to: number;
}

/** One fenced block's decoration inputs, in document order. */
export interface CodeCard {
  /** The whole FencedCode node. */
  from: number;
  to: number;
  /** Caret inside the block — its delimiters show raw (`hide` is empty). */
  revealed: boolean;
  /** Delimiter marks + info string to hide; sorted, empty while revealed. */
  hide: Span[];
  /** Start offset of every line the block covers, for the card line chrome. */
  lines: number[];
}

/**
 * Every fenced code block as a card spec. Caret-reveal matches the rule in
 * src/components/imageView.ts: while the selection head sits inside a block
 * that block's delimiters show as raw text; other blocks stay rendered.
 * `excluded` spans (the SPEC40 table-grid regions — allTableRegions is not
 * fence-aware, so a piped "table" inside a fence can be gridded) drop their
 * block entirely: the grid's geometry owns those lines. Disabled callers
 * simply pass `enabled: false` and get no spans.
 */
export function computeCodeCards(
  state: EditorState,
  enabled: boolean,
  excluded: readonly Span[] = []
): CodeCard[] {
  if (!enabled) return [];
  const cards: CodeCard[] = [];
  const head = state.selection.main.head;
  const doc = state.doc;
  syntaxTree(state).iterate({
    enter(n) {
      if (n.name !== 'FencedCode') return;
      if (excluded.some((s) => n.from < s.to && n.to > s.from)) return false;
      const revealed = n.from <= head && head <= n.to;
      const hide: Span[] = [];
      if (!revealed) {
        for (const mark of n.node.getChildren('CodeMark')) hide.push({ from: mark.from, to: mark.to });
        const info = n.node.getChild('CodeInfo');
        if (info) hide.push({ from: info.from, to: info.to });
        // The info string sits between the opening and closing marks —
        // restore document order for the decoration assembly.
        hide.sort((a, b) => a.from - b.from);
      }
      const lines: number[] = [];
      const last = doc.lineAt(n.to).number;
      for (let ln = doc.lineAt(n.from).number; ln <= last; ln++) lines.push(doc.line(ln).from);
      cards.push({ from: n.from, to: n.to, revealed, hide, lines });
      return false; // fences never nest — no need to descend into the body
    },
  });
  return cards;
}
