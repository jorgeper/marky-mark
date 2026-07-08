import type { Platform } from './platform';
import { parseTheme, type Theme } from './lib/themes';
import { BUILTIN_THEME_FILES, THEMES_GUIDE } from './bundled';

/**
 * Theme discovery: bundled built-ins first, then user themes from
 * <configDir>/themes. Also drops THEMES.md into that folder as README.md on
 * first run so theme authors find the docs where they drop files (FR-2.4).
 */
export async function loadAllThemes(platform: Platform): Promise<Theme[]> {
  const themes: Theme[] = [];
  for (const [file, css] of Object.entries(BUILTIN_THEME_FILES)) {
    const t = parseTheme(file, css, true);
    if (t) themes.push(t);
  }
  themes.sort((a, b) => (a.id === 'crisp' ? -1 : b.id === 'crisp' ? 1 : a.name.localeCompare(b.name)));

  const dir = platform.join(await platform.configDir(), 'themes');
  await platform.mkdirp(dir);
  const readmePath = platform.join(dir, 'README.md');
  if (THEMES_GUIDE && !(await platform.exists(readmePath))) {
    await platform.writeTextFile(readmePath, THEMES_GUIDE);
  }

  const userThemes: Theme[] = [];
  for (const name of await platform.readDirNames(dir)) {
    if (!name.toLowerCase().endsWith('.css')) continue;
    try {
      const t = parseTheme(name, await platform.readTextFile(platform.join(dir, name)), false);
      if (t) userThemes.push(t);
    } catch {
      // unreadable user theme: skip, never crash the app
    }
  }
  userThemes.sort((a, b) => a.name.localeCompare(b.name));
  return [...themes, ...userThemes];
}

/** Swap the active theme by replacing one <style> element — no reload. */
export function applyThemeCss(css: string): void {
  let el = document.getElementById('mm-theme-style') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'mm-theme-style';
    document.head.appendChild(el);
  }
  el.textContent = css;
}
