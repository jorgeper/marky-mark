import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS } from '../../src/lib/settings';

// PRD 023 Req 21 (issue #289): the marker/comment tint vocabulary and its
// WCAG AA claim were asserted only in prose (PRD 022 Req 13, PRD 023 §§2–3)
// and in a hand-computed comment in themes/gruvbox-dark.css. Nothing under
// tests/ computed a contrast ratio, so a theme could regress the claim
// silently. These tests read the shipped CSS and do the arithmetic.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STYLES = readFileSync(`${ROOT}src/styles.css`, 'utf8');
const PACKAGE_STYLES = readFileSync(`${ROOT}editor/styles.css`, 'utf8');

/** Every bundled theme, read once — the only other source of marker tokens. */
const THEMES = readdirSync(`${ROOT}themes`)
  .filter((file) => file.endsWith('.css'))
  .map((file) => ({ file, css: readFileSync(`${ROOT}themes/${file}`, 'utf8') }));

/** PRD 023 §2: the vocabulary, in the order styles.css declares it. */
const MARKERS: readonly string[] = ['yellow', 'green', 'orange', 'pink'];

/**
 * The strengths the `mark.hl[data-color]` rules mix, read off the stylesheet
 * rather than restated here (42% idle, 60% active/flash/overlap and 12% for
 * resolved ghosts today): a re-tuned rule gets re-checked instead of leaving
 * this assertion behind on numbers the app no longer paints.
 */
const STRENGTHS = [...STYLES.matchAll(/color-mix\(in srgb, var\(--marker-hue\) (\d+)%/g)].map(
  (m) => Number(m[1]) / 100
);

/** Every `--mm-marker-<name>` token declared anywhere in a CSS source. */
function markerTokens(css: string): string[] {
  return [...css.matchAll(/--mm-marker-([a-z-]+)\s*:/g)].map((m) => m[1]);
}

/** The value of a custom property inside a source, last declaration winning. */
function tokenValue(css: string, name: string): string | undefined {
  const hits = [...css.matchAll(new RegExp(`--mm-${name}\\s*:\\s*([^;]+);`, 'g'))];
  return hits.length ? hits[hits.length - 1][1].trim() : undefined;
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

/**
 * A hex token's RGB, the first source that declares it winning (a theme's
 * override over the styles.css default). Fails by name rather than throwing
 * on NaN when no source defines it or the value is not a hex literal.
 */
function rgbToken(name: string, label: string, ...sources: string[]): Rgb {
  const value = sources.map((css) => tokenValue(css, name)).find((v) => v !== undefined) ?? '';
  expect(value, `${label} --mm-${name}`).toMatch(/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i);
  return hexToRgb(value);
}

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio between two opaque colors. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `color-mix(in srgb, hue <pct>%, transparent)` composited over a backdrop. */
function overBackdrop(hue: Rgb, backdrop: Rgb, alpha: number): Rgb {
  return hue.map((c, i) => alpha * c + (1 - alpha) * backdrop[i]) as Rgb;
}

describe('PRD 023 §2–§3: the marker and comment tint token vocabulary', () => {
  test('U1162: the markers are exactly yellow/green/orange/pink, blue is gone, and the comment tint pair is a theme-overridable document-rendering token', () => {
    // styles.css declares the four defaults and nothing else (PRD 023 §2:
    // format 2.0.0 swapped blue for orange).
    expect(markerTokens(STYLES)).toEqual(MARKERS);

    // No blue marker survives anywhere the app ships CSS from — not in the
    // app stylesheet, not in the package stylesheet, not in a bundled theme.
    const sources = [
      { file: 'src/styles.css', css: STYLES },
      { file: 'editor/styles.css', css: PACKAGE_STYLES },
      ...THEMES.map(({ file, css }) => ({ file: `themes/${file}`, css })),
    ];
    for (const { file, css } of sources) {
      expect(markerTokens(css).filter((n) => !MARKERS.includes(n)), file).toEqual([]);
      expect(css, file).not.toMatch(/--mm-marker-blue/);
    }

    // PRD 023 §3: comments render in a fixed tint of their own, defined as a
    // pair in the document-rendering region — the same `.theme-root` block
    // that carries the markers, so a theme overrides them the same way.
    const region = /\.theme-root\s*\{[^}]*--mm-marker-yellow[^}]*\}/.exec(STYLES)?.[0] ?? '';
    expect(region).toMatch(/--mm-comment-tint\s*:/);
    expect(region).toMatch(/--mm-comment-tint-active\s*:/);
    // The tint is never aliased to a marker hue: comments are not highlights.
    expect(tokenValue(region, 'comment-tint')).not.toMatch(/--mm-marker-/);
    expect(tokenValue(region, 'comment-tint-active')).not.toMatch(/--mm-marker-/);

    // Theme-overridable in practice, not just in principle: bundled themes
    // override the pair, and gruvbox-dark overrides the markers too.
    const overriders = THEMES.filter(({ css }) => css.includes('--mm-comment-tint:'));
    expect(overriders.length).toBeGreaterThan(0);
    const gruvboxDark = THEMES.find(({ file }) => file === 'gruvbox-dark.css')?.css ?? '';
    expect(markerTokens(gruvboxDark)).toEqual(MARKERS);

    // Every consumer of the markers resolves one of the four literals; the
    // `data-color` selectors and the vocabulary stay in lock-step.
    for (const name of MARKERS) {
      expect(STYLES).toContain(`mark.hl[data-color='${name}']`);
    }
  });

  test('U1163: body text over every marker tint clears WCAG AA in the default light and dark bundled themes (PRD 022 Req 13)', () => {
    // Never vacuous: a stylesheet the strength regex stops matching fails
    // here rather than passing with nothing to composite.
    expect(STRENGTHS.length, 'marker mix strengths in src/styles.css').toBeGreaterThanOrEqual(2);

    for (const themeId of [DEFAULT_SETTINGS.themeLight, DEFAULT_SETTINGS.themeDark]) {
      const theme = THEMES.find(({ file }) => file === `${themeId}.css`)?.css ?? '';
      const bg = rgbToken('bg', themeId, theme);
      const fg = rgbToken('fg', themeId, theme);
      for (const name of MARKERS) {
        // A theme that overrides the hue wins; otherwise the styles.css default.
        const hue = rgbToken(`marker-${name}`, themeId, theme, STYLES);
        for (const strength of STRENGTHS) {
          const ratio = contrast(fg, overBackdrop(hue, bg, strength));
          // AA for body text is 4.5:1 (PRD 022 Req 13).
          expect(ratio, `${themeId} ${name} @${strength * 100}%`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
