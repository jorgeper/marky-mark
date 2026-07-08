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
