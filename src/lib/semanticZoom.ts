/**
 * PRD 011 Reqs 17+18+19+21+22: the semantic-zoom VIEW model — everything the
 * rendered zoom view decides, as pure functions over plain data.
 *
 * It re-implements nothing: the section tree comes from `sectionModel.ts`, the
 * level→content mapping from `zoomLevels.ts`, and each block's text from
 * `sectionExcerpt.ts`. This module only joins them and answers the three
 * questions the React view would otherwise answer inline — "is this level
 * read-only?", "what does this level mean?" and "where does a click on this
 * section land?".
 *
 * PRD 011 Req 22: it makes no LLM request of any kind and holds no provider
 * state. Every block is an `Excerpt`, labelled as one; swapping excerpts for
 * summaries (#118) changes what fills `ZoomBlock.body`, not this shape.
 */

import { excerptFromBody, type Excerpt } from './sectionExcerpt';
import { findSection, parseSections, type DocumentSections, type SectionNode } from './sectionModel';
import {
  clampZoomLevel,
  zoomView,
  ZOOM_LEVEL_FULL,
  ZOOM_LEVEL_MAX,
  ZOOM_LEVEL_MIN,
  type FoldedSection,
  type ZoomLevel,
} from './zoomLevels';

/**
 * PRD 011 Req 18: the ONE answer to "can the document be edited here?". Every
 * gate reads this rather than spelling `level < 5` again.
 */
export function isZoomReadOnly(level: ZoomLevel): boolean {
  return level !== ZOOM_LEVEL_FULL;
}

/** PRD 011 Req 21: what each level means, in the reader's words. */
export const ZOOM_LEVEL_LABELS: Record<ZoomLevel, string> = {
  5: 'Full document',
  4: 'Every heading, one block each',
  3: 'Headings to depth 2',
  2: 'Top-level headings only',
  1: 'Whole document in a paragraph',
};

/**
 * PRD 011 Req 22: the one piece of copy that says what the blocks are. Stated
 * once for the whole view, never repeated per block.
 */
export const EXCERPT_NOTICE =
  'These are excerpts taken straight from the document — the opening lines of each section, not summaries.';

/** PRD 011 Req 22 + Req 9: what the notice offers where an LLM can be reached. */
export const EXCERPT_CONFIGURE_HINT = 'Configure an LLM provider to get real summaries here.';

/** A block of a zoomed level: one kept section (or the whole document at L1). */
export interface ZoomBlock {
  /** The `ZoomEntry` id — a section id, or `'document'` for the L1 entry. */
  id: string;
  depth: number;
  title: string;
  /** 1-based heading line, or 0 when the entry has no heading of its own. */
  headingLine: number;
  /** PRD 011 Req 22: the block's text, always an excerpt, always labelled. */
  body: Excerpt;
  /** PRD 011 Req 17: descendants folded in here — listed, never dropped. */
  folded: FoldedSection[];
}

/** A whole zoomed level, ready to render. */
export interface ZoomDocument {
  level: ZoomLevel;
  /** True only at L5, where the caller takes today's untouched render path. */
  verbatim: boolean;
  title: string;
  blocks: ZoomBlock[];
}

/** Bound on one block's excerpt; L1 speaks for the whole document, so it gets more. */
const BLOCK_EXCERPT_LENGTH = 240;
const DOCUMENT_EXCERPT_LENGTH = 480;

/** The source text feeding an entry's block: its own body plus everything folded in. */
function bodyOf(sources: readonly SectionNode[]): string {
  return sources
    .map((s) => s.body)
    .filter((b) => b !== '')
    .join('\n\n');
}

/**
 * PRD 011 Reqs 17+22: the level's blocks, derived from `zoomView()` entries.
 * The level→content mapping is not re-decided here — entries, depths, titles
 * and summary slots are read off the view model as it hands them over.
 */
export function buildZoomDocument(doc: DocumentSections, level: number, fallbackTitle?: string): ZoomDocument {
  const view = zoomView(doc, level, { fallbackTitle });
  return {
    level: view.level,
    verbatim: view.verbatim,
    title: view.title,
    blocks: view.entries.map((entry) => ({
      id: entry.id,
      depth: entry.depth,
      // A depth-1-less document, an empty one, a preamble entry: never blank.
      title: entry.title || (entry.id === 'preamble' ? 'Introduction' : view.title),
      headingLine: entry.headingLine,
      body: excerptFromBody(
        bodyOf(entry.sources),
        entry.summary.kind === 'document' ? DOCUMENT_EXCERPT_LENGTH : BLOCK_EXCERPT_LENGTH
      ),
      folded: entry.folded,
    })),
  };
}

/** Convenience for callers holding raw markdown rather than a parsed tree. */
export function zoomDocumentFromSource(source: string, level: number, fallbackTitle?: string): ZoomDocument {
  return buildZoomDocument(parseSections(source), level, fallbackTitle);
}

/** PRD 011 Req 19: where a click on a block lands. */
export interface DiveTarget {
  level: ZoomLevel;
  /** The section to focus at the new level; `null` when there is nothing to focus. */
  focusId: string | null;
}

/**
 * PRD 011 Req 19: clicking a heading or a block moves exactly ONE level toward
 * L5, focused on that section. Pure, so the rule is tested without a DOM: at
 * L5 there is nowhere further to dive, and the whole-document entry focuses
 * nothing in particular.
 */
export function diveFrom(level: ZoomLevel, sectionId: string): DiveTarget {
  if (!isZoomReadOnly(level)) return { level: ZOOM_LEVEL_FULL, focusId: null };
  return {
    level: clampZoomLevel(level + 1),
    focusId: sectionId === 'document' || sectionId === '' ? null : sectionId,
  };
}

/**
 * PRD 011 Req 19: the line a dive should scroll to at L5 — the focused
 * section's heading line, or null when the id names nothing with a heading.
 * The caller feeds it to the SAME scroll path the heading palette uses.
 */
export function focusLine(doc: DocumentSections, focusId: string | null): number | null {
  if (!focusId) return null;
  const section = findSection(doc, focusId);
  return section && section.headingLine > 0 ? section.headingLine : null;
}

/** PRD 011 Req 21: `+` steps toward the full document, `−` away from it. */
export function stepZoomLevel(level: ZoomLevel, delta: number): ZoomLevel {
  return clampZoomLevel(level + delta);
}

/** PRD 011 Req 21: `+` at L5 and `−` at L1 are inert rather than wrapping. */
export function canStepZoom(level: ZoomLevel, delta: number): boolean {
  return delta > 0 ? level < ZOOM_LEVEL_MAX : level > ZOOM_LEVEL_MIN;
}

/**
 * PRD 011 Req 23: the three accelerators, spelled once. `Mod+Shift+=` steps
 * toward the full document, `Mod+Shift+-` away from it, `Mod+Shift+0` returns
 * to L5 — deliberately parallel to, and distinct from, SPEC4 §4 text zoom.
 */
export const SEMANTIC_ZOOM_COMBOS = {
  semanticZoomIn: 'Mod+Shift+=',
  semanticZoomOut: 'Mod+Shift+-',
  semanticZoomReset: 'Mod+Shift+0',
} as const;
