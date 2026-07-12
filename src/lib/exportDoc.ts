import { attachEmbedded } from './embedded';
import { countWords } from './wordCount';
import type { CommentData } from './anchoring';

/**
 * SPEC17: pure builders behind the Export dialog. buildExportMarkdown makes
 * the markdown the artifact carries (trailer and stats line are opt-in and
 * only ever added to the exported COPY — the source file is never touched);
 * buildPrintHtml makes the standalone page the PDF path prints.
 */

export interface ExportOptions {
  includeComments: boolean;
  includeWordCount: boolean;
}

/** '1,234 words · 6 min read' — same 220wpm math as the chip (SPEC16 §5). */
export function statsLine(text: string): string {
  const { words, minutes } = countWords(text);
  return `${words.toLocaleString('en-US')} words · ${minutes} min read`;
}

export function buildExportMarkdown(buffer: string, comments: CommentData[], opts: ExportOptions): string {
  let out = opts.includeComments && comments.length > 0 ? attachEmbedded(buffer, comments) : buffer;
  if (opts.includeWordCount) {
    // A discreet italic stats line at the very end of the exported copy.
    out = `${out.trimEnd()}\n\n---\n\n*${statsLine(buffer)}*\n`;
  }
  return out;
}

/**
 * SPEC17 §3.2: a complete standalone page for the OS print dialog — the
 * chosen theme's CSS, print-friendly document styles, the rendered document
 * (mark highlights included when comments were), and the optional stats
 * line. Self-contained: no external references of any kind.
 */
export function buildPrintHtml(renderedHtml: string, themeCss: string, stats?: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Marky Mark export</title>
<style>
${themeCss}
body { margin: 0; }
.theme-root {
  background: var(--mm-bg, #fff);
  color: var(--mm-fg, #1f2328);
  font-family: var(--mm-font-body, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: var(--mm-font-size, 14px);
  line-height: var(--mm-line-height, 1.7);
}
.doc { max-width: 46rem; margin: 0 auto; padding: 24px 32px; overflow-wrap: break-word; }
.doc h1, .doc h2, .doc h3 { font-family: var(--mm-font-heading, inherit); color: var(--mm-heading, inherit); line-height: 1.3; }
.doc pre { background: var(--mm-code-bg, #f6f8fa); border-radius: 8px; padding: 12px 14px; overflow-x: auto; }
.doc code { font-family: var(--mm-font-mono, monospace); font-size: 0.87em; }
.doc blockquote { border-left: 3px solid var(--mm-blockquote-border, #d1d9e0); margin: 1em 0; padding: 0.1em 1em; color: var(--mm-blockquote-fg, #59636e); }
.doc table { border-collapse: collapse; }
.doc th, .doc td { border: 1px solid var(--mm-table-border, #d1d9e0); padding: 5px 11px; }
.doc img { max-width: 100%; }
mark.hl { background: var(--mm-hl, rgba(255, 212, 0, 0.35)); border-radius: 2px; }
.mm-stats { margin-top: 2.5em; border-top: 1px solid var(--mm-border, #d1d9e0); padding-top: 0.8em; color: var(--mm-fg-muted, #59636e); font-size: 0.85em; }
@media print { .doc { padding: 0; max-width: none; } }
</style>
</head>
<body>
<div class="theme-root"><div class="doc">
${renderedHtml}
${stats ? `<p class="mm-stats"><em>${stats}</em></p>` : ''}
</div></div>
</body>
</html>
`;
}
