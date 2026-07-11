import { describe, expect, test } from 'vitest';
import { renderMarkdown } from '../../src/lib/markdown';

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
});
