import { describe, expect, test } from 'vitest';
import { renderMarkdown } from '../src/lib/markdown';
import { CALLOUT_KINDS, CALLOUT_LABELS, calloutKindOf } from '../src/lib/callouts';

// Issue #318: GitHub-alert callouts in the preview pipeline. The five kinds
// render as tinted callout blocks with a kind-labelled title row and the
// literal marker gone; every other blockquote renders exactly as before.

const FIVE = CALLOUT_KINDS.map((k) => `> [!${k.toUpperCase()}]\n> ${k} body text\n`).join('\n');

describe('Issue #318: GitHub-alert callouts render as tinted blocks in the preview', () => {
  test('U1244: the five kinds become .mm-callout blockquotes with a title row, the marker gone, the line stamp kept; case-insensitive; other blockquotes untouched', async () => {
    const html = await renderMarkdown(`# Doc\n\n${FIVE}`);
    for (const kind of CALLOUT_KINDS) {
      // The container: both classes, on the blockquote the pipeline stamped.
      expect(html).toMatch(new RegExp(`<blockquote data-mm-line="\\d+" class="mm-callout mm-callout-${kind}">`));
      // The title row carries the label; the body text follows it.
      expect(html).toContain(`<p class="mm-callout-title">${CALLOUT_LABELS[kind]}</p>`);
      expect(html).toContain(`<p>${kind} body text</p>`);
      // The literal marker is not body text any more (the issue's defect).
      expect(html).not.toContain(`[!${kind.toUpperCase()}]`);
    }
    expect(html.match(/mm-callout-title/g)).toHaveLength(5);

    // Case-insensitive marker; a marker-only quote drops the emptied paragraph
    // rather than leaving an empty <p> behind.
    const lower = await renderMarkdown('> [!note]\n> lower case\n');
    expect(lower).toContain('mm-callout-note');
    expect(lower).not.toContain('[!note]');
    const bare = await renderMarkdown('> [!TIP]\n');
    expect(bare).toContain('<p class="mm-callout-title">Tip</p>');
    expect(bare).not.toContain('<p></p>');

    // Not callouts: a plain quote, an unrecognised kind, a marker that is not
    // alone on its first line, and a marker on the second line. Each renders
    // as today — a bare blockquote with its text intact.
    for (const src of [
      '> just a quote\n',
      '> [!HINT]\n> not a kind\n',
      '> [!NOTE] **more** on the line\n',
      '> first\n> [!NOTE]\n',
    ]) {
      const out = await renderMarkdown(src);
      expect(out, src).not.toContain('mm-callout');
      expect(out, src).toMatch(/<blockquote data-mm-line="1">/);
    }
    expect(await renderMarkdown('> [!HINT]\n> not a kind\n')).toContain('[!HINT]');
    expect(await renderMarkdown('> [!NOTE] **more** on the line\n')).toContain('[!NOTE]');

    // The classes survive sanitize only because the schema lists them: an
    // author cannot smuggle an arbitrary class through a blockquote.
    expect(calloutKindOf('Warning')).toBe('warning');
    expect(calloutKindOf('hint')).toBeNull();

    // Nested inside a list item the callout still renders (no root-only rule).
    const nested = await renderMarkdown('- item\n\n  > [!CAUTION]\n  > inside a list\n');
    expect(nested).toContain('mm-callout-caution');
    expect(nested).toContain('<p class="mm-callout-title">Caution</p>');
  });
});
