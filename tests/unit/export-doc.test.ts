import { describe, expect, test } from 'vitest';
import { buildStaticHtml, statsLine, type StaticComment } from '../../src/lib/exportDoc';
import { buildReviewBundle, extractReviewPayload, REVIEW_PAYLOAD_ID } from '../../src/lib/reviewBundle';

// 'Doc' + 218 × 'word' + 'last' = exactly 220 countable words ('#' is not one).
const BUFFER = '# Doc\n\n' + 'word '.repeat(218) + 'last\n';

const TEMPLATE = '<!doctype html><html><head><title>t</title></head><body>app</body></html>';
function docWith(html: string) {
  const m = new RegExp(`<script type="application/json" id="${REVIEW_PAYLOAD_ID}">([\\s\\S]*?)</script>`).exec(html);
  return { getElementById: (id: string) => (id === REVIEW_PAYLOAD_ID && m ? { textContent: m[1] } : null) };
}

describe('SPEC17/SPEC18 export builders', () => {
  test('U36: statsLine math; payload theme round-trips through the bundle format', () => {
    expect(statsLine(BUFFER)).toBe('220 words · 1 min read');
    expect(statsLine('')).toBe('0 words · 0 min read');

    // The bundle FORMAT stays (SPEC18 §3.2) — the web viewer still opens it.
    const bundle = buildReviewBundle(TEMPLATE, { name: 'd.md', markdown: BUFFER, theme: 'dracula' });
    const round = extractReviewPayload(docWith(bundle));
    expect(round!.theme).toBe('dracula');
    expect(round!.markdown).toBe(BUFFER);
    const plain = buildReviewBundle(TEMPLATE, { name: 'd.md', markdown: BUFFER });
    expect(extractReviewPayload(docWith(plain))!.theme).toBeUndefined();
  });

  test('U37: buildStaticHtml is a standalone themed reading page — theme css, body, optional stats; nothing remote', () => {
    const themeCss = '.theme-root { --mm-bg: #123456; }';
    const bodyHtml = '<h1 data-mm-line="1">Doc</h1><p>Hello <mark class="hl">marked</mark> text.</p>';

    const withStats = buildStaticHtml({ title: 'doc.md', bodyHtml, themeCss, stats: '220 words · 1 min read' });
    expect(withStats.startsWith('<!doctype html>')).toBe(true);
    expect(withStats).toContain('<title>doc.md</title>');
    expect(withStats).toContain(themeCss);
    expect(withStats).toContain('marked');
    expect(withStats).toContain('220 words · 1 min read');
    expect(withStats).toContain('theme-root');
    expect(withStats).not.toMatch(/src\s*=\s*["']https?:/i);
    expect(withStats).not.toMatch(/@import/i);

    const without = buildStaticHtml({ title: 'doc.md', bodyHtml, themeCss });
    expect(without).not.toContain('min read');
  });

  test('U39: static pages carry zero scripts; comments render as numbered static notes; title is escaped', () => {
    const comments: StaticComment[] = [
      {
        n: 1,
        excerpt: 'marked <text>',
        author: 'Reviewer',
        body: 'a note with <angle> brackets',
        replies: [{ author: 'Author', body: 'a reply' }],
      },
      { n: 2, excerpt: 'other', author: 'R2', body: 'second', replies: [] },
    ];
    const page = buildStaticHtml({
      title: '<script>evil</script>.md',
      bodyHtml: '<p>Body <mark class="hl">marked</mark><sup class="mm-ref"><a href="#mm-comment-1">1</a></sup></p>',
      themeCss: '.theme-root{}',
      comments,
    });

    // Fully static: not one script tag, ever (the body sup ref is the only interactivity — a plain anchor).
    expect(page.match(/<script/gi)).toBeNull();
    // Comments section: numbered ids matching the in-text refs, content escaped.
    expect(page).toContain('id="mm-comment-1"');
    expect(page).toContain('id="mm-comment-2"');
    expect(page).toContain('href="#mm-comment-1"');
    expect(page).toContain('a note with &lt;angle&gt; brackets');
    expect(page).toContain('marked &lt;text&gt;');
    expect(page).toContain('a reply');
    expect(page).toContain('<h2>Comments</h2>');
    // Title escaped.
    expect(page).toContain('<title>&lt;script&gt;evil&lt;/script&gt;.md</title>');

    // comments: [] (checked but none open) and absent (unchecked) both omit the section.
    const empty = buildStaticHtml({ title: 't', bodyHtml: '<p>x</p>', themeCss: '', comments: [] });
    expect(empty).not.toContain('<h2>Comments</h2>');
    const off = buildStaticHtml({ title: 't', bodyHtml: '<p>x</p>', themeCss: '' });
    expect(off).not.toContain('id="mm-comment-');
    expect(off).not.toContain('<h2>Comments</h2>');
  });
});
