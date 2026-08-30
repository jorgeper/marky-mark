/**
 * PRD 011 Req 28: summaries are cached by section content hash, so unchanged
 * content is never summarized twice — across zoom cycles, reopens and app
 * restarts. Editing a section invalidates only that section; moving an
 * unchanged section elsewhere in the document keeps its key.
 *
 * PRD 011 Req 34: pure key arithmetic only. This module holds no cache and
 * touches no store — the desktop/hosted stores are #115.
 */

import { sectionContent, type SectionNode } from './sectionModel.ts';
import type { ZoomLevel, ZoomEntry } from './zoomLevels.ts';

/**
 * Bump when the prompt or the expected summary format changes: old summaries
 * answered a different question and must not be served for the new one.
 */
export const SUMMARY_PROMPT_VERSION = 'p1';

/** Key namespace, so a future keying scheme can coexist with this one. */
const KEY_SCHEME = 'mmz1';

export interface SummaryKeyContext {
  /** The requested summary shape: the zoom level asking for it. */
  level: ZoomLevel;
  providerId: string;
  modelId: string;
  /** Defaults to `SUMMARY_PROMPT_VERSION`. */
  promptVersion?: string;
}

/**
 * FNV-1a, the same in-repo arithmetic as `sessionKeyForWorkspaceFile`
 * (`workspace.ts`) — no dependency, no crypto, no network.
 */
export function fnv1a32(text: string, basis: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const hex8 = (n: number): string => n.toString(16).padStart(8, '0');

/**
 * A 64-bit-wide content hash: two FNV-1a passes over the same text from
 * different offset bases. Deterministic across runs and process restarts —
 * plain integer arithmetic over the content, nothing ambient.
 */
export function contentHash(parts: readonly string[]): string {
  // Length-prefixed and delimited, so ['ab','c'] cannot hash the same as
  // ['a','bc']. The delimiters stay written as escapes: a raw control byte
  // here would make git treat this whole file as binary.
  const text = parts.map((p) => `${p.length}\u0000${p}`).join('\u0001');
  return `${hex8(fnv1a32(text, 0x811c9dc5))}${hex8(fnv1a32(text, 0x01000193))}`;
}

/** Ids reach the key as-is where they can; anything else becomes a dash. */
const tag = (value: string): string => (value || 'none').replace(/[^A-Za-z0-9_.-]+/g, '-');

/**
 * PRD 011 Req 28: the cache key — the content hash plus everything else that
 * changes the answer (level, provider, model, prompt version). The section's
 * id and position are deliberately absent: moving unchanged content must not
 * invalidate its summary.
 */
export function summaryCacheKey(contents: readonly string[], ctx: SummaryKeyContext): string {
  const version = ctx.promptVersion ?? SUMMARY_PROMPT_VERSION;
  return [
    KEY_SCHEME,
    tag(version),
    tag(ctx.providerId),
    tag(ctx.modelId),
    `l${ctx.level}`,
    contentHash(contents),
  ].join(':');
}

/** The cache key for one section's summary. */
export function summaryKeyForSection(section: SectionNode, ctx: SummaryKeyContext): string {
  return summaryCacheKey([sectionContent(section)], ctx);
}

/**
 * The cache key for a zoom entry: at L4 that is one section, at L3/L2/L1 the
 * kept section plus everything folded into it, so the folded-in content is
 * part of what the key answers for.
 */
export function summaryKeyForEntry(entry: ZoomEntry, ctx: SummaryKeyContext): string {
  return summaryCacheKey(entry.sources.map(sectionContent), ctx);
}

export interface KeyedSection {
  id: string;
  key: string;
}

export interface CacheReconciliation {
  /** Every key the current sections need, in source order. */
  needed: KeyedSection[];
  /** Keys the previous sections already produced and the current ones still want. */
  valid: string[];
  /** Keys the previous sections produced that nothing wants now — evictable. */
  stale: string[];
  /** Needed keys the previous sections never produced — these must be generated. */
  missing: string[];
}

/**
 * PRD 011 Req 28: given the previous and current section lists, which cached
 * keys survive the edit and which went stale. Content-addressed, so an edit to
 * one section strands exactly that section's key.
 */
export function reconcileSummaryKeys(
  previous: readonly SectionNode[],
  current: readonly SectionNode[],
  ctx: SummaryKeyContext
): CacheReconciliation {
  const before = new Set(previous.map((s) => summaryKeyForSection(s, ctx)));
  const needed = current.map((s) => ({ id: s.id, key: summaryKeyForSection(s, ctx) }));
  const wanted = new Set(needed.map((n) => n.key));
  return {
    needed,
    valid: [...wanted].filter((k) => before.has(k)),
    stale: [...before].filter((k) => !wanted.has(k)),
    missing: [...wanted].filter((k) => !before.has(k)),
  };
}
