/**
 * Issue #318: GitHub-alert callouts — the pure core shared by the preview
 * pipeline (markdown.ts) and the edit-pane view (lib/calloutSpans.ts +
 * components/calloutView.ts). A blockquote whose first line is exactly
 * `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` (the
 * five kinds `insertCallout` writes; marker case-insensitive) is a callout:
 * it renders as a tinted block with a kind-labelled title row, and the
 * literal marker never reaches the reader as body text. Any other
 * blockquote — no marker, or an unrecognised kind such as `[!HINT]` — is
 * left exactly as it was.
 *
 * Kept as a small transform inside the package rather than a remark/rehype
 * dependency: a dependency drags licences, notices and the bundle scans along
 * with it, and the whole contract is one regex and one hast rewrite.
 */
import type { CalloutKind } from './smartEdit';

/** The five kinds, in GitHub's order — the same set `insertCallout` inserts. */
export const CALLOUT_KINDS: readonly CalloutKind[] = ['note', 'tip', 'important', 'warning', 'caution'];

/** The title row's text per kind (GitHub's labels). */
export const CALLOUT_LABELS: Readonly<Record<CalloutKind, string>> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

/** The `.mm-callout-<kind>` class every rendered callout (both panes) carries. */
export function calloutClass(kind: CalloutKind): string {
  return `mm-callout-${kind}`;
}

/**
 * The kind a marker word names, or null for anything outside the five —
 * `[!HINT]` is not a callout, so the blockquote stays a plain blockquote.
 */
export function calloutKindOf(word: string): CalloutKind | null {
  const lower = word.toLowerCase();
  return (CALLOUT_KINDS as readonly string[]).includes(lower) ? (lower as CalloutKind) : null;
}

/**
 * The marker as it appears at the start of a blockquote's rendered first
 * paragraph: `[!KIND]`, optional trailing blanks, then the end of the line.
 * Group 1 is the kind word; the match length is what the transform removes.
 */
const MARKER_LINE = /^\[!([A-Za-z]+)\][ \t]*(?:\n|$)/;

/** The hast shape the transform touches — a structural subset, no dependency. */
export interface CalloutHastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: CalloutHastNode[];
  value?: string;
}

/**
 * Where a blockquote's marker is, when it is a callout: the first element
 * child is a paragraph whose first child is a text node starting with the
 * marker line. Returns the paragraph, its children, the text node, the kind
 * and the text left once the marker line is cut — or null.
 */
function findMarker(quote: CalloutHastNode): {
  paragraph: CalloutHastNode;
  children: CalloutHastNode[];
  text: CalloutHastNode;
  kind: CalloutKind;
  rest: string;
} | null {
  const paragraph = quote.children?.find((c) => c.type === 'element');
  if (!paragraph || paragraph.tagName !== 'p') return null;
  const children = paragraph.children ?? [];
  const text = children[0];
  if (!text || text.type !== 'text' || typeof text.value !== 'string') return null;
  const m = MARKER_LINE.exec(text.value);
  if (!m) return null;
  // The marker must be alone on its line: a match that ends at the text
  // node's end (no newline) but is followed by inline siblings (`[!NOTE]
  // **bold**`) is a first line with more on it — not a callout.
  if (!m[0].endsWith('\n') && children.length > 1) return null;
  const kind = calloutKindOf(m[1]);
  if (!kind) return null;
  return { paragraph, children, text, kind, rest: text.value.slice(m[0].length) };
}

/**
 * Rewrite one callout blockquote in place: the marker line leaves the text,
 * the container gains its classes, and a title paragraph carrying the kind's
 * label goes first. A paragraph left empty by the removal (the marker was
 * its only content) is dropped, so no empty `<p>` pads the block.
 */
function rewriteCallout(quote: CalloutHastNode): boolean {
  const hit = findMarker(quote);
  if (!hit) return false;
  const { paragraph, children, text, kind, rest } = hit;
  text.value = rest;
  if (rest === '') {
    children.shift();
    if (children.length === 0) {
      quote.children = (quote.children ?? []).filter((c) => c !== paragraph);
    }
  }
  const existing = quote.properties?.className;
  const classes = Array.isArray(existing) ? existing.map(String) : [];
  quote.properties = {
    ...quote.properties,
    className: [...classes, 'mm-callout', calloutClass(kind)],
  };
  const title: CalloutHastNode = {
    type: 'element',
    tagName: 'p',
    properties: { className: ['mm-callout-title'] },
    children: [{ type: 'text', value: CALLOUT_LABELS[kind] }],
  };
  quote.children = [title, ...(quote.children ?? [])];
  return true;
}

/**
 * The rehype transform: every callout blockquote in the tree, nested ones
 * included, rewritten as above. Runs BEFORE sanitize (markdown.ts), whose
 * schema admits exactly the classes written here; the `data-mm-line` stamp
 * on a top-level blockquote is an attribute this pass never touches, so
 * scroll sync keeps anchoring the block to its source line.
 */
export function renderCallouts() {
  const visit = (node: CalloutHastNode) => {
    if (node.type === 'element' && node.tagName === 'blockquote') rewriteCallout(node);
    for (const child of node.children ?? []) visit(child);
  };
  return (tree: CalloutHastNode) => visit(tree);
}
