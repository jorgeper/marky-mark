/**
 * SPEC20 §1–§2: naming and reference-building for images pasted into the
 * editor. Pure module — the platform seam does the writing; App wires the
 * two together. Every function here is synchronous so the caller can snapshot
 * the target folder's names once (readDirNames) and drive `exists` from that
 * set, keeping numbering race-free within a single paste.
 */

/** MIME → extension for pasted clipboard images; anything exotic lands as png. */
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime.toLowerCase()] ?? 'png';
}

/**
 * Windows refuses these basenames regardless of extension ("con.png" is as
 * unusable as "con"), and a repo checkout containing one bricks Windows CI —
 * so the app never mints them (they get a "-img" suffix instead).
 */
const RESERVED_BASENAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * SPEC20 §1 filename hygiene: strip characters no filesystem (or markdown
 * destination) wants, trim dot/space edges Windows rejects, side-step
 * reserved basenames, and never emit an empty name.
 */
export function sanitizeImageName(name: string): string {
  // eslint-disable-next-line no-control-regex
  let out = name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '');
  out = out.replace(/^[. ]+|[. ]+$/g, '');
  if (!out) return 'image';
  if (RESERVED_BASENAMES.test(out)) out = `${out}-img`;
  return out;
}

export interface NamingContext {
  /** Document basename without extension ("mods.md" → "mods"). */
  docName: string;
  /** Clock for {date}/{time}; injected so tests are deterministic. */
  now: Date;
  /** Case-insensitive membership test against the target folder's names. */
  exists(fileName: string): boolean;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/**
 * Expand the SPEC20 §1 pattern into a final `name.ext` that does not collide:
 * {doc}/{date}/{time} substitute directly; {n} takes the smallest positive
 * integer that frees the name. A pattern without {n} that collides gets
 * " {n}" appended implicitly — paste never overwrites an existing file.
 */
export function expandImageName(pattern: string, ext: string, ctx: NamingContext): string {
  const d = ctx.now;
  let base = (pattern || '{doc} {n}')
    .replaceAll('{doc}', ctx.docName)
    .replaceAll('{date}', `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
    .replaceAll('{time}', `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`);
  base = sanitizeImageName(base);

  if (!base.includes('{n}')) {
    if (!ctx.exists(`${base}.${ext}`)) return `${base}.${ext}`;
    base = `${base} {n}`;
  }
  for (let n = 1; ; n++) {
    const candidate = `${base.replaceAll('{n}', String(n))}.${ext}`;
    if (!ctx.exists(candidate)) return candidate;
  }
}

/**
 * A single path segment: non-empty, no separators, not a dot-walk. Used by
 * both the settings parser and the Settings panel's inline validation.
 */
export function isValidImageFolder(folder: string): boolean {
  return folder.trim().length > 0 && !/[/\\]/.test(folder) && folder !== '.' && folder !== '..';
}

/**
 * Percent-encode one path segment for a markdown destination: spaces and the
 * characters that would end or ambiguate `![](…)` — parens, angle brackets —
 * must not appear raw.
 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[()!*']/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** SPEC20 §2: the text inserted at the cursor for one pasted image. */
export function imageMarkdownRef(folder: string, fileName: string): string {
  const alt = fileName.replace(/\.[^.]+$/, '');
  return `![${alt}](${encodeSegment(folder)}/${encodeSegment(fileName)})`;
}
