import { describe, expect, test } from 'vitest';
import { SUMMARY_OUTPUT_TOKENS } from '../../src/lib/llmCost';
import {
  boundSummaryInput,
  buildSummaryRequest,
  summarySystemPrompt,
  SUMMARY_INPUT_MAX_CHARS,
  SUMMARY_TRUNCATION_MARKER,
} from '../../src/lib/summaryPrompt';
import { SUMMARY_PROMPT_VERSION } from '../../src/lib/summaryCache';

describe('PRD 011 Req 25 — the summarization prompt is the app’s, and bounded', () => {
  test('U597: every request the feature builds is attributable and capped at the existing allowance', () => {
    const request = buildSummaryRequest({
      level: 4,
      kind: 'section',
      title: 'Editing',
      source: 'Editing prose.',
    });
    // PRD 011 Req 16: an unattributable summary request cannot be built.
    expect(request.trigger).toBe('summarize');
    // The output allowance is `llmCost.ts`'s, not a second number beside it.
    expect(request.maxOutputTokens).toBe(SUMMARY_OUTPUT_TOKENS);
    expect(request.system).toBe(summarySystemPrompt('section'));
    expect(request.prompt).toContain('Section: Editing');
    expect(request.prompt).toContain('Editing prose.');
  });

  test('U598: the shape asked for is the level’s — sentences per section, one paragraph for the document', () => {
    expect(summarySystemPrompt('section')).toMatch(/three sentences/i);
    expect(summarySystemPrompt('document')).toMatch(/ONE paragraph/);
    // Neither asks for markdown: the view renders a plain paragraph.
    for (const kind of ['section', 'document'] as const) {
      expect(summarySystemPrompt(kind)).toMatch(/no markdown/i);
    }
    const doc = buildSummaryRequest({ level: 1, kind: 'document', title: 'Notes', source: 'All of it.' });
    expect(doc.prompt).toContain('Document: Notes');
    // The prompt is authored here for the first time, so the version stays p1.
    expect(SUMMARY_PROMPT_VERSION).toBe('p1');
  });

  test('U599: a very long section cannot build an unbounded request', () => {
    const huge = `${'word '.repeat(20_000)}`;
    const bounded = boundSummaryInput(huge);
    expect(bounded.length).toBeLessThanOrEqual(SUMMARY_INPUT_MAX_CHARS + SUMMARY_TRUNCATION_MARKER.length);
    expect(bounded.endsWith(SUMMARY_TRUNCATION_MARKER)).toBe(true);
    // Deterministic: the same text always bounds to the same text.
    expect(boundSummaryInput(huge)).toBe(bounded);
    // Under the bound, nothing is touched and nothing is marked.
    expect(boundSummaryInput('short enough')).toBe('short enough');
    // A cut near a line break lands on it rather than mid-sentence, but a
    // document whose only newline is at the very start is not truncated to it.
    expect(boundSummaryInput(`${'a'.repeat(40)}\n${'b'.repeat(40)}`, 45)).toBe(
      `${'a'.repeat(40)}${SUMMARY_TRUNCATION_MARKER}`
    );
    expect(boundSummaryInput(`ab\n${'c'.repeat(100)}`, 50)).toContain('c'.repeat(40));
    expect(buildSummaryRequest({ level: 1, kind: 'document', title: 'T', source: huge }).prompt.length)
      .toBeLessThan(SUMMARY_INPUT_MAX_CHARS + 200);
  });
});
