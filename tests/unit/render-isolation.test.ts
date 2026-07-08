import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from '../../src/lib/markdown';

const fixture = readFileSync(fileURLToPath(new URL('../../fixtures/adversarial.md', import.meta.url)), 'utf8');

describe('renderer network isolation (SPEC11 §1)', () => {
  test('U18: rendering the adversarial corpus yields no remote src; placeholders name the origin; local content survives', async () => {
    const html = await renderMarkdown(fixture);

    // No element loads from the network: every src is local-protocol only.
    for (const m of html.matchAll(/src="([^"]*)"/g)) {
      expect(m[1], m[0]).not.toMatch(/^(?:https?:)?\/\//i);
    }

    // Both remote images became inert placeholders naming the blocked origin.
    const placeholders = html.match(/mm-blocked-remote/g) ?? [];
    expect(placeholders.length).toBe(2);
    expect(html).toContain('remote image (evil.example.com');
    expect(html).toContain('Marky Mark is local-only');
    expect(html).toContain('tracking pixel'); // the alt text is preserved in the label

    // The local image and the fragment link survive untouched.
    expect(html).toContain('src="./local.png"');
    expect(html).toContain('href="#adversarial"');

    // Remote *links* keep their href (click-time policy handles them) but
    // nothing else remote remains loadable.
    expect(html).toContain('href="https://evil.example.com/phone-home"');
  });
});
