import { STATIC_PAGE_CSS } from './exportDoc.ts';

/**
 * SPEC18 §2 / issue #124: the pure builder behind File → Print….
 *
 * Print puts the DOCUMENT on paper, never a screenshot of the app window.
 * The native print command (`print_view`) prints the live webview, so the
 * document has to BE the live webview for the duration: App.tsx mounts the
 * markup this module returns as a transient print-only root, styles.css
 * shows only that root under `@media print`, and the root comes back out
 * once printing is done.
 *
 * Two consequences shape everything here:
 *
 * 1. The root lives inside the running app, so its CSS must not touch the
 *    screen. Every rule — the theme's and the static page's alike — is
 *    scoped to `#mm-print-root`, and every `id` in the rendered body is
 *    namespaced, so in-app anchor links and testid queries can never
 *    resolve into the print copy.
 * 2. Print… has no options dialog, so nothing optional reaches paper:
 *    comment highlights, numbered comment refs, the Comments section and
 *    the word-count stats line are Export…'s job and are simply never
 *    built here (`buildStaticHtml` grows those from `comments`/`stats`,
 *    which this module has no way to pass).
 */

/** The transient root's element id — also the CSS scope for its styles. */
export const PRINT_ROOT_ID = 'mm-print-root';

/** Set on <body> while the root is mounted; styles.css keys path 1 off it. */
export const PRINT_BODY_CLASS = 'mm-printing';

/** Prefix that keeps the print copy's ids out of the screen DOM's namespace. */
export const PRINT_ID_PREFIX = 'mm-print-';

export interface PrintPage {
  /** Rendered markdown of the buffer — the same body Export builds. */
  bodyHtml: string;
  /** The LIGHT theme's CSS: paper is white, whatever the screen wears. */
  themeCss: string;
}

/** Comments can hold braces, so they go before any brace counting. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function scopeSelectorList(list: string, scope: string): string {
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    // A theme's page-level selectors ARE the print root — anything else
    // becomes a descendant of it.
    .map((s) => (s === ':root' || s === 'html' || s === 'body' ? scope : `${scope} ${s}`))
    .join(', ');
}

/**
 * Prefix every selector in `css` with `scope`, recursing through conditional
 * at-rules. Statement at-rules (`@import`, `@charset`) are dropped: the print
 * root never pulls anything external in, matching the export page's
 * no-network rule. Strings holding unbalanced braces are not modelled —
 * themes are the `--mm-*` contract (THEMES.md), not arbitrary stylesheets.
 */
export function scopeCss(css: string, scope: string): string {
  return scopeBlock(stripComments(css), scope);
}

function scopeBlock(css: string, scope: string): string {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const brace = css.indexOf('{', i);
    if (brace < 0) break;
    const semi = css.indexOf(';', i);
    if (semi >= 0 && semi < brace) {
      i = semi + 1; // statement at-rule — dropped
      continue;
    }
    const prelude = css.slice(i, brace).trim();
    let depth = 1;
    let j = brace + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    // j sits just past the matching '}' — or at the end of a block the
    // stylesheet never closed, whose body simply runs to there.
    const body = css.slice(brace + 1, depth === 0 ? j - 1 : j);
    if (prelude.startsWith('@')) {
      const name = /^@([a-zA-Z-]+)/.exec(prelude)?.[1].toLowerCase() ?? '';
      const conditional = ['media', 'supports', 'container', 'layer', 'scope'].includes(name);
      out.push(`${prelude} {\n${conditional ? scopeBlock(body, scope) : body.trim()}\n}`);
    } else if (prelude) {
      out.push(`${scopeSelectorList(prelude, scope)} {${body}}`);
    }
    i = j;
  }
  return out.join('\n');
}

/**
 * Namespace every `id` (and the in-document `href="#…"` that points at one)
 * so mounting the print copy never creates a duplicate id: `getElementById`,
 * `[data-testid]` neighbours and anchor navigation all keep resolving to the
 * screen's document. Rewrites inside tags only — the rendered body is
 * sanitized HTML, so `<` in text is already an entity.
 */
export function namespaceHtmlIds(html: string, prefix: string = PRINT_ID_PREFIX): string {
  return html.replace(/<[^>]*>/g, (tag) =>
    tag
      .replace(/\bid="([^"]*)"/g, (_m, v: string) => `id="${prefix}${v}"`)
      .replace(/\bhref="#([^"]*)"/g, (_m, v: string) => `href="#${prefix}${v}"`)
  );
}

/**
 * The innerHTML of the print root: the static page's own style block
 * (reused from exportDoc, never re-written here) plus the themed document,
 * both scoped to the root.
 */
export function buildPrintRootHtml(page: PrintPage): string {
  const css = scopeCss(`${page.themeCss}\n${STATIC_PAGE_CSS}`, `#${PRINT_ROOT_ID}`);
  return `<style>\n${css}\n</style>\n<div class="theme-root"><div class="doc">\n${namespaceHtmlIds(page.bodyHtml)}\n</div></div>`;
}

/**
 * Which theme dresses the paper. Never the active one: a dark theme would
 * print a dark slab, so Print… always takes the configured LIGHT theme —
 * and, if that slot somehow holds a dark theme, the shipped light default.
 */
export function pickPrintTheme<T extends { id: string; variant: 'light' | 'dark' }>(
  themes: readonly T[],
  lightThemeId: string
): T | undefined {
  const configured = themes.find((t) => t.id === lightThemeId);
  if (configured?.variant === 'light') return configured;
  // The slot is empty or (somehow) holds a dark theme: fall back down the
  // ladder — the shipped light default, then any light theme, then whatever
  // is installed, since a themed page beats an unstyled one.
  return (
    themes.find((t) => t.id === 'crisp') ??
    themes.find((t) => t.variant === 'light') ??
    configured ??
    themes[0]
  );
}
