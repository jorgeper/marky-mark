/**
 * PRD 011 Req 25: the summarization prompt — the APP's, never the user's.
 * One module builds the system + user text for a zoom slot from the level and
 * the entry's own source, so there is exactly one place the question asked of
 * a provider is written, and #119's estimator and this issue's generator
 * cannot drift apart.
 *
 * PRD 011 Req 17: it asks for the shape the levels promise — 2–3 sentences per
 * section, one paragraph for the whole document at L1 — and bounds both ends of
 * the request: `maxOutputTokens` from `llmCost.ts`'s existing allowance, and the
 * input at {@link SUMMARY_INPUT_MAX_CHARS} so a very long section cannot build
 * an unbounded request.
 *
 * PRD 011 Req 34: pure. It sends nothing, holds no provider state and reads no
 * clock — a caller hands it text and gets an `LlmRequest` value back.
 */

import { SUMMARY_OUTPUT_TOKENS } from './llmCost';
import type { LlmRequest } from './llmSeam';
import type { ZoomLevel } from './zoomLevels';

/**
 * PRD 011 Req 25: the bound on what one slot may send, in characters.
 * 12,000 characters is roughly 3,000 tokens — comfortably more than any
 * section a reader writes by hand, and small enough that a pathological input
 * (a whole book pasted under one heading, or L1's fold-everything slot on a
 * long document) still costs a bounded, predictable request rather than
 * whatever the buffer happens to hold.
 */
export const SUMMARY_INPUT_MAX_CHARS = 12_000;

/** Appended when the bound bit, so the model is told its input was cut. */
export const SUMMARY_TRUNCATION_MARKER = '\n\n[…truncated for length]';

/** What one summary slot asks about: the level, its shape, and its text. */
export interface SummaryPromptInput {
  level: ZoomLevel;
  /** `'document'` is L1's whole-document slot; `'section'` is every other. */
  kind: 'section' | 'document';
  /** The block's heading, so the model knows what it is summarizing. */
  title: string;
  /** The entry's own content plus everything folded into it, in source order. */
  source: string;
}

/**
 * PRD 011 Req 25: the input bound, applied at a line boundary where one is
 * near the cut so the model is not handed half a sentence. Deterministic —
 * the same text always bounds to the same text.
 */
export function boundSummaryInput(text: string, maxChars: number = SUMMARY_INPUT_MAX_CHARS): string {
  const limit = Math.max(1, Math.floor(maxChars));
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const newline = head.lastIndexOf('\n');
  // Only honour a line break in the last fifth of the cut: a document whose
  // first newline is at character 3 must not truncate to three characters.
  const kept = newline > limit * 0.8 ? head.slice(0, newline) : head;
  return `${kept.replace(/\s+$/, '')}${SUMMARY_TRUNCATION_MARKER}`;
}

/**
 * PRD 011 Req 17: what the model is asked for, per slot shape. The document
 * slot speaks for the whole document in one paragraph; a section slot gets the
 * 2–3 sentences the level promises. Neither asks for markdown: the view
 * renders the answer as a plain paragraph.
 */
export function summarySystemPrompt(kind: 'section' | 'document'): string {
  const shape =
    kind === 'document'
      ? 'Write ONE paragraph of at most five sentences summarizing the whole document.'
      : 'Write at most three sentences summarizing this section.';
  return [
    'You summarize Markdown documents for a reader browsing them at a zoomed-out level.',
    shape,
    'Write plain prose: no headings, no bullet points, no markdown formatting, no preamble',
    'such as "This section" or "Here is a summary" — just the summary itself.',
    'Summarize only what the text says; add nothing that is not there.',
  ].join(' ');
}

/** The user half: the heading the text sits under, then the bounded text. */
export function summaryUserPrompt(input: SummaryPromptInput): string {
  const heading = input.kind === 'document' ? `Document: ${input.title}` : `Section: ${input.title}`;
  return `${heading}\n\n${boundSummaryInput(input.source)}`;
}

/**
 * PRD 011 Req 25: the one request this feature ever builds. `trigger` is
 * `'summarize'` on every one of them — an unattributable request cannot be
 * constructed (PRD 011 Req 16) — and the output allowance is `llmCost.ts`'s
 * existing `SUMMARY_OUTPUT_TOKENS`, so the estimate and the request agree.
 *
 * The prompt is being authored here for the FIRST time, so
 * `SUMMARY_PROMPT_VERSION` stays `p1`: there are no cached summaries in the
 * wild that answered a different question.
 */
export function buildSummaryRequest(input: SummaryPromptInput): LlmRequest {
  return {
    trigger: 'summarize',
    system: summarySystemPrompt(input.kind),
    prompt: summaryUserPrompt(input),
    maxOutputTokens: SUMMARY_OUTPUT_TOKENS,
  };
}
