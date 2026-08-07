import { describe, expect, test } from 'vitest';
import { EXCERPT_MAX_LENGTH, EXCERPT_PLACEHOLDER, excerptFromBody } from '../../src/lib/sectionExcerpt';

describe('PRD 011 Req 22 — deterministic excerpt fallback', () => {
  test('U498: the opening sentences carry through, tagged as an excerpt', () => {
    const excerpt = excerptFromBody('First sentence here. Second sentence here.\n\nA later paragraph.');
    expect(excerpt).toEqual({
      kind: 'excerpt',
      text: 'First sentence here. Second sentence here. A later paragraph.',
      truncated: false,
      placeholder: false,
    });
  });

  test('U499: the same input always yields the same output', () => {
    const body = 'Alpha beta gamma. '.repeat(40);
    const first = excerptFromBody(body);
    for (let i = 0; i < 5; i++) expect(excerptFromBody(body)).toEqual(first);
  });

  test('U500: overlong bodies truncate on a sentence boundary with an explicit ellipsis', () => {
    const sentence = 'This sentence is exactly the sort of thing a section body opens with. ';
    const excerpt = excerptFromBody(sentence.repeat(10));
    expect(excerpt.truncated).toBe(true);
    expect(excerpt.text.endsWith('…')).toBe(true);
    expect(excerpt.text.length).toBeLessThanOrEqual(EXCERPT_MAX_LENGTH + 1);
    expect(excerpt.text.slice(0, -1).trim().endsWith('.')).toBe(true);

    // A first sentence longer than the bound is cut at a word boundary.
    const runOn = `${'word '.repeat(120).trim()}.`;
    const cut = excerptFromBody(runOn);
    expect(cut.truncated).toBe(true);
    expect(cut.text.endsWith('word…')).toBe(true);
    expect(cut.text.length).toBeLessThanOrEqual(EXCERPT_MAX_LENGTH + 1);

    // The bound is a parameter, so callers can ask for a tighter excerpt.
    expect(excerptFromBody('Ten chars. Twenty chars here.', 12).text).toBe('Ten chars.…');
  });

  test('U501: markdown noise is handled — markers stripped, links reduced, emphasis unwrapped', () => {
    const body = [
      '> - A **bold** point about [the docs](https://example.com/docs) and `code`.',
      '- 1. *Nested* emphasis with ~~strikethrough~~ and an ![image](pic.png).',
    ].join('\n');
    const excerpt = excerptFromBody(body);
    expect(excerpt.text).toBe(
      'A bold point about the docs and code. 1. Nested emphasis with strikethrough and an image.'
    );
    expect(excerpt.text).not.toMatch(/[*_>`[\]]|https?:/);
  });

  test('U502: code fences and tables are skipped rather than emitted raw', () => {
    const body = [
      '```ts',
      'const secret = 1; // not prose',
      '```',
      '',
      '| col | col |',
      '| --- | --- |',
      '| a   | b   |',
      '',
      'The prose after the table.',
    ].join('\n');
    const excerpt = excerptFromBody(body);
    expect(excerpt.text).toBe('The prose after the table.');
    expect(excerpt.placeholder).toBe(false);
  });

  test('U503: a body with nothing quotable yields a stable placeholder, never an empty string', () => {
    for (const body of ['', '   \n\n  ', '```\ncode only\n```', '| a | b |\n| - | - |', '---']) {
      const excerpt = excerptFromBody(body);
      expect(excerpt.text, JSON.stringify(body)).toBe(EXCERPT_PLACEHOLDER);
      expect(excerpt.placeholder).toBe(true);
      expect(excerpt.kind).toBe('excerpt');
    }
  });
});
