/**
 * PRD 009 Req 13+14: the pure logic behind the in-workspace save picker — the
 * ONE naming surface New File and Save As… share on a flavor with no local
 * save dialog. It answers which folders may be named, which one opens
 * selected, which name is pre-filled, whether a typed name may be committed,
 * and — because the picker is what lets New File exist without a save dialog —
 * where New File is offered at all. No DOM, no platform imports (the caller
 * injects its own `join`), so both actions and the unit suite ask the same
 * code.
 */

import { uniqueChildName, validateEntryName } from './folderOps.ts';

/** Which action is naming a file — it decides the pre-filled name only. */
export type SavePickerKind = 'new' | 'saveAs';

/** One selectable folder: the real path, plus how it reads in the control. */
export interface PickerFolder {
  path: string;
  label: string;
}

/** A directory listing entry, as `readDirEntries` reports it. */
interface Entry {
  name: string;
  isDir: boolean;
}

/** Separator-tolerant, matching folderOps: '\\' only for a pure Windows path. */
const sepOf = (path: string) => (path.includes('\\') && !path.includes('/') ? '\\' : '/');
const joinChild = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, '')}${sepOf(dir)}${name}`;
const baseOf = (path: string) => {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut === -1 ? path : path.slice(cut + 1);
};
/** Is `path` the root itself or inside it? (the containment test, separator-aware) */
const inside = (root: string, path: string) => {
  const r = root.replace(/[\\/]+$/, '');
  return path === r || path.startsWith(`${r}/`) || path.startsWith(`${r}\\`);
};

/**
 * PRD 009 Req 13: the folders the picker may name, drawn from the workspace's
 * own tree — every root the sidebar lists, plus the descendants already listed
 * through `readDirEntries` (`children`), each root's subtree sorted so the
 * control is stable. `docDir` (the open document's directory) joins the list
 * when it is inside a root but not yet listed, so Save As… can always offer
 * "where this file already lives".
 *
 * Nothing outside the roots can appear: the walk starts at the roots and a
 * `children` key that is not inside one is ignored. That is the whole
 * guarantee that the picker cannot name a path outside the workspace — there
 * is no free-text path input to check.
 */
export function pickerFolders(opts: {
  roots: readonly string[];
  children: Readonly<Record<string, readonly Entry[]>>;
  docDir?: string | null;
  join?: (dir: string, name: string) => string;
}): PickerFolder[] {
  const join = opts.join ?? joinChild;
  const out: PickerFolder[] = [];
  const seen = new Set<string>();
  for (const root of opts.roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    out.push({ path: root, label: baseOf(root) || root });
    const descendants: string[] = [];
    const walk = (dir: string) => {
      for (const entry of opts.children[dir] ?? []) {
        if (!entry.isDir) continue;
        const path = join(dir, entry.name);
        if (seen.has(path)) continue;
        seen.add(path);
        descendants.push(path);
        walk(path);
      }
    };
    walk(root);
    if (opts.docDir && inside(root, opts.docDir) && !seen.has(opts.docDir)) {
      seen.add(opts.docDir);
      descendants.push(opts.docDir);
    }
    descendants.sort((a, b) => a.localeCompare(b));
    for (const path of descendants) out.push({ path, label: `${baseOf(root) || root}/${relativeLabel(root, path)}` });
  }
  return out;
}

/** A descendant's path below its root, always shown with '/' separators. */
function relativeLabel(root: string, path: string): string {
  const r = root.replace(/[\\/]+$/, '');
  return path.slice(r.length).replace(/^[\\/]/, '').replace(/\\/g, '/');
}

/**
 * PRD 009 Req 13: the folder the picker opens on — the current document's
 * directory when that is one of the offered folders, else the workspace's
 * first root ('' when there is no workspace at all, which is the caller's cue
 * that there is nowhere to write).
 */
export function defaultFolder(folders: readonly PickerFolder[], docDir: string | null): string {
  if (docDir && folders.some((f) => f.path === docDir)) return docDir;
  return folders[0]?.path ?? '';
}

/**
 * PRD 009 Req 13+14: the pre-filled name — a FREE `Untitled.md` for New File
 * (the same first guess the sidebar's New File makes), the current document's
 * basename for Save As… (an untitled buffer has none, so it falls back).
 */
export function defaultName(
  kind: SavePickerKind,
  opts: { docBasename?: string | null; existing: readonly string[] }
): string {
  if (kind === 'saveAs' && opts.docBasename) return opts.docBasename;
  return uniqueChildName([...opts.existing], 'Untitled.md');
}

/** PRD 019 Req 12: the first heading's text (ATX or setext), else the first
 * non-empty line — a small local scan, per the spec, not a Markdown parse. */
const ATX = /^ {0,3}#{1,6}\s+(.*)$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)\s*$/;
function firstContentLine(text: string): string {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const atx = ATX.exec(lines[i]);
    if (atx) return atx[1].replace(/\s+#+\s*$/, ''); // a closing '#' run is decoration
    if (lines[i].trim() && i + 1 < lines.length && SETEXT_UNDERLINE.test(lines[i + 1])) return lines[i];
  }
  return lines.find((l) => l.trim()) ?? '';
}

/** Inline markup off a single line: links/images keep their text, emphasis
 * and code markers go; intraword underscores (snake_case) are not emphasis. */
const stripMarkup = (line: string) =>
  line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*~]+/g, '')
    .replace(/\b_+|_+\b/g, '');

/** Toward a name `validateEntryName` accepts: no separators, no leading dot
 * (hidden from the tree), no trailing dot/space, room for '.md' within 255. */
const sanitizeName = (text: string) =>
  text
    .replace(/[/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 252)
    .replace(/[. ]+$/, '');

const two = (n: number) => String(n).padStart(2, '0');
const timestampName = (d: Date) =>
  `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}`;

/**
 * PRD 019 Req 12: the scratch buffer's Save As pre-fill, named from its own
 * content — the first Markdown heading, else the first non-empty line,
 * stripped of markup and sanitized; a buffer with no usable text (or a name
 * `validateEntryName` still refuses, e.g. a reserved Windows stem) falls back
 * to a `YYYY-MM-DD HH.mm` timestamp. `.md` is appended when the derived name
 * lacks an extension, and a collision in the target folder dedupes via
 * `uniqueChildName` exactly like `defaultName`. Pure: the clock comes in as
 * `now`, so the unit suite pins it.
 */
export function scratchSaveName(text: string, opts: { existing: readonly string[]; now: Date }): string {
  const cleaned = sanitizeName(stripMarkup(firstContentLine(text)));
  let name = cleaned ? withDefaultExtension(cleaned) : '';
  if (!name || validateEntryName(name)) name = `${timestampName(opts.now)}.md`;
  return uniqueChildName([...opts.existing], name);
}

/** A name with no extension gets `.md` — the picker writes Markdown. */
export function withDefaultExtension(name: string): string {
  const trimmed = name.trim();
  return /\.[^.\\/]+$/.test(trimmed) ? trimmed : `${trimmed}.md`;
}

/** The committed name, or why the picker must stay open with its message. */
export type PickerCheck = { ok: true; name: string } | { ok: false; error: string };

/**
 * PRD 009 Req 13: may this name be committed into a folder holding `existing`?
 * The raw input is judged by `validateEntryName` FIRST (so the message is the
 * one the sidebar's rename row shows for the same input, not a message about
 * the `.md` this would otherwise append), then the defaulted name is matched
 * case-insensitively against the folder's children: a collision is refused
 * outright, so committing can never destroy a file that is already there.
 */
export function checkPickerName(raw: string, existing: readonly string[]): PickerCheck {
  const invalid = validateEntryName(raw.trim());
  if (invalid) return { ok: false, error: invalid };
  const name = withDefaultExtension(raw);
  // The appended `.md` is part of the name that lands on disk, so it faces the
  // same rules — it can push a name just under the 255-character limit over it.
  const invalidWithExtension = validateEntryName(name);
  if (invalidWithExtension) return { ok: false, error: invalidWithExtension };
  if (existing.some((e) => e.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: `“${name}” already exists in that folder` };
  }
  return { ok: true, name };
}

/**
 * PRD 009 Req 13/16: is New File offered here? The capability tested is the
 * platform's own save dialog — never which flavor is running (the rule
 * lib/startActions.ts already follows): a platform that HAS one keeps SPEC22's
 * untitled buffer everywhere, because that buffer can always be saved
 * somewhere. Without one an untitled buffer is a dead end, so creating a file
 * means naming a real one inside the workspace: it needs a workspace to write
 * into, the listing seam the picker draws its folders from, and the
 * `file.create` grant that gates the sidebar's own New File row (PRD 007
 * Req 17). Shared by the menu row and the command so the two cannot drift.
 */
export function canOfferNewFile(opts: {
  hasSaveDialog: boolean;
  inWorkspace: boolean;
  canList: boolean;
  canCreate: boolean;
}): boolean {
  if (opts.hasSaveDialog) return true;
  return opts.inWorkspace && opts.canList && opts.canCreate;
}
