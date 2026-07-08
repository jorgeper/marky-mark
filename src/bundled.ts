/**
 * Assets compiled into the app bundle via Vite raw imports: the seven
 * built-in themes, the sample documents, and the theming guide. Built-in
 * themes go through the exact same parseTheme() path as user themes — being
 * bundled is their only special treatment (SPEC FR-3).
 */

const themeFiles = import.meta.glob('/themes/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const fixtureFiles = import.meta.glob('/fixtures/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const themesDoc = import.meta.glob('/THEMES.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function byBasename(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    out[path.split('/').pop()!] = content;
  }
  return out;
}

/** basename (e.g. "monokai.css") → css text */
export const BUILTIN_THEME_FILES: Record<string, string> = byBasename(themeFiles);

/** basename (e.g. "welcome.md") → markdown text */
export const FIXTURES: Record<string, string> = byBasename(fixtureFiles);

/** THEMES.md content, copied into the user themes folder as README.md on first run. */
export const THEMES_GUIDE: string = themesDoc['/THEMES.md'] ?? '';
