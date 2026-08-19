/**
 * PRD 012 Req 13: the Table of Contents' pure logic — heading-tree derivation,
 * collapse-set handling, and active-section resolution, as functions over plain
 * data. The React view (issue #132) renders what these return and owns no rules
 * of its own.
 *
 * PRD 012 Req 2: the tree comes from the section model (`sectionModel.ts`) —
 * the mdast parse the app already runs — never from scraping rendered HTML.
 * This module reads `DocumentSections` and touches no `data-mm-line` anchor and
 * no DOM, so a `#` line inside a fenced code block is not a heading here for the
 * same reason it is not one in the section model: mdast never made it one.
 *
 * The collapse set is passed in and returned, never held: PRD 012's non-goal
 * ("no new persistence file") makes collapse state session memory the caller
 * owns.
 */

import type { DocumentSections, SectionNode } from './sectionModel';

/**
 * PRD 012 Req 2: one H1–H6 heading row of the TOC, with the children nested
 * under it. Line numbers are 1-based, matching the section model.
 */
export interface TocEntry {
  /**
   * PRD 012 Req 3: `SectionNode.id` verbatim (`'1'`, `'1.2'`, …) — positional,
   * so two headings with identical text stay distinct entries.
   */
  id: string;
  /** Heading depth 1–6. The synthetic `preamble` node (depth 0) is never an entry. */
  depth: number;
  /** Heading text, flattened to plain text. */
  title: string;
  /** 1-based source line of the heading itself — where a click navigates. */
  headingLine: number;
  /** 1-based last line this heading covers, descendants included (`SectionNode.endLine`). */
  endLine: number;
  children: TocEntry[];
}

/**
 * PRD 012 Req 2 + Req 4: a flattened row, carrying the depth-derived indent and
 * whether it has children to disclose, so the view renders a list rather than
 * re-walking the tree.
 */
export interface VisibleTocEntry {
  entry: TocEntry;
  /** True when the entry has children — the disclosure triangle's row. */
  hasChildren: boolean;
  /** True when this entry's own children are hidden. */
  collapsed: boolean;
}

/**
 * PRD 012 Req 2: turn the section model into the TOC entry tree — every H1–H6
 * in document order, each nested under its nearest shallower heading.
 *
 * The nesting (including skipped levels: an H3 after an H1 hangs off the H1, an
 * H3 with no shallower heading before it is a root) is already what
 * `parseSections` built, so this is a shape mapping, not a second parse.
 *
 * PRD 012 Req 2: `doc.preamble` is a separate field of `DocumentSections` and
 * is never walked — content before the first heading produces no row.
 */
export function buildTocTree(doc: DocumentSections): TocEntry[] {
  const map = (nodes: SectionNode[]): TocEntry[] =>
    nodes.map((n) => ({
      id: n.id,
      depth: n.depth,
      title: n.title,
      headingLine: n.headingLine,
      endLine: n.endLine,
      children: map(n.children),
    }));
  return map(doc.sections);
}

/** Depth-first entry list in document order — the tree, ignoring collapse state. */
export function flattenToc(entries: TocEntry[]): TocEntry[] {
  const out: TocEntry[] = [];
  const walk = (nodes: TocEntry[]): void => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(entries);
  return out;
}

/** Look up an entry by its positional id, or null when the id is unknown. */
export function findTocEntry(entries: TocEntry[], id: string): TocEntry | null {
  return flattenToc(entries).find((e) => e.id === id) ?? null;
}

/**
 * PRD 012 Req 4 + Req 7: the ids that must be expanded to reveal `id`,
 * outermost first and excluding `id` itself. Empty for a root entry and for an
 * unknown id — the caller's reveal is then a no-op rather than an error.
 */
export function tocAncestorIds(entries: TocEntry[], id: string): string[] {
  const chain: string[] = [];
  const walk = (nodes: TocEntry[], path: string[]): boolean => {
    for (const n of nodes) {
      if (n.id === id) {
        chain.push(...path);
        return true;
      }
      if (walk(n.children, [...path, n.id])) return true;
    }
    return false;
  };
  walk(entries, []);
  return chain;
}

/**
 * PRD 012 Req 4: flip one entry between expanded and collapsed.
 *
 * State is the set of COLLAPSED ids, so the empty set means all-expanded and a
 * heading that appears while editing (Req 8) starts expanded without anyone
 * seeding it. An unknown id is a no-op: the set never accumulates ids the
 * document does not have.
 */
export function toggleTocCollapsed(
  entries: TocEntry[],
  collapsed: ReadonlySet<string>,
  id: string
): Set<string> {
  const next = new Set(collapsed);
  if (!findTocEntry(entries, id)) return next;
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * PRD 012 Req 7: expand every ancestor of `id` — the auto-reveal the active
 * section calls when its row is buried. A no-op (an equal set) when nothing on
 * the chain is collapsed, and when the id is unknown.
 */
export function expandTocAncestors(
  entries: TocEntry[],
  collapsed: ReadonlySet<string>,
  id: string
): Set<string> {
  const next = new Set(collapsed);
  for (const ancestor of tocAncestorIds(entries, id)) next.delete(ancestor);
  return next;
}

/**
 * PRD 012 Req 4: the rows the sidebar actually draws, in document order.
 *
 * A collapsed entry is still visible — it is its descendants that are hidden —
 * so the walk renders the node, then descends only when the node is expanded.
 */
export function visibleTocEntries(
  entries: TocEntry[],
  collapsed: ReadonlySet<string>
): VisibleTocEntry[] {
  const out: VisibleTocEntry[] = [];
  const walk = (nodes: TocEntry[]): void => {
    for (const n of nodes) {
      const isCollapsed = collapsed.has(n.id);
      out.push({ entry: n, hasChildren: n.children.length > 0, collapsed: isCollapsed });
      if (!isCollapsed) walk(n.children);
    }
  };
  walk(entries);
  return out;
}

/**
 * PRD 012 Req 7: which entry is the active one for a 1-based document line (the
 * top visible line while scrolling, or the cursor line while editing).
 *
 * The answer is the DEEPEST heading whose source range contains the line:
 * `endLine` covers descendants, so an ancestor matches a line inside its child
 * too, and depth-first order means the last match encountered is the innermost
 * one. Null when the line falls before the first heading (or the document has
 * none) — there is no entry to highlight there, the preamble is not a row.
 */
export function activeTocEntryId(entries: TocEntry[], line: number): string | null {
  let active: string | null = null;
  for (const entry of flattenToc(entries)) {
    if (line >= entry.headingLine && line <= entry.endLine) active = entry.id;
  }
  return active;
}
