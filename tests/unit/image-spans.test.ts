import { describe, expect, test } from 'vitest';
import { renderMarkdown } from '../../src/lib/markdown';
import { applyImageRewrite, rewriteImageSpan } from '../../src/lib/imageResize';

describe('SPEC20 §4 image source spans and rewrite', () => {
  test('U45: every doc-originated <img> carries its source span; remote placeholders carry none', async () => {
    const src = [
      'Intro ![pic](images/red%20x.png) inline.',
      '',
      '<img src="images/blue.png" alt="b" width="160">',
      '',
      '![ref image][r]',
      '',
      '[r]: images/green.png',
      '',
      '![remote](https://example.com/x.png)',
      '',
      '<div>dropped <img src="images/no.png"> raw html</div>',
    ].join('\n');
    const html = await renderMarkdown(src);

    // Markdown image: the span reproduces exactly the syntax that made it.
    const md = /<img[^>]*src="images\/red%20x\.png"[^>]*>/.exec(html)?.[0] ?? '';
    const mdStart = Number(/data-mm-src-start="(\d+)"/.exec(md)?.[1]);
    const mdEnd = Number(/data-mm-src-end="(\d+)"/.exec(md)?.[1]);
    expect(src.slice(mdStart, mdEnd)).toBe('![pic](images/red%20x.png)');

    // Raw-HTML image: renders (whitelisted attrs incl. width) and spans the tag.
    const ht = /<img[^>]*src="images\/blue\.png"[^>]*>/.exec(html)?.[0] ?? '';
    expect(ht).toContain('width="160"');
    const htStart = Number(/data-mm-src-start="(\d+)"/.exec(ht)?.[1]);
    const htEnd = Number(/data-mm-src-end="(\d+)"/.exec(ht)?.[1]);
    expect(src.slice(htStart, htEnd)).toBe('<img src="images/blue.png" alt="b" width="160">');

    // Reference-style image: the span covers the usage site.
    const ref = /<img[^>]*src="images\/green\.png"[^>]*>/.exec(html)?.[0] ?? '';
    const refStart = Number(/data-mm-src-start="(\d+)"/.exec(ref)?.[1]);
    const refEnd = Number(/data-mm-src-end="(\d+)"/.exec(ref)?.[1]);
    expect(src.slice(refStart, refEnd)).toBe('![ref image][r]');

    // Remote image: placeholder span (which names the blocked host), no <img>
    // with a remote src, and no span data on the placeholder.
    expect(html).toContain('mm-blocked-remote');
    expect(html).not.toMatch(/<img[^>]*https:\/\//);
    expect(/<span class="mm-blocked-remote"[^>]*data-mm-src/.test(html)).toBe(false);

    // Raw HTML at large stays dropped — including the img inside the div.
    expect(html).not.toContain('images/no.png');
    expect(html).not.toContain('<div>');
  });

  test('U46: span rewrite — markdown→HTML with width, HTML width set/kept/removed, markdown removal is a no-op', () => {
    // Markdown syntax picks up a fresh tag built from the rendered image's parts.
    expect(rewriteImageSpan('![pic](images/red%20x.png)', { src: 'images/red%20x.png', alt: 'pic' }, 500)).toBe(
      '<img src="images/red%20x.png" alt="pic" width="500">'
    );
    // Title survives; attribute values escape.
    expect(rewriteImageSpan('![a "b"](x.png "t")', { src: 'x.png', alt: 'a "b"', title: 't' }, 40)).toBe(
      '<img src="x.png" alt="a &quot;b&quot;" title="t" width="40">'
    );
    // An existing HTML tag keeps its other attributes; width is replaced.
    expect(
      rewriteImageSpan('<img src="b.png" alt="b" title="keep" width="160">', { src: 'b.png', alt: 'b' }, 320)
    ).toBe('<img src="b.png" alt="b" title="keep" width="320">');
    // Width removal on an HTML tag: attribute gone, tag stays HTML.
    expect(
      rewriteImageSpan('<img src="b.png" alt="b" width="160">', { src: 'b.png', alt: 'b' }, null)
    ).toBe('<img src="b.png" alt="b">');
    // Self-closing input normalizes fine.
    expect(rewriteImageSpan('<img src="b.png"/>', { src: 'b.png', alt: '' }, 200)).toBe(
      '<img src="b.png" width="200">'
    );
    // Width removal on plain markdown syntax: nothing to remove — no-op.
    expect(rewriteImageSpan('![pic](a.png)', { src: 'a.png', alt: 'pic' }, null)).toBeNull();

    // applyImageRewrite splices the document and reports the new span end.
    const doc = 'before\n![pic](a.png)\nafter';
    const start = doc.indexOf('![pic]');
    const end = start + '![pic](a.png)'.length;
    const res = applyImageRewrite(doc, start, end, { src: 'a.png', alt: 'pic' }, 120);
    expect(res).not.toBeNull();
    expect(res!.text).toBe('before\n<img src="a.png" alt="pic" width="120">\nafter');
    expect(res!.text.slice(start, res!.newEnd)).toBe('<img src="a.png" alt="pic" width="120">');
    // No-op path returns null and leaves the document to the caller untouched.
    expect(applyImageRewrite(doc, start, end, { src: 'a.png', alt: 'pic' }, null)).toBeNull();
  });
});
