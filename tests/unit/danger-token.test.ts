import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Issue #245: the New Workspace dialog's refusals moved off the small muted
// `.hotkey-hint` treatment onto `--mm-danger` at the dialog's body text size.
// That colour is only as good as its contrast: the shared default is a red
// tempered toward the theme foreground, and on dark themes it came out at
// 1.7–3.4:1 against the dialog background — a red nobody can read. These
// tests do the arithmetic over the shipped CSS, in the style of
// marker-tokens.test.ts, so a new or re-tuned theme is held to the floor too.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STYLES = readFileSync(`${ROOT}src/styles.css`, 'utf8');

/** Every bundled theme, read once — the only source of `--mm-danger` overrides. */
const THEMES = readdirSync(`${ROOT}themes`)
  .filter((file) => file.endsWith('.css'))
  .map((file) => ({ file, css: readFileSync(`${ROOT}themes/${file}`, 'utf8') }));

/**
 * The floor: WCAG AA for body text. The error line is body-size prose, so it
 * is held to the body-text ratio — the same 4.5:1 the marker tints are held
 * to in marker-tokens.test.ts (PRD 022 Req 13).
 */
const FLOOR = 4.5;

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

/** A hex token in one source, failing by name rather than on NaN. */
function rgbToken(css: string, name: string, label: string): Rgb {
  const value = tokenValue(css, name) ?? '';
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

/** WCAG 2.x contrast ratio between two opaque colours. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(a: Rgb, b: Rgb, weight: number): Rgb {
  return a.map((c, i) => weight * c + (1 - weight) * b[i]) as Rgb;
}

/**
 * The shared default, read off the stylesheet rather than restated here: a
 * base red mixed toward the theme's own foreground. A re-tuned default is
 * re-checked against every theme instead of leaving this test behind on a
 * recipe the app no longer paints.
 */
const DEFAULT_DANGER =
  /--mm-danger:\s*color-mix\(in srgb,\s*(#[0-9a-fA-F]{3,8})\s+(\d+)%,\s*var\(--mm-fg[^)]*\)\s+\d+%\)/.exec(STYLES);

/** What `--mm-danger` resolves to inside a theme: its override, or the default. */
function dangerFor(themeCss: string, label: string): Rgb {
  const override = tokenValue(themeCss, 'danger');
  if (override !== undefined) return rgbToken(themeCss, 'danger', label);
  const base = hexToRgb(DEFAULT_DANGER![1]);
  return mix(base, rgbToken(themeCss, 'fg', label), Number(DEFAULT_DANGER![2]) / 100);
}

describe('Issue #245: the error colour is legible on every bundled theme', () => {
  test('U1180: --mm-danger clears WCAG AA body text against the dialog and page backgrounds of all bundled themes', () => {
    // Never vacuous: the default recipe must still parse, and the directory
    // is enumerated, so a newly bundled theme is covered without a code edit.
    expect(DEFAULT_DANGER, '--mm-danger default in src/styles.css').not.toBeNull();
    expect(THEMES.length, 'bundled themes').toBeGreaterThanOrEqual(27);

    for (const { file, css } of THEMES) {
      const label = `themes/${file}`;
      const danger = dangerFor(css, label);
      // Dialogs (the New Workspace dialog included) paint on --mm-bg-elevated;
      // --mm-danger also paints on the page background elsewhere in chrome.
      for (const surface of ['bg-elevated', 'bg'] as const) {
        const ratio = contrast(danger, rgbToken(css, surface, label));
        expect(ratio, `${label} danger on --mm-${surface}`).toBeGreaterThanOrEqual(FLOOR);
      }
    }
  });

  test('U1181: the dialog error line is body-size danger text, and .hotkey-hint stays the small muted hint', () => {
    // The rule the New Workspace errors render through: body size, danger
    // colour, both through tokens (the issue's "too small, not red").
    const errorRule = /\.picker-error,\s*\n\.form-error\s*\{([^}]*)\}/.exec(STYLES)?.[1] ?? '';
    expect(errorRule, '.form-error rule in src/styles.css').toContain('font-size: var(--mm-text-body)');
    expect(errorRule).toContain('color: var(--mm-danger)');

    // The hint the hotkeys rows legitimately use is untouched by this change.
    const hintRule = /\.dialog \.hotkey-hint\s*\{([^}]*)\}/.exec(STYLES)?.[1] ?? '';
    expect(hintRule, '.dialog .hotkey-hint rule in src/styles.css').toContain('font-size: var(--mm-text-caption)');
    expect(hintRule).toContain('--mm-fg-muted');

    // And the value that was refused reads in the same colour as its message.
    const valueRule = /\.dialog input\.invalid-value\s*\{([^}]*)\}/.exec(STYLES)?.[1] ?? '';
    expect(valueRule, '.dialog input.invalid-value rule in src/styles.css').toContain('color: var(--mm-danger)');
  });
});
