/**
 * Theme engine (pure — no DOM, no platform imports, unit-testable).
 *
 * A theme is a single .css file that sets the --mm-* custom-property contract
 * on `.theme-root` (see THEMES.md), with metadata in a leading CSS comment
 * block of the form: `@name: Midnight Ocean`, `@author: jorge`,
 * `@variant: dark` — one per line inside the file's first comment.
 *
 * Themes must be self-contained: any rule referencing a remote url(http…)
 * is rejected at load time (the theme is refused, never partially applied),
 * because the app promises zero network access.
 */

export interface ThemeMeta {
  /** Stable identifier: slugified file basename (without .css). */
  id: string;
  name: string;
  author: string;
  variant: 'light' | 'dark';
  builtin: boolean;
}

export interface Theme extends ThemeMeta {
  css: string;
}

/** Matches url( http:// | https:// | //protocol-relative ) — remote refs. */
const REMOTE_URL = /url\(\s*['"]?\s*(?:https?:)?\/\//i;

export function hasRemoteUrls(css: string): boolean {
  return REMOTE_URL.test(css);
}

function metaValue(block: string, key: string): string | null {
  const m = new RegExp(`@${key}\\s*:\\s*([^\\n*]+)`, 'i').exec(block);
  return m ? m[1].trim() : null;
}

/** Basename without extension → display fallback ("solarized-light" → "Solarized Light"). */
function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.css$/i, '').replace(/^.*\//, '');
  return base
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function idFromFilename(filename: string): string {
  return filename
    .replace(/\.css$/i, '')
    .replace(/^.*\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Parse a theme file. Metadata is read from the first comment block; missing
 * or malformed metadata falls back to the filename — this never throws.
 * Returns null only when the theme is rejected (remote urls or empty file).
 */
export function parseTheme(filename: string, css: string, builtin: boolean): Theme | null {
  if (!css.trim()) return null;
  if (hasRemoteUrls(css)) return null;

  let name: string | null = null;
  let author: string | null = null;
  let variant: string | null = null;
  const firstComment = /\/\*([\s\S]*?)\*\//.exec(css);
  if (firstComment) {
    name = metaValue(firstComment[1], 'name');
    author = metaValue(firstComment[1], 'author');
    variant = metaValue(firstComment[1], 'variant');
  }

  return {
    id: idFromFilename(filename),
    name: name || nameFromFilename(filename),
    author: author || 'unknown',
    variant: variant?.toLowerCase() === 'dark' ? 'dark' : 'light',
    builtin,
    css,
  };
}
