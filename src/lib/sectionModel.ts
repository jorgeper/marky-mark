/**
 * PRD 011 Req 24: the source-level section model — a parsed tree of headings
 * and their bodies with source line ranges. Structure comes from the mdast the
 * repo already parses (remark-parse → remark-frontmatter → remark-gfm, the
 * front half of the render pipeline in `markdown.ts`), never from scraping the
 * rendered HTML: the `data-mm-line` anchors and their consumers (scroll sync,
 * heading palette, comment anchoring) are untouched by this module and keep
 * behaving at L5 exactly as before.
 *
 * PRD 011 Req 34: pure — no network, no DOM, no host. Parsing only; every
 * caller passes the markdown source in and gets plain data back.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';

/** Minimal mdast shape this module reads; the full types are not a dependency. */
interface MdNode {
  type: string;
  depth?: number;
  value?: string;
  alt?: string;
  children?: MdNode[];
  position?: { start?: { line?: number }; end?: { line?: number } };
}

export interface SectionNode {
  /**
   * Stable within-document path (`'1'`, `'1.2'`, `'1.2.1'`, `'preamble'`).
   * Positional, so two sections with identical heading text stay distinct.
   * Deliberately NOT part of the cache key (PRD 011 Req 28): moving an
   * unchanged section must not invalidate its summary.
   */
  id: string;
  /** Heading depth 1–6; `0` marks the synthetic preamble node (no heading). */
  depth: number;
  /** Heading text, flattened to plain text ('' for the preamble). */
  title: string;
  /** 1-based line of the heading; `0` for the preamble. */
  headingLine: number;
  /** 1-based first line of the section (the heading line, or the preamble's first line). */
  startLine: number;
  /**
   * 1-based last line of the section, inclusive: the line before the next
   * sibling-or-shallower heading, or the last line of the document. Covers
   * this section's descendants.
   */
  endLine: number;
  /** 1-based last line of this section's OWN body (stops at the first child heading). */
  bodyEndLine: number;
  /**
   * The section's own body source, heading line excluded, descendants
   * excluded, leading/trailing blank lines trimmed. This is what gets
   * excerpted, summarized and hashed — so editing a child never disturbs its
   * ancestor's cache key.
   */
  body: string;
  children: SectionNode[];
}

/**
 * PRD 020 Req 18 (issue #226): one rendered heading, wherever it sits. Unlike
 * the section tree — which only root-level headings delimit — this list also
 * covers headings nested inside containers (a blockquote, a list item), which
 * render as real h1–h6 and must be addressable by `#<slug>` share links.
 */
export interface DocumentHeading {
  /** Heading text, flattened to plain text. */
  title: string;
  /** 1-based source line of the heading. */
  line: number;
}

export interface DocumentSections {
  /** Top-level sections in source order (the shallowest headings present). */
  sections: SectionNode[];
  /** Content before the first heading, if any non-blank; front matter excluded. */
  preamble: SectionNode | null;
  /** The first depth-1 heading's text, or null if the document has none. */
  title: string | null;
  /** Line count of the source (0 for an empty document). */
  lineCount: number;
  /**
   * PRD 020 Req 18 (issue #226): EVERY heading in document order, container-
   * nested ones included — the share-link anchor source (`lib/shareLinks.ts`).
   * The section tree above is untouched by nesting: TOC, zoom and summaries
   * keep reading root-delimited sections exactly as before.
   */
  headings: DocumentHeading[];
}

const parser = unified().use(remarkParse).use(remarkFrontmatter).use(remarkGfm);

/** Flatten inline nodes to plain text (heading text has no formatting here). */
function plainText(node: MdNode): string {
  if (typeof node.value === 'string') return node.value;
  if (node.type === 'image') return node.alt ?? '';
  return (node.children ?? []).map(plainText).join('');
}

/** Trim leading and trailing blank lines without touching inner indentation. */
function trimBlankLines(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end).join('\n');
}

interface HeadingHit {
  depth: number;
  title: string;
  line: number;
  /** Last line of the heading itself — a setext heading spans two lines. */
  endLine: number;
}

/**
 * PRD 011 Req 24: parse the markdown source into an ordered section tree.
 *
 * Only root-level headings delimit sections, matching how `stampSourceLines`
 * treats the document (`markdown.ts`): a `#` inside a fenced code block is not
 * a heading because mdast does not make it one, and YAML front matter is a
 * `yaml` node that no section body contains. Setext (`===` / `---`) headings
 * are ordinary heading nodes here and their underline line is not body text.
 */
export function parseSections(source: string): DocumentSections {
  const rawLines = source.split('\n');
  // A trailing newline ends the last line; it does not begin an extra one.
  if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '') rawLines.pop();
  const lineCount = source === '' ? 0 : rawLines.length;
  if (lineCount === 0) return { sections: [], preamble: null, title: null, lineCount: 0, headings: [] };

  const root = parser.parse(source) as MdNode;
  const children = root.children ?? [];

  // Front matter is excluded from every section body: content starts after it.
  let contentStart = 1;
  const first = children[0];
  if (first && (first.type === 'yaml' || first.type === 'toml')) {
    contentStart = (first.position?.end?.line ?? 1) + 1;
  }

  const headings: HeadingHit[] = [];
  for (const child of children) {
    if (child.type !== 'heading') continue;
    const line = child.position?.start?.line;
    if (typeof line !== 'number') continue;
    headings.push({
      depth: child.depth ?? 1,
      title: plainText(child).trim(),
      line,
      endLine: child.position?.end?.line ?? line,
    });
  }

  // PRD 020 Req 18 (issue #226): the flat all-headings list — the root-level
  // hits above plus container-nested headings, in document order (mdast child
  // order IS source order). Only the anchor list sees these; the section tree
  // below stays root-delimited.
  const allHeadings: DocumentHeading[] = [];
  const collectHeadings = (nodes: MdNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'heading') {
        const line = node.position?.start?.line;
        if (typeof line === 'number') {
          allHeadings.push({ title: plainText(node).trim(), line });
        }
        continue; // a heading never nests another heading
      }
      collectHeadings(node.children ?? []);
    }
  };
  collectHeadings(children);

  const lineText = (from: number, to: number): string =>
    from > to ? '' : trimBlankLines(rawLines.slice(from - 1, to));

  // Preamble: everything from the end of front matter to the first heading.
  const firstHeadingLine = headings.length > 0 ? headings[0].line : lineCount + 1;
  const preambleEnd = firstHeadingLine - 1;
  const preambleBody = lineText(contentStart, preambleEnd);
  const preamble: SectionNode | null =
    preambleBody === ''
      ? null
      : {
          id: 'preamble',
          depth: 0,
          title: '',
          headingLine: 0,
          startLine: contentStart,
          endLine: preambleEnd,
          bodyEndLine: preambleEnd,
          body: preambleBody,
          children: [],
        };

  const roots: SectionNode[] = [];
  const stack: SectionNode[] = [];
  headings.forEach((h, i) => {
    // The section runs to the line before the next sibling-or-shallower
    // heading; its own body stops at the next heading of any depth.
    let endLine = lineCount;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].depth <= h.depth) {
        endLine = headings[j].line - 1;
        break;
      }
    }
    const nextAny = headings[i + 1];
    const bodyEndLine = nextAny ? Math.min(endLine, nextAny.line - 1) : endLine;

    // Skipped depths (`#` → `###`) nest under the nearest shallower heading;
    // a heading with no shallower ancestor is a root.
    while (stack.length > 0 && stack[stack.length - 1].depth >= h.depth) stack.pop();
    const parent = stack[stack.length - 1];
    const index = (parent ? parent.children.length : roots.length) + 1;
    const node: SectionNode = {
      id: parent ? `${parent.id}.${index}` : String(index),
      depth: h.depth,
      title: h.title,
      headingLine: h.line,
      startLine: h.line,
      endLine,
      bodyEndLine,
      body: lineText(h.endLine + 1, bodyEndLine),
      children: [],
    };
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  });

  const title = headings.find((h) => h.depth === 1)?.title ?? null;
  return { sections: roots, preamble, title, lineCount, headings: allHeadings };
}

/** Depth-first section list in source order (the preamble first, when present). */
export function flattenSections(doc: DocumentSections): SectionNode[] {
  const out: SectionNode[] = [];
  if (doc.preamble) out.push(doc.preamble);
  const walk = (nodes: SectionNode[]): void => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(doc.sections);
  return out;
}

/**
 * The canonical text of a section: what gets hashed for a cache key and
 * counted for a token estimate. Heading depth and text are included so that
 * re-titling or re-levelling a section invalidates its summary.
 */
export function sectionContent(section: SectionNode): string {
  const heading = section.depth > 0 ? `${'#'.repeat(section.depth)} ${section.title}\n` : '';
  return `${heading}${section.body}`;
}

/** Look up a section by its stable id, or null when the id is unknown. */
export function findSection(doc: DocumentSections, id: string): SectionNode | null {
  return flattenSections(doc).find((s) => s.id === id) ?? null;
}
