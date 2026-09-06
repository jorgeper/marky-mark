/**
 * PRD 020 Req 18 (issue #260): "is this line a markdown heading?" — the cheap
 * pre-filter the editor's copy-link gutter (`components/Editor.tsx`) runs in
 * front of the section-model lookup that actually addresses the heading, so
 * that parse never runs while the cursor sits on ordinary text.
 *
 * Reading the Lezer tree is the whole subtlety, and issue #260's bug.
 * `syntaxTree(state)` reports only as far as the background parse has
 * reached: on a long document the tail is still unparsed, every heading past
 * the cut-off answered "not a heading", and the marker silently vanished —
 * the "top headings only" shape. `ensureSyntaxTree` parses up to the line
 * first (the `components/diagramView.ts` precedent, same 20 ms budget), and
 * when even that runs out of budget the pre-filter ABSTAINS rather than
 * guessing: it says yes and lets the section model — the authority, and the
 * thing that gates fenced `# not-a-heading` lines out anyway — decide. A
 * pre-filter may cost a caller one extra parse; it may never hide a heading.
 *
 * PRD 021 Req 5: pure and app-free — an `EditorState` in, a boolean out, like
 * `diagramSpans.ts`.
 */
import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorState, Line } from '@codemirror/state';

/** The parse budget one line's answer may cost, matching `diagramView.ts`. */
const PARSE_BUDGET_MS = 20;

/** True when `line` holds a heading node (ATX or setext), or when unknowable. */
export function isHeadingLine(state: EditorState, line: Line): boolean {
  // Parse far enough to answer for THIS line — never the whole document.
  const tree = ensureSyntaxTree(state, line.to, PARSE_BUDGET_MS);
  if (tree === null) return true; // budget spent: abstain, the caller decides
  // Scan the whole line for a heading node rather than resolving at line
  // start: a container-nested heading (issue #226 — indented under a list
  // item, or blockquoted) begins AFTER the `  `/`> ` prefix, so a line-start
  // resolve walks up through ListItem/Blockquote and never meets it.
  let onHeading = false;
  tree.iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (/^(ATX|Setext)Heading/.test(node.name)) onHeading = true;
    },
  });
  return onHeading;
}
