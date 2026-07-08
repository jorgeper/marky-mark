import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hasRemoteUrls, parseTheme } from '../../src/lib/themes';

const THEMES_DIR = fileURLToPath(new URL('../../themes', import.meta.url));

describe('theme guard v2 (SPEC11 §2)', () => {
  test('U17: every remote-reference form is rejected; URLs in comments are fine; all built-ins still parse', () => {
    // Remote forms — all must reject (parseTheme returns null).
    const remoteForms = [
      '.theme-root { background: url(https://evil.example/x.png); }',
      ".theme-root { background: url('http://evil.example/x.png'); }",
      '.theme-root { background: url(//evil.example/x.png); }',
      '@import "https://evil.example/x.css";\n.theme-root { --mm-bg: #fff; }',
      "@import 'http://evil.example/x.css';\n.theme-root { --mm-bg: #fff; }",
      '@import url("https://evil.example/x.css");\n.theme-root { --mm-bg: #fff; }',
      '@import "//evil.example/x.css";\n.theme-root { --mm-bg: #fff; }',
      // Local @import is also rejected — themes are single-file by contract.
      '@import "./other.css";\n.theme-root { --mm-bg: #fff; }',
      '.theme-root { font-family: x; src: url( "https://evil.example/f.woff2" ); }',
    ];
    for (const css of remoteForms) {
      expect(hasRemoteUrls(css), css).toBe(true);
      expect(parseTheme('bad.css', css, false), css).toBeNull();
    }

    // Author credits and links inside comments must NOT trip the guard.
    const commented =
      '/* @name: Nice Theme\n   @author: someone (https://example.com/someone)\n   see http://example.com */\n' +
      '.theme-root { --mm-bg: #123456; }';
    expect(hasRemoteUrls(commented)).toBe(false);
    const parsed = parseTheme('nice-theme.css', commented, false);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('Nice Theme');

    // Local url() references stay allowed.
    expect(hasRemoteUrls('.x { background: url(./paper.png); }')).toBe(false);
    expect(hasRemoteUrls(".x { background: url('data:image/png;base64,AAAA'); }")).toBe(false);

    // Every built-in theme still parses under the tightened guard.
    const files = readdirSync(THEMES_DIR).filter((f) => f.endsWith('.css'));
    expect(files.length).toBeGreaterThanOrEqual(27);
    for (const f of files) {
      const css = readFileSync(`${THEMES_DIR}/${f}`, 'utf8');
      expect(parseTheme(f, css, true), f).not.toBeNull();
    }
  });
});
