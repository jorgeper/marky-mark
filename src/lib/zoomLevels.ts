/**
 * PRD 011 Req 17: the level-to-content mapping — given a section tree and a
 * level 1–5, what does that level show? L5 the full document verbatim, L4 all
 * headings with a per-section summary, L3 headings to depth 2 with deeper
 * sections folded into their nearest kept ancestor, L2 top-level headings
 * only, L1 the title plus one whole-document summary.
 *
 * PRD 011 Req 34: pure — a view model of plain data. It renders nothing and
 * summarizes nothing; the rendered view (#117) and the summaries (#118) are
 * its consumers.
 */

import { flattenSections, type DocumentSections, type SectionNode } from './sectionModel';

export type ZoomLevel = 1 | 2 | 3 | 4 | 5;

export const ZOOM_LEVEL_MIN = 1;
export const ZOOM_LEVEL_MAX = 5;
/** A document always opens at L5, the full document (PRD 011 Req 20). */
export const ZOOM_LEVEL_FULL: ZoomLevel = 5;

/** Shown when the document has no title heading and the caller supplied none. */
export const UNTITLED_DOCUMENT = 'Untitled document';

/** A descendant whose summary was folded into a kept ancestor's entry. */
export interface FoldedSection {
  id: string;
  depth: number;
  title: string;
}

export interface SummarySlot {
  /** `'section'` — one section (plus anything folded into it); `'document'` — the whole document. */
  kind: 'section' | 'document';
  /** Every section whose content feeds this slot, in source order. */
  sectionIds: string[];
}

export interface ZoomEntry {
  /** The kept section's stable id, or `'document'` for the whole-document entry. */
  id: string;
  depth: number;
  title: string;
  /** 1-based heading line, or 0 when the entry has no heading of its own. */
  headingLine: number;
  startLine: number;
  endLine: number;
  /** The sections feeding this entry's summary slot, in source order. */
  sources: SectionNode[];
  /** Descendants folded in here (L3, L2) — listed so nothing is silently dropped. */
  folded: FoldedSection[];
  summary: SummarySlot;
}

export interface ZoomView {
  level: ZoomLevel;
  /** True only at L5: the source is shown verbatim, never re-serialized. */
  verbatim: boolean;
  title: string;
  entries: ZoomEntry[];
}

export interface ZoomViewOptions {
  /**
   * Title to use when the document has no depth-1 heading — a filename, say.
   * The module reads no filesystem, so the caller supplies it (Req 17, L1).
   */
  fallbackTitle?: string;
}

/** Levels outside 1–5 clamp rather than throw; a non-number falls back to L5. */
export function clampZoomLevel(level: number): ZoomLevel {
  if (!Number.isFinite(level)) return ZOOM_LEVEL_FULL;
  const n = Math.round(level);
  if (n < ZOOM_LEVEL_MIN) return ZOOM_LEVEL_MIN;
  if (n > ZOOM_LEVEL_MAX) return ZOOM_LEVEL_MAX;
  return n as ZoomLevel;
}

/** The deepest heading level each zoom level keeps as its own entry. */
const KEPT_DEPTH: Record<2 | 3 | 4, number> = { 4: 6, 3: 2, 2: 1 };

function documentTitle(doc: DocumentSections, opts?: ZoomViewOptions): string {
  return doc.title || opts?.fallbackTitle || UNTITLED_DOCUMENT;
}

function newEntry(section: SectionNode): ZoomEntry {
  return {
    id: section.id,
    depth: section.depth,
    title: section.title,
    headingLine: section.headingLine,
    startLine: section.startLine,
    endLine: section.endLine,
    sources: [section],
    folded: [],
    summary: { kind: 'section', sectionIds: [section.id] },
  };
}

/** The one entry that stands for the whole document (L1, and empty documents). */
function documentEntry(doc: DocumentSections, title: string): ZoomEntry {
  const all = flattenSections(doc);
  return {
    id: 'document',
    depth: 0,
    title,
    headingLine: doc.sections[0]?.headingLine ?? 0,
    startLine: 1,
    endLine: doc.lineCount,
    sources: all,
    folded: all.map((s) => ({ id: s.id, depth: s.depth, title: s.title })),
    summary: { kind: 'document', sectionIds: all.map((s) => s.id) },
  };
}

/**
 * PRD 011 Req 17: keep every section at or above `maxDepth`; fold each deeper
 * section into its nearest kept ancestor. A deep section with no kept ancestor
 * (a document that opens at `###`) is kept in its own right rather than
 * disappearing.
 */
function entriesToDepth(doc: DocumentSections, maxDepth: number): ZoomEntry[] {
  const entries: ZoomEntry[] = [];
  if (doc.preamble) entries.push(newEntry(doc.preamble));
  const walk = (node: SectionNode, host: ZoomEntry | null): void => {
    let next = host;
    if (node.depth <= maxDepth || host === null) {
      next = newEntry(node);
      entries.push(next);
    } else {
      host.folded.push({ id: node.id, depth: node.depth, title: node.title });
      host.sources.push(node);
      host.summary.sectionIds.push(node.id);
    }
    for (const child of node.children) walk(child, next);
  };
  for (const root of doc.sections) walk(root, null);
  return entries;
}

/**
 * PRD 011 Req 17 / Req 34: the level-to-content mapping. Ordered, source-order
 * entries saying what the level shows and which sections feed each summary
 * slot. Every level yields at least one usable entry, including for a document
 * with no headings at all.
 */
export function zoomView(doc: DocumentSections, level: number, opts?: ZoomViewOptions): ZoomView {
  const clamped = clampZoomLevel(level);
  const title = documentTitle(doc, opts);

  // L5 shows the source verbatim — no entries, and nothing to summarize.
  if (clamped === 5) return { level: clamped, verbatim: true, title, entries: [] };

  // L1 is the title plus a single whole-document summary slot.
  if (clamped === 1) {
    return { level: clamped, verbatim: false, title, entries: [documentEntry(doc, title)] };
  }

  const entries = entriesToDepth(doc, KEPT_DEPTH[clamped]);
  return {
    level: clamped,
    verbatim: false,
    title,
    entries: entries.length > 0 ? entries : [documentEntry(doc, title)],
  };
}
