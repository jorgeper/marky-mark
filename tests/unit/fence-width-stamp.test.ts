import { describe, expect, test } from 'vitest';
import { renderMarkdown } from '../../src/lib/markdown';

/** The rendered plain text — the comment-anchor coordinate space (U28's strip). */
const textOf = (html: string) => html.replace(/<[^>]*>/g, '');

const fence = (info: string) => `# Title\n\n\`\`\`${info}\ngraph TD\n  A --> B\n\`\`\`\n`;

describe('PRD 015 Req 4: the fence width reaches the preview as an inert data attribute', () => {
  test('U776: a width-bearing fence renders with data-mm-width on its code element — and differs from the widthless render by that attribute only', async () => {
    const plain = await renderMarkdown(fence('mermaid'));
    const sized = await renderMarkdown(fence('mermaid width=500'));
    expect(sized).toMatch(/<code class="hljs language-mermaid" data-mm-width="500">/);
    // Attribute-only: removing the one stamp restores today's HTML byte-for-byte
    // (the sanitize schema did not widen and no other node moved)…
    expect(sized.replace(' data-mm-width="500"', '')).toBe(plain);
    // …and the rendered text — the anchor coordinate space — is untouched.
    expect(textOf(sized)).toBe(textOf(plain));
    expect(textOf(sized)).not.toContain('width');
  });

  test('U777: the stamped value is the parsed positive integer, found wherever the token sits among the meta', async () => {
    // Parsed, never raw document text: leading zeros normalize away.
    expect(await renderMarkdown(fence('mermaid width=00320'))).toContain('data-mm-width="320"');
    // The token is read from the full info string, not just the first meta word.
    expect(await renderMarkdown(fence('mermaid foo=bar width=250 baz'))).toContain('data-mm-width="250"');
  });

  test('U778: an absent or intolerable width token (PRD 015 Req 3) stamps nothing — the fence renders exactly as today, and height= is never read', async () => {
    const plain = await renderMarkdown(fence('mermaid'));
    for (const meta of ['width=abc', 'width=500px', 'width=12.5', 'width=0', 'width=-40', 'width', 'height=300']) {
      const html = await renderMarkdown(fence(`mermaid ${meta}`));
      expect(html).not.toContain('data-mm-width');
      expect(html).not.toContain('data-mm-height');
      expect(html).toBe(plain); // byte-identical: no badge, no failure state, no residue
    }
  });
});
