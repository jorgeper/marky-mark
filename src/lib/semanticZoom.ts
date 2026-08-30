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
 * state. #118 widened `ZoomBlock.body` from an `Excerpt` to the four-state
 * union below — excerpt, pending, summary, failure — but the decision is still
 * a pure function over plain state, and this module still sends nothing.
 */

import { testFailureMessage } from './llmSettings.ts';
import { excerptFromBody, type Excerpt } from './sectionExcerpt.ts';
import { findSection, parseSections, type DocumentSections, type SectionNode } from './sectionModel.ts';
import { summaryKeyForEntry, type SummaryKeyContext } from './summaryCache.ts';
import type { SummarySlotState, SummaryStates } from './summaryPlan.ts';
import {
  clampZoomLevel,
  zoomView,
  ZOOM_LEVEL_FULL,
  ZOOM_LEVEL_MAX,
  ZOOM_LEVEL_MIN,
  type FoldedSection,
  type ZoomLevel,
  type ZoomView,
} from './zoomLevels.ts';

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

/**
 * PRD 011 Req 22: the counterpart notice, for a level whose blocks really are
 * model-generated. Stated once for the view, exactly as the excerpt notice is —
 * the view never claims a block is an excerpt when it is a summary.
 */
export const SUMMARY_NOTICE =
  'These summaries are written by the configured LLM provider from each section’s own text.';

/**
 * PRD 011 Reqs 22+26+27: what a block is showing right now — four states a
 * reader (and a test) can tell apart. `excerpt` is #117's value unchanged.
 */
export type ZoomBody =
  | Excerpt
  | { kind: 'pending' }
  | { kind: 'summary'; text: string }
  | { kind: 'failure'; message: string };

/** A block of a zoomed level: one kept section (or the whole document at L1). */
export interface ZoomBlock {
  /** The `ZoomEntry` id — a section id, or `'document'` for the L1 entry. */
  id: string;
  depth: number;
  title: string;
  /** 1-based heading line, or 0 when the entry has no heading of its own. */
  headingLine: number;
  /** PRD 011 Reqs 22+26+27: what this block shows — one of the four states. */
  body: ZoomBody;
  /**
   * PRD 011 Req 27: the summary cache key this block's state is filed under —
   * what a retry re-requests. Null where no provider can be reached, so there
   * is no key and no retry.
   */
  summaryKey: string | null;
  /** PRD 011 Req 17: descendants folded in here — listed, never dropped. */
  folded: FoldedSection[];
}

/** A whole zoomed level, ready to render. */
export interface ZoomDocument {
  level: ZoomLevel;
  /** True only at L5, where the caller takes today's untouched render path. */
  verbatim: boolean;
  title: string;
  /**
   * PRD 011 Req 22: true when these blocks are summaries (or on their way to
   * being ones), false when they are excerpts. It decides WHICH notice the view
   * states — never both, never the wrong one.
   */
  summarized: boolean;
  blocks: ZoomBlock[];
}

/**
 * PRD 011 Req 22: the summary state a level was built against — the key context
 * that names the provider and model, and what each key has answered so far.
 * Absent (or null) is the no-provider case: every block is an excerpt.
 */
export interface ZoomSummaries {
  ctx: SummaryKeyContext;
  states: SummaryStates;
}

/**
 * PRD 011 Reqs 22+26+27: "what does this block show right now?", as one pure
 * function over (no provider | in flight | cache hit or generated | failed).
 * The React view holds none of this — it renders the answer.
 *
 * With a provider available, a block whose state has not arrived yet is
 * PENDING, never an excerpt: an excerpt shown under a summary notice would be
 * a silent lie about what the reader is reading (Req 22).
 */
export function zoomBlockBody(
  excerpt: Excerpt,
  summarizing: boolean,
  state: SummarySlotState | undefined
): ZoomBody {
  if (!summarizing) return excerpt;
  if (!state) return { kind: 'pending' };
  switch (state.status) {
    case 'summary':
      return { kind: 'summary', text: state.text };
    case 'failed':
      // PRD 011 Req 27: the seam's OWN sentence, through the one helper the
      // settings area's test connection already uses. No second wording.
      return { kind: 'failure', message: testFailureMessage(state.failure) };
    // Exhaustive on purpose: a fifth slot state has to decide what it renders
    // here rather than falling silently into the pending case.
    case 'pending':
      return { kind: 'pending' };
  }
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
export function buildZoomDocument(
  doc: DocumentSections,
  level: number,
  fallbackTitle?: string,
  summaries?: ZoomSummaries | null
): ZoomDocument {
  return buildZoomDocumentFromView(zoomView(doc, level, { fallbackTitle }), summaries);
}

/**
 * The same blocks, for a caller that already holds the `ZoomView` — the
 * summary planner needs the entries themselves (their sources feed the
 * prompts), so this lets one `zoomView()` serve both rather than two.
 */
export function buildZoomDocumentFromView(view: ZoomView, summaries?: ZoomSummaries | null): ZoomDocument {
  const summarizing = !!summaries;
  return {
    level: view.level,
    verbatim: view.verbatim,
    title: view.title,
    summarized: summarizing,
    blocks: view.entries.map((entry) => {
      const key = summaries ? summaryKeyForEntry(entry, { ...summaries.ctx, level: view.level }) : null;
      const excerpt = excerptFromBody(
        bodyOf(entry.sources),
        entry.summary.kind === 'document' ? DOCUMENT_EXCERPT_LENGTH : BLOCK_EXCERPT_LENGTH
      );
      return {
        id: entry.id,
        depth: entry.depth,
        // A depth-1-less document, an empty one, a preamble entry: never blank.
        title: entry.title || (entry.id === 'preamble' ? 'Introduction' : view.title),
        headingLine: entry.headingLine,
        body: zoomBlockBody(excerpt, summarizing, key ? summaries?.states.get(key) : undefined),
        summaryKey: key,
        folded: entry.folded,
      };
    }),
  };
}

/** Convenience for callers holding raw markdown rather than a parsed tree. */
export function zoomDocumentFromSource(
  source: string,
  level: number,
  fallbackTitle?: string,
  summaries?: ZoomSummaries | null
): ZoomDocument {
  return buildZoomDocument(parseSections(source), level, fallbackTitle, summaries);
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
