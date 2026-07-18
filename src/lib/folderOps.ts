/**
 * SPEC35 §2: the sidebar file-management pure logic — entry-name validation,
 * unique child naming, path remapping after rename/delete, relative paths,
 * and the context-menu model (the single source of menu truth). No DOM, no
 * platform imports; path handling is '/'-and-'\\'-tolerant like folderTree.
 */

export type FolderMenuItem = { id: string; label: string } | 'sep';

/** Windows-reserved basenames, judged on the name before its first '.'. */
const RESERVED = /^(aux|con|prn|nul|com[1-9]|lpt[1-9])$/;

/** Human error for an invalid file/folder name, or null when valid. */
export function validateEntryName(name: string): string | null {
  if (!name.trim()) return 'Name required';
  if (/[/\\]/.test(name)) return 'Names cannot contain / or \\';
  if (name === '.' || name === '..') return 'Not a valid name';
  // Dotfiles are invisible to the tree (SPEC34) — creating one would vanish it.
  if (name.startsWith('.')) return 'Names starting with “.” are hidden from the tree';
  if (/[. ]$/.test(name)) return 'Names cannot end with a dot or space';
  if (name.length > 255) return 'Name too long';
  const stem = name.split('.')[0].toLowerCase();
  if (RESERVED.test(stem)) return `“${stem}” is a reserved name on Windows`;
  return null;
}

/** `base`, else `base` with ` 2`, ` 3`, … before the extension (case-insensitive). */
export function uniqueChildName(existing: string[], base: string): string {
  const taken = new Set(existing.map((e) => e.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * `path` with `oldPrefix` (an exact entry or directory prefix,
 * separator-aware) rewritten to `newPrefix`; null when unaffected.
 */
export function remapPath(path: string, oldPrefix: string, newPrefix: string): string | null {
  if (path === oldPrefix) return newPrefix;
  if (path.startsWith(`${oldPrefix}/`) || path.startsWith(`${oldPrefix}\\`))
    return newPrefix + path.slice(oldPrefix.length);
  return null;
}

/**
 * `path` relative to `root`, preserving the separators found in the inputs;
 * the root itself ⇒ '.'. A path outside the root passes through verbatim
 * (the menu only ever offers rows inside the tree).
 */
export function relativePath(root: string, path: string): string {
  const r = root.replace(/[\\/]+$/, '');
  if (path === r || path.replace(/[\\/]+$/, '') === r) return '.';
  const rest = remapPath(path, r, '');
  return rest === null ? path : rest.replace(/^[\\/]/, '');
}

/**
 * SPEC35 §2.5: the context-menu model. Items whose capability flag is false
 * are omitted, and a flanking separator collapses (never doubled, never at
 * either end).
 */
export function folderContextMenu(
  kind: 'dir' | 'file' | 'root',
  opts: { isMac: boolean; canReveal: boolean; canTrash: boolean; canRename: boolean; canCopy: boolean }
): FolderMenuItem[] {
  const revealLabel = opts.isMac ? 'Reveal in Finder' : 'Reveal in File Explorer';
  const item = (id: string, label: string, on: boolean): FolderMenuItem | null => (on ? { id, label } : null);
  const raw: Array<FolderMenuItem | null> =
    kind === 'dir'
      ? [
          item('new-file', 'New File', true),
          item('new-folder', 'New Folder', true),
          'sep',
          item('rename', 'Rename', opts.canRename),
          item('delete', 'Delete', opts.canTrash),
          'sep',
          item('reveal', revealLabel, opts.canReveal),
          'sep',
          item('copy-path', 'Copy Path', opts.canCopy),
          item('copy-relative-path', 'Copy Relative Path', opts.canCopy),
        ]
      : kind === 'file'
        ? [
            item('reveal', revealLabel, opts.canReveal),
            'sep',
            item('rename', 'Rename', opts.canRename),
            item('delete', 'Delete', opts.canTrash),
            'sep',
            item('copy-path', 'Copy Path', opts.canCopy),
            item('copy-relative-path', 'Copy Relative Path', opts.canCopy),
          ]
        : [
            item('new-file', 'New File', true),
            item('new-folder', 'New Folder', true),
            'sep',
            item('reveal', revealLabel, opts.canReveal),
            'sep',
            item('copy-path', 'Copy Path', opts.canCopy),
          ];
  const out: FolderMenuItem[] = [];
  for (const it of raw) {
    if (it === null) continue;
    if (it === 'sep' && (out.length === 0 || out[out.length - 1] === 'sep')) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1] === 'sep') out.pop();
  return out;
}
