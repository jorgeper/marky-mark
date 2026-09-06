import { describe, expect, test } from 'vitest';
import { STYLES, THEMES, contrast, hexToRgb, mix, rgbToken, tokenValue, type Rgb } from './css-contrast';

// Issue #245: the New Workspace dialog's refusals moved off the small muted
// `.hotkey-hint` treatment onto `--mm-danger` at the dialog's body text size.
// That colour is only as good as its contrast: the shared default is a red
// tempered toward the theme foreground, and on dark themes it came out at
// 1.7–3.4:1 against the dialog background — a red nobody can read. These
// tests do the arithmetic over the shipped CSS, in the style of
// marker-tokens.test.ts (whose CSS reading and WCAG maths they share, from
// ./css-contrast), so a new or re-tuned theme is held to the floor too.

/**
 * The floor: WCAG AA for body text. The error line is body-size prose, so it
 * is held to the body-text ratio — the same 4.5:1 the marker tints are held
 * to in marker-tokens.test.ts (PRD 022 Req 13).
 */
const FLOOR = 4.5;

/**
 * The shared default, read off the stylesheet rather than restated here: a
 * base red mixed toward the theme's own foreground. A re-tuned default is
 * re-checked against every theme instead of leaving this test behind on a
 * recipe the app no longer paints — and a rewrite this stops recognising
 * fails the file loudly rather than leaving it with nothing to resolve.
 */
function defaultDangerRecipe(): { base: Rgb; weight: number } {
  const recipe =
    /--mm-danger:\s*color-mix\(in srgb,\s*(#[0-9a-fA-F]{3,8})\s+(\d+)%,\s*var\(--mm-fg[^)]*\)\s+\d+%\)/.exec(STYLES);
  if (!recipe) {
    throw new Error('src/styles.css no longer declares --mm-danger as a base red color-mixed toward --mm-fg');
  }
  return { base: hexToRgb(recipe[1]), weight: Number(recipe[2]) / 100 };
}

const DEFAULT_DANGER = defaultDangerRecipe();

/** What `--mm-danger` resolves to inside a theme: its override, or the default. */
function dangerFor(themeCss: string, label: string): Rgb {
  if (tokenValue(themeCss, 'danger') !== undefined) return rgbToken('danger', label, themeCss);
  return mix(DEFAULT_DANGER.base, rgbToken('fg', label, themeCss), DEFAULT_DANGER.weight);
}

describe('Issue #245: the error colour is legible on every bundled theme', () => {
  test('U1180: --mm-danger clears WCAG AA body text against the dialog and page backgrounds of all bundled themes', () => {
    // Never vacuous: the theme directory is enumerated rather than listed, so
    // a newly bundled theme is covered without a code edit.
    expect(THEMES.length, 'bundled themes').toBeGreaterThanOrEqual(27);

    for (const { file, css } of THEMES) {
      const label = `themes/${file}`;
      const danger = dangerFor(css, label);
      // Dialogs (the New Workspace dialog included) paint on --mm-bg-elevated;
      // --mm-danger also paints on the page background elsewhere in chrome.
      for (const surface of ['bg-elevated', 'bg'] as const) {
        const ratio = contrast(danger, rgbToken(surface, label, css));
        expect(ratio, `${label} danger on --mm-${surface}`).toBeGreaterThanOrEqual(FLOOR);
      }
    }
  });

  test('U1181: the dialog error line is body-size danger text, and .hotkey-hint stays the small muted hint', () => {
    // The rule the New Workspace errors render through: body size, danger
    // colour, both through tokens (the issue's "too small, not red"). Matched
    // from `.form-error` alone, so grouping another selector onto the rule is
    // not a false failure.
    const errorRule = /\.form-error[^{]*\{([^}]*)\}/.exec(STYLES)?.[1] ?? '';
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
