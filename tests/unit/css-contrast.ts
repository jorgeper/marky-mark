import { expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Shared by the guards that prove a colour claim by reading the shipped CSS
// and doing the arithmetic — `marker-tokens.test.ts` (PRD 023 Req 21) and
// `danger-token.test.ts` (issue #245). Both resolve a colour token across
// styles.css and the bundled themes and then score it against WCAG. One copy,
// so the two can never disagree about how a colour is read or rated.

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const STYLES = readFileSync(`${ROOT}src/styles.css`, 'utf8');

/** Every bundled theme, read once — the other source of colour tokens. */
export const THEMES = readdirSync(`${ROOT}themes`)
  .filter((file) => file.endsWith('.css'))
  .map((file) => ({ file, css: readFileSync(`${ROOT}themes/${file}`, 'utf8') }));

export type Rgb = [number, number, number];

/** The value of a custom property inside a source, last declaration winning. */
export function tokenValue(css: string, name: string): string | undefined {
  const hits = [...css.matchAll(new RegExp(`--mm-${name}\\s*:\\s*([^;]+);`, 'g'))];
  return hits.length ? hits[hits.length - 1][1].trim() : undefined;
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

/**
 * A hex token's RGB, the first source that declares it winning (a theme's
 * override over the styles.css default). Fails by name rather than throwing
 * on NaN when no source defines it or the value is not a hex literal.
 */
export function rgbToken(name: string, label: string, ...sources: string[]): Rgb {
  const value = sources.map((css) => tokenValue(css, name)).find((v) => v !== undefined) ?? '';
  expect(value, `${label} --mm-${name}`).toMatch(/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i);
  return hexToRgb(value);
}

/** WCAG 2.x relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio between two opaque colors. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * `weight` of `a` over the rest of `b`, channel by channel — the arithmetic
 * of both `color-mix(in srgb, a <weight>%, b …)` and of compositing a
 * `weight`-alpha tint of `a` over the opaque backdrop `b`.
 */
export function mix(a: Rgb, b: Rgb, weight: number): Rgb {
  return a.map((c, i) => weight * c + (1 - weight) * b[i]) as Rgb;
}
