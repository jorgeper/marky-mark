import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROOT, THEMES, contrast, mix, rgbToken, tokenValue } from './css-contrast';

// Issue #318: the GitHub-alert callout tints. The five hues are theme tokens
// declared once in the package stylesheet; the tint (hue over --mm-bg) and
// the title colour (hue over the callout body colour) derive from them, so
// the pastel follows every theme's own palette. This test reads the shipped
// CSS and does the arithmetic (./css-contrast, the marker-tokens precedent):
// callout body and title text clear WCAG AA (4.5:1) over the kind's tint on
// every bundled theme and on the package default — no hand-computed ratios.

const PACKAGE_STYLES = readFileSync(`${ROOT}editor/styles.css`, 'utf8');
const DEFAULT_THEME = readFileSync(`${ROOT}editor/default-theme.css`, 'utf8');

/** The five kinds, in the order styles.css declares them. */
const KINDS: readonly string[] = ['note', 'tip', 'important', 'warning', 'caution'];

/** The strengths the stylesheet mixes, read off it rather than restated. */
const strengths = (re: RegExp) => [...new Set([...PACKAGE_STYLES.matchAll(re)].map((m) => Number(m[1]) / 100))];
const TINTS = strengths(/color-mix\(in srgb, var\(--mm-callout-hue\) (\d+)%, var\(--mm-bg/g);
const TITLES = strengths(/color-mix\(in srgb, var\(--mm-callout-hue\) (\d+)%, var\(--mm-callout-fg/g);

describe('Issue #318: the callout tint tokens and their contrast', () => {
  test('U1246: the five hues are declared once on .theme-root in the package stylesheet, and body and title text clear WCAG AA over every tint on every bundled theme and the package default', () => {
    // Never vacuous: a stylesheet the regexes stop matching fails here.
    expect(TINTS.length, 'tint strengths in editor/styles.css').toBeGreaterThanOrEqual(1);
    expect(TITLES.length, 'title strengths in editor/styles.css').toBeGreaterThanOrEqual(1);

    // Declared once, in the .theme-root block of the package stylesheet.
    const region = /\.theme-root\s*\{[^}]*--mm-callout-note[^}]*\}/.exec(PACKAGE_STYLES)?.[0] ?? '';
    for (const kind of KINDS) {
      expect(region).toMatch(new RegExp(`--mm-callout-${kind}\\s*:`));
      expect(PACKAGE_STYLES.match(new RegExp(`--mm-callout-${kind}\\s*:`, 'g'))).toHaveLength(1);
      // The per-kind hue resolves through the token with the same literal as
      // its fallback, so a bare embed without the block paints the same hue.
      expect(PACKAGE_STYLES).toContain(`.mm-callout-${kind} {\n  --mm-callout-hue: var(--mm-callout-${kind}, ${tokenValue(region, `callout-${kind}`)});`);
    }
    // The body colour has no default of its own: it falls back to --mm-fg.
    expect(tokenValue(PACKAGE_STYLES, 'callout-fg')).toBeUndefined();

    const sources = [
      ...THEMES.map(({ file, css }) => ({ label: file.replace(/\.css$/, ''), css })),
      { label: 'default-theme', css: DEFAULT_THEME },
    ];
    expect(sources.length).toBeGreaterThan(20);
    for (const { label, css } of sources) {
      const bg = rgbToken('bg', label, css);
      // A theme may route callout text through its own colour; otherwise fg.
      const body = tokenValue(css, 'callout-fg') !== undefined ? rgbToken('callout-fg', label, css) : rgbToken('fg', label, css);
      for (const kind of KINDS) {
        // A theme that overrides the hue wins; otherwise the package default.
        const hue = rgbToken(`callout-${kind}`, label, css, PACKAGE_STYLES);
        for (const t of TINTS) {
          const tint = mix(hue, bg, t);
          // AA for body text is 4.5:1 — the body over the tint…
          expect(contrast(body, tint), `${label} ${kind} body @${t * 100}%`).toBeGreaterThanOrEqual(4.5);
          // …and the title (the hue cast over the body colour) over the tint.
          for (const s of TITLES) {
            expect(contrast(mix(hue, body, s), tint), `${label} ${kind} title @${s * 100}%`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });
});
