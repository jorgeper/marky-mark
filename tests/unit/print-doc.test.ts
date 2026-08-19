import { describe, expect, test } from 'vitest';
import { STATIC_PAGE_CSS } from '../../src/lib/exportDoc';
import {
  buildPrintRootHtml,
  namespaceHtmlIds,
  pickPrintTheme,
  PRINT_ID_PREFIX,
  PRINT_ROOT_ID,
  scopeCss,
} from '../../src/lib/printDoc';

// issue #124 / SPEC18 §2: the pure half of File → Print… — the markup App.tsx
// mounts as the transient print root, and the theme it wears.

const LIGHT = '.theme-root { --mm-bg: #ffffff; --mm-fg: #1f2328; }';
const BODY =
  '<h1 id="chapter-one" data-mm-line="1">Chapter One</h1>\n' +
  '<p>Body text with <a href="#chapter-one">an anchor</a>.</p>';

const THEMES = [
  { id: 'crisp', variant: 'light' as const, css: LIGHT },
  { id: 'sepia', variant: 'light' as const, css: '.theme-root { --mm-bg: #f4ecd8; }' },
  { id: 'dracula', variant: 'dark' as const, css: '.theme-root { --mm-bg: #282a36; }' },
];

describe('issue #124: the print-document builder', () => {
  test('U666: the print root carries the rendered document and the static page styles, and nothing of the app', () => {
    const html = buildPrintRootHtml({ bodyHtml: BODY, themeCss: LIGHT });

    // The document itself is on the page…
    expect(html).toContain('Chapter One');
    expect(html).toContain('Body text with');
    expect(html).toContain('class="doc"');
    // …dressed in the export page's own rules, reused rather than rewritten.
    expect(html).toContain('--mm-content-width');
    expect(STATIC_PAGE_CSS).toContain('--mm-content-width');

    // No app chrome reaches paper: the root is built from markdown, so the
    // toolbar, sidebar, comments panel and CodeMirror have no way in.
    for (const chrome of [
      'toolbar-shell',
      'toolbar-hotzone',
      'folder-panel',
      'panel',
      'comment-nav',
      'word-chip',
      'split-divider',
      'editor-wrap',
      'cm-editor',
      'fm-card',
    ]) {
      expect(html).not.toContain(chrome);
    }
    // …and no script or remote reference, same rule as the export page.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/src\s*=\s*["']https?:/i);
  });

  test('U667: Print… has no options dialog — comments, comment refs and the stats line never reach paper', () => {
    const withCommentMarkup =
      '<p>Body <mark class="hl" data-cid="c1">marked</mark><sup class="mm-ref"><a href="#mm-comment-1">1</a></sup></p>';
    const html = buildPrintRootHtml({ bodyHtml: withCommentMarkup, themeCss: LIGHT });
    const body = html.slice(html.indexOf('</style>'));

    // The builder cannot be handed comments or stats at all — buildStaticHtml
    // grows both from options this shape does not carry. (The reused style
    // block still declares their rules; nothing on the page matches them.)
    expect(body).not.toContain('mm-comments');
    expect(body).not.toContain('<h2>Comments</h2>');
    expect(body).not.toContain('mm-stats');
    expect(body).not.toContain('min read');
  });

  test('U668: paper is light whatever the screen wears — the configured light theme, never a dark slab', () => {
    // Screen on dracula, settings.themeLight on sepia ⇒ sepia prints.
    expect(pickPrintTheme(THEMES, 'sepia')!.id).toBe('sepia');
    // A dark theme in the light slot falls back to the shipped light default.
    expect(pickPrintTheme(THEMES, 'dracula')!.id).toBe('crisp');
    // A theme that is no longer installed does the same.
    expect(pickPrintTheme(THEMES, 'gone')!.id).toBe('crisp');
    // No crisp, no configured theme: the first light theme still wins.
    expect(pickPrintTheme([THEMES[2], THEMES[1]], 'gone')!.id).toBe('sepia');
    expect(pickPrintTheme([], 'crisp')).toBeUndefined();

    const html = buildPrintRootHtml({ bodyHtml: BODY, themeCss: LIGHT });
    expect(html).toContain('--mm-bg: #ffffff');
    expect(html).not.toContain('#282a36');
  });

  test('U669: mounting the root leaks no ids and no styles — both are namespaced to the root', () => {
    const html = buildPrintRootHtml({ bodyHtml: BODY, themeCss: LIGHT });

    // Every id is prefixed, so getElementById/testid queries in the running
    // app can never resolve into the print copy…
    expect(html).not.toContain('id="chapter-one"');
    expect(html).toContain(`id="${PRINT_ID_PREFIX}chapter-one"`);
    // …and the anchor that pointed at it follows, so the copy stays coherent.
    expect(html).toContain(`href="#${PRINT_ID_PREFIX}chapter-one"`);
    // Text that merely looks like an attribute is left alone.
    expect(namespaceHtmlIds('<p>write id="x" in prose</p>')).toBe('<p>write id="x" in prose</p>');

    // No unscoped rule: every selector sits under the root, so the screen's
    // own .theme-root/.doc keep the active theme while the root is mounted.
    for (const rule of html.slice(0, html.indexOf('</style>')).split('\n')) {
      if (!rule.includes('{') || rule.trim().startsWith('@')) continue;
      expect(rule.trim().startsWith(`#${PRINT_ROOT_ID}`)).toBe(true);
    }
  });

  test('U670: scopeCss prefixes selectors, keeps conditional at-rules, drops imports', () => {
    const scoped = scopeCss(
      '/* @name: Theme { with a brace } */\n' +
        ':root, .theme-root { --mm-bg: #fff; }\n' +
        '@import url("other.css");\n' +
        '.theme-root .doc h1 { font-size: 2em; }\n' +
        '@media print { .doc { padding: 0; } }\n' +
        '@font-face { font-family: X; }',
      '#p'
    );
    expect(scoped).toContain('#p, #p .theme-root {');
    expect(scoped).toContain('#p .theme-root .doc h1 {');
    expect(scoped).toContain('@media print {\n#p .doc {');
    // Untouched: an @font-face descriptor block has no selector to scope.
    expect(scoped).toContain('@font-face {\nfont-family: X;\n}');
    // Dropped: nothing external, same promise the export page makes.
    expect(scoped).not.toContain('@import');
    // The metadata comment (braces and all) is gone, not mis-parsed.
    expect(scoped).not.toContain('@name');
  });
});
