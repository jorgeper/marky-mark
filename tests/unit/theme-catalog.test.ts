import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseTheme } from '../../src/lib/themes';

const themesDir = fileURLToPath(new URL('../../themes', import.meta.url));

describe('built-in theme catalog (SPEC6 §4)', () => {
  test('U14: ≥27 themes; all parse with unique ids, valid variants, and distinct backgrounds', () => {
    const files = readdirSync(themesDir).filter((f) => f.endsWith('.css'));
    expect(files.length).toBeGreaterThanOrEqual(27);

    const ids = new Set<string>();
    const bgs = new Map<string, string>();
    for (const file of files) {
      const css = readFileSync(path.join(themesDir, file), 'utf8');
      const theme = parseTheme(file, css, true);
      expect(theme, `${file} must parse (no remote urls, non-empty)`).not.toBeNull();
      expect(theme!.name.length).toBeGreaterThan(0);
      expect(['light', 'dark']).toContain(theme!.variant);
      expect(ids.has(theme!.id), `duplicate theme id: ${theme!.id}`).toBe(false);
      ids.add(theme!.id);

      const bg = /--mm-bg:\s*([^;]+);/.exec(css)?.[1].trim();
      expect(bg, `${file} must define --mm-bg`).toBeTruthy();
      expect(bgs.has(bg!), `duplicate --mm-bg ${bg} in ${file} and ${bgs.get(bg!)}`).toBe(false);
      bgs.set(bg!, file);
    }

    // The SPEC6 §4 required ids all exist.
    for (const id of [
      'crisp-mono', 'typewriter', 'manuscript', 'newsprint', 'sepia',
      'solarized-dark', 'gruvbox-dark', 'gruvbox-light', 'tokyo-night',
      'catppuccin-mocha', 'catppuccin-latte', 'github-dark', 'rose-pine',
      'everforest-dark', 'night-owl', 'zenburn', 'ayu-light',
      'phosphor', 'amber-terminal', 'vaporwave',
    ]) {
      expect(ids.has(id), `missing required theme: ${id}`).toBe(true);
    }
  });
});

describe('PRD 023 Req 7 — the scratch-name token across bundled themes (issue #291)', () => {
  test('U1129: the token pair is declared in the chrome block, colour derived from the contract accent', () => {
    const styles = readFileSync(
      fileURLToPath(new URL('../../src/styles.css', import.meta.url)),
      'utf8'
    );
    const chrome = /CHROME TOKENS — BEGIN([\s\S]*?)CHROME TOKENS — END/.exec(styles)?.[1] ?? '';
    // Derived from --mm-accent (PRD 018 Req 2): no theme has to define it.
    expect(chrome).toMatch(/--mm-scratch-name:\s*var\(--mm-accent/);
    expect(chrome).toMatch(/--mm-scratch-name-style:\s*italic/);
    // Documented for theme authors and for the style lint's var() rule.
    for (const doc of ['THEMES.md', 'docs/STYLE-GUIDE.md']) {
      const text = readFileSync(fileURLToPath(new URL(`../../${doc}`, import.meta.url)), 'utf8');
      expect(text, `${doc} documents --mm-scratch-name`).toContain('--mm-scratch-name');
      expect(text, `${doc} documents --mm-scratch-name-style`).toContain('--mm-scratch-name-style');
    }
  });

  test('U1130: no bundled theme defines the token, yet it resolves readably on all — every theme has an accent distinct from its background', () => {
    const files = readdirSync(themesDir).filter((f) => f.endsWith('.css'));
    expect(files.length).toBeGreaterThanOrEqual(27);
    for (const file of files) {
      const css = readFileSync(path.join(themesDir, file), 'utf8');
      // The treatment is free: themes restyle it through --mm-accent alone.
      expect(css.includes('--mm-scratch-name'), `${file} must not define the scratch token`).toBe(false);
      const accent = /--mm-accent:\s*([^;]+);/.exec(css)?.[1].trim();
      const bg = /--mm-bg:\s*([^;]+);/.exec(css)?.[1].trim();
      expect(accent, `${file} must define --mm-accent`).toBeTruthy();
      expect(bg, `${file} must define --mm-bg`).toBeTruthy();
      // Readability floor: the accent-coloured placeholder never dissolves
      // into the page — the two values differ on every bundled theme.
      expect(accent!.toLowerCase(), `${file}: accent must differ from bg`).not.toBe(bg!.toLowerCase());
    }
  });
});
