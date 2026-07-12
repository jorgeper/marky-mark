import { countWords } from './wordCount';

/**
 * SPEC18: the pure builder behind the Export dialog. One artifact shape for
 * both formats — a fully static reading page: the themed document, optional
 * numbered comment notes, optional stats line. Zero scripts, zero network
 * references; everything the recipient needs is in the file.
 */

/** One comment, pre-shaped for static rendering (SPEC18 §1.2). */
export interface StaticComment {
  n: number;
  excerpt: string;
  author: string;
  body: string;
  replies: Array<{ author: string; body: string }>;
}

export interface StaticPage {
  title: string;
  bodyHtml: string;
  themeCss: string;
  /** '1,234 words · 6 min read' — present iff the option was checked. */
  stats?: string;
  /** Present iff include-comments was checked (may be empty). */
  comments?: StaticComment[];
}

/** '1,234 words · 6 min read' — same 220wpm math as the chip (SPEC16 §5). */
export function statsLine(text: string): string {
  const { words, minutes } = countWords(text);
  return `${words.toLocaleString('en-US')} words · ${minutes} min read`;
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function commentsSection(comments: StaticComment[]): string {
  if (comments.length === 0) return '';
  const items = comments
    .map(
      (c) => `<li id="mm-comment-${c.n}" class="mm-comment">
<blockquote>${esc(c.excerpt)}</blockquote>
<p class="mm-comment-body"><strong>${esc(c.author)}</strong> ${esc(c.body)}</p>
${c.replies.map((r) => `<p class="mm-comment-reply"><strong>${esc(r.author)}</strong> ${esc(r.body)}</p>`).join('\n')}
</li>`
    )
    .join('\n');
  return `<section class="mm-comments">
<h2>Comments</h2>
<ol>
${items}
</ol>
</section>`;
}

export function buildStaticHtml(page: StaticPage): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<style>
${page.themeCss}
body { margin: 0; }
.theme-root {
  min-height: 100vh;
  background: var(--mm-bg, #fff);
  color: var(--mm-fg, #1f2328);
  font-family: var(--mm-font-body, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: var(--mm-font-size, 15px);
  line-height: var(--mm-line-height, 1.7);
}
.doc { max-width: var(--mm-content-width, 46rem); margin: 0 auto; padding: 48px 32px 96px; overflow-wrap: break-word; }
.doc h1, .doc h2, .doc h3, .doc h4 { font-family: var(--mm-font-heading, inherit); color: var(--mm-heading, inherit); line-height: 1.3; margin: 1.6em 0 0.5em; }
.doc h1 { font-size: 2em; margin-top: 0.4em; }
.doc h2 { font-size: 1.5em; padding-bottom: 0.25em; border-bottom: 1px solid var(--mm-border, #d1d9e0); }
.doc a { color: var(--mm-link, #0969da); text-decoration: none; }
.doc code { font-family: var(--mm-font-mono, monospace); font-size: 0.87em; background: var(--mm-code-bg, #f6f8fa); padding: 0.15em 0.35em; border-radius: 5px; }
.doc pre { background: var(--mm-code-bg, #f6f8fa); border-radius: 9px; padding: 14px 16px; overflow-x: auto; }
.doc pre code { background: none; padding: 0; }
.doc blockquote { margin: 1em 0; padding: 0.1em 1.1em; border-left: 3px solid var(--mm-blockquote-border, #d1d9e0); color: var(--mm-blockquote-fg, #59636e); }
.doc table { border-collapse: collapse; margin: 1em 0; }
.doc th, .doc td { border: 1px solid var(--mm-table-border, #d1d9e0); padding: 6px 13px; }
.doc img { max-width: 100%; }
mark.hl { background: var(--mm-hl, rgba(255, 212, 0, 0.35)); border-radius: 2px; }
sup.mm-ref a { color: var(--mm-accent, #0969da); text-decoration: none; font-weight: 600; }
.mm-comments { margin-top: 3em; border-top: 1px solid var(--mm-border, #d1d9e0); padding-top: 1em; }
.mm-comments h2 { font-size: 1.2em; }
.mm-comments blockquote { font-style: italic; }
.mm-comment-reply { margin-left: 1.4em; }
.mm-stats { margin-top: 2.5em; border-top: 1px solid var(--mm-border, #d1d9e0); padding-top: 0.8em; color: var(--mm-fg-muted, #59636e); font-size: 0.85em; }
@media print { .doc { padding: 0; max-width: none; } }
</style>
</head>
<body>
<div class="theme-root"><div class="doc">
${page.bodyHtml}
${page.comments ? commentsSection(page.comments) : ''}
${page.stats ? `<p class="mm-stats"><em>${esc(page.stats)}</em></p>` : ''}
</div></div>
</body>
</html>
`;
}
