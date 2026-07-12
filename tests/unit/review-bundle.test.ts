import { describe, expect, test } from 'vitest';
import { buildReviewBundle, extractReviewPayload, REVIEW_PAYLOAD_ID } from '../../src/lib/reviewBundle';

const TEMPLATE = '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>app</body></html>';

/** Minimal stand-in for the document surface extractReviewPayload needs. */
function docWith(html: string) {
  const m = new RegExp(`<script type="application/json" id="${REVIEW_PAYLOAD_ID}">([\\s\\S]*?)</script>`).exec(html);
  return {
    getElementById(id: string) {
      return id === REVIEW_PAYLOAD_ID && m ? { textContent: m[1] } : null;
    },
  };
}

describe('SPEC16 review bundle', () => {
  test('U29: build injects the payload once before </head>; extract round-trips hostile content byte-identically', () => {
    const markdown = [
      '# Doc with traps',
      '',
      'Inline `</script>` and <!-- comment --> markers.',
      '',
      '<!-- mm-comments v1',
      '{"comments":[{"id":"c1","body":"a </script> in a comment"}]}',
      '-->',
    ].join('\n');
    const payload = { name: 'traps.md', markdown };
    const bundle = buildReviewBundle(TEMPLATE, payload);

    // Injected exactly once, before </head>, and the raw markdown's traps
    // never appear unescaped inside the script element.
    expect(bundle.match(new RegExp(`id="${REVIEW_PAYLOAD_ID}"`, 'g'))).toHaveLength(1);
    expect(bundle.indexOf(`id="${REVIEW_PAYLOAD_ID}"`)).toBeLessThan(bundle.indexOf('</head>'));
    const scriptBody = /<script type="application\/json" id="mm-review-doc">([\s\S]*?)<\/script>/.exec(bundle)![1];
    expect(scriptBody).not.toContain('</script>');
    expect(scriptBody).not.toContain('<!--');

    const round = extractReviewPayload(docWith(bundle));
    expect(round).not.toBeNull();
    expect(round!.name).toBe('traps.md');
    expect(round!.markdown).toBe(markdown); // byte-identical

    // No payload → null; garbage payload → null.
    expect(extractReviewPayload(docWith(TEMPLATE))).toBeNull();
    expect(extractReviewPayload({ getElementById: () => ({ textContent: 'not json' }) })).toBeNull();

    // A template without </head> is an explicit error, not silent corruption.
    expect(() => buildReviewBundle('<html><body></body></html>', payload)).toThrow();

    // Self-hosting: the real viewer's inlined JS contains the literal
    // "</head>" — injection must target the document's REAL head close
    // (the last occurrence), never a string inside a script.
    const selfHosting =
      '<!doctype html><html><head><script>const x = "</head>";</script></head><body>app</body></html>';
    const hosted = buildReviewBundle(selfHosting, payload);
    expect(hosted.indexOf(`id="${REVIEW_PAYLOAD_ID}"`)).toBeGreaterThan(hosted.indexOf('const x'));
    expect(extractReviewPayload(docWith(hosted))!.markdown).toBe(markdown);
  });
});
