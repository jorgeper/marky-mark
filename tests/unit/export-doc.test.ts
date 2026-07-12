import { describe, expect, test } from 'vitest';
import { buildExportMarkdown, buildPrintHtml, statsLine } from '../../src/lib/exportDoc';
import { buildReviewBundle, extractReviewPayload, REVIEW_PAYLOAD_ID } from '../../src/lib/reviewBundle';
import type { CommentData } from '../../src/lib/anchoring';

// 'Doc' + 218 × 'word' + 'last' = exactly 220 countable words ('#' is not one).
const BUFFER = '# Doc\n\n' + 'word '.repeat(218) + 'last\n';
const COMMENTS: CommentData[] = [
  {
    id: 'c1',
    anchor: { exact: 'word', prefix: '', suffix: ' ', start: 4, end: 8 },
    author: 'T',
    createdAt: '2026-07-11T00:00:00.000Z',
    body: 'note',
    thread: [],
    resolved: false,
  },
];

const TEMPLATE = '<!doctype html><html><head><title>t</title></head><body>app</body></html>';
function docWith(html: string) {
  const m = new RegExp(`<script type="application/json" id="${REVIEW_PAYLOAD_ID}">([\\s\\S]*?)</script>`).exec(html);
  return { getElementById: (id: string) => (id === REVIEW_PAYLOAD_ID && m ? { textContent: m[1] } : null) };
}

describe('SPEC17 export builders', () => {
  test('U36: buildExportMarkdown option combos are exact; payload theme round-trips', () => {
    // 220 words → '220 words · 1 min read'.
    expect(statsLine(BUFFER)).toBe('220 words · 1 min read');

    const both = buildExportMarkdown(BUFFER, COMMENTS, { includeComments: true, includeWordCount: true });
    expect(both).toContain('markimark-comments');
    expect(both.trimEnd().endsWith('*220 words · 1 min read*')).toBe(true);
    expect(both.startsWith(BUFFER.trimEnd().slice(0, 20))).toBe(true);

    const commentsOnly = buildExportMarkdown(BUFFER, COMMENTS, { includeComments: true, includeWordCount: false });
    expect(commentsOnly).toContain('markimark-comments');
    expect(commentsOnly).not.toContain('min read');

    const statsOnly = buildExportMarkdown(BUFFER, COMMENTS, { includeComments: false, includeWordCount: true });
    expect(statsOnly).not.toContain('markimark-comments');
    expect(statsOnly.trimEnd().endsWith('*220 words · 1 min read*')).toBe(true);

    const neither = buildExportMarkdown(BUFFER, COMMENTS, { includeComments: false, includeWordCount: false });
    expect(neither).toBe(BUFFER); // byte-identical source

    // Optional theme travels through the bundle untouched.
    const bundle = buildReviewBundle(TEMPLATE, { name: 'd.md', markdown: BUFFER, theme: 'dracula' });
    const round = extractReviewPayload(docWith(bundle));
    expect(round!.theme).toBe('dracula');
    expect(round!.markdown).toBe(BUFFER);
    // Absent stays absent.
    const plain = buildReviewBundle(TEMPLATE, { name: 'd.md', markdown: BUFFER });
    expect(extractReviewPayload(docWith(plain))!.theme).toBeUndefined();
  });

  test('U37: buildPrintHtml is a standalone themed document; stats optional; no remote refs introduced', () => {
    const themeCss = '.theme-root { --mm-bg: #123456; }';
    const rendered = '<h1 data-mm-line="1">Doc</h1><p>Hello <mark class="hl">marked</mark> text.</p>';

    const withStats = buildPrintHtml(rendered, themeCss, '220 words · 1 min read');
    expect(withStats.startsWith('<!doctype html>')).toBe(true);
    expect(withStats).toContain(themeCss);
    expect(withStats).toContain('marked');
    expect(withStats).toContain('220 words · 1 min read');
    expect(withStats).toContain('theme-root');
    expect(withStats).not.toMatch(/src\s*=\s*["']https?:/i);
    expect(withStats).not.toMatch(/@import/i);

    const without = buildPrintHtml(rendered, themeCss);
    expect(without).not.toContain('min read');
  });
});
