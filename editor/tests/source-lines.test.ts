import { describe, expect, test } from 'vitest';
import { renderMarkdown } from '../src/lib/markdown';

const FIXTURE = `# Title

A paragraph.

\`\`\`js
code();
\`\`\`

- one
- two

| a | b |
| - | - |
| 1 | 2 |
`;

describe('SPEC15 source-line anchors', () => {
  test('U28: top-level blocks carry data-mm-line with correct source lines; text content is untouched', async () => {
    const html = await renderMarkdown(FIXTURE);
    expect(html).toContain('<h1 data-mm-line="1"');
    expect(html).toContain('<p data-mm-line="3"');
    expect(html).toMatch(/<pre data-mm-line="5"/);
    expect(html).toMatch(/<ul data-mm-line="9"/);
    expect(html).toMatch(/<table data-mm-line="12"/);
    // The attribute never leaks into rendered text (comment coordinate space).
    const text = html.replace(/<[^>]*>/g, '');
    expect(text).not.toContain('data-mm-line');
    expect(text).toContain('A paragraph.');
    expect(text).toContain('code();');
  });

  // Intent (issue #226): a heading nested inside a container — a blockquote,
  // or indented under a list item, the shape behind "headings at the bottom
  // of the file miss the link icon" — is not a root child, so SPEC15's
  // data-mm-line never lands on it. The render pipeline must still mark its
  // source line (as data-mm-hline, so the SPEC15 "stamps are top-level
  // blocks" contract for scroll sync stays intact) for the PRD 020 Req 18
  // copy-link graft and the Req 19 landing to find it.
  test('U1084: container-nested headings carry data-mm-hline; root stamps and rendered text are unchanged', async () => {
    const src = ['# Top', '', '> ## Quoted', '', '- item', '  ### Listed', ''].join('\n');
    const html = await renderMarkdown(src);
    expect(html).toContain('<h1 data-mm-line="1"');
    expect(html).toMatch(/<h2 data-mm-hline="3">Quoted<\/h2>/);
    expect(html).toMatch(/<h3 data-mm-hline="6">Listed<\/h3>/);
    // Nested headings never take the top-level block stamp…
    expect(html).not.toMatch(/<h2 data-mm-line/);
    expect(html).not.toMatch(/<h3 data-mm-line/);
    // …and the attribute never leaks into rendered text.
    const text = html.replace(/<[^>]*>/g, '');
    expect(text).not.toContain('data-mm');
    expect(text).toContain('Quoted');
    expect(text).toContain('Listed');
  });
});
