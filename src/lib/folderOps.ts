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

/** The parent directory of a path, separator-tolerant ('' at the top). */
function parentOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut === -1 ? '' : path.slice(0, cut);
}

/** The final segment of a path, separator-tolerant. */
function baseOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut === -1 ? path : path.slice(cut + 1);
}

/** Where a dragged row may land: the new path, or why it may not. */
export type MoveTarget = { ok: true; path: string } | { ok: false; reason: string | null };

/**
 * PRD 007 Req 18: where a dragged row lands, or why it cannot. Pure so the
 * drop target can be judged before any I/O — the three ways a move is
 * meaningless or destructive are all decidable from paths plus the target's
 * listing:
 *   - a directory into itself or its own descendant would detach the subtree;
 *   - a drop back into the row's current parent is a no-op, not an error the
 *     user should see a message about (it just does nothing — a null reason);
 *   - a name already taken in the target would clobber a sibling.
 * `existing` is the target directory's child names (case-insensitively
 * matched, like `uniqueChildName`). The separator of the result is inferred
 * from the target path, so Windows paths stay Windows paths.
 */
export function moveTarget(source: string, destDir: string, existing: string[]): MoveTarget {
  // `remapPath` answers "is destDir the source itself, or inside it?" — both
  // are the self-nesting case.
  if (remapPath(destDir, source, source) !== null) {
    return { ok: false, reason: 'A folder cannot be moved inside itself' };
  }
  if (parentOf(source) === destDir) return { ok: false, reason: null }; // already there
  const name = baseOf(source);
  if (existing.some((e) => e.toLowerCase() === name.toLowerCase())) {
    return { ok: false, reason: `“${name}” already exists in that folder` };
  }
  const sep = destDir.includes('\\') && !destDir.includes('/') ? '\\' : '/';
  return { ok: true, path: `${destDir.replace(/[\\/]+$/, '')}${sep}${name}` };
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
  opts: {
    isMac: boolean;
    canReveal: boolean;
    canTrash: boolean;
    canRename: boolean;
    canCopy: boolean;
    /**
     * PRD 007 Req 17/18/19: the permission-gated rows. All three are OPTIONAL
     * so every pre-#76 call site keeps its exact menu: creation stays on (the
     * flavors without a permission model always allowed it) and the hosted
     * transfer rows stay off until a platform offers those seams.
     */
    canCreate?: boolean;
    canUpload?: boolean;
    canDownload?: boolean;
    /** Whether a folder may be created (hosted: `folder.manage`). */
    canCreateFolder?: boolean;
  }
): FolderMenuItem[] {
  const revealLabel = opts.isMac ? 'Reveal in Finder' : 'Reveal in File Explorer';
  const canCreate = opts.canCreate ?? true;
  const canCreateFolder = opts.canCreateFolder ?? canCreate;
  const item = (id: string, label: string, on: boolean): FolderMenuItem | null => (on ? { id, label } : null);
  const raw: Array<FolderMenuItem | null> =
    kind === 'dir'
      ? [
          item('new-file', 'New File', canCreate),
          item('new-folder', 'New Folder', canCreateFolder),
          item('upload', 'Upload File…', opts.canUpload ?? false),
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
            item('download', 'Download', opts.canDownload ?? false),
            'sep',
            item('rename', 'Rename', opts.canRename),
            item('delete', 'Delete', opts.canTrash),
            'sep',
            item('copy-path', 'Copy Path', opts.canCopy),
            item('copy-relative-path', 'Copy Relative Path', opts.canCopy),
          ]
        : [
            item('new-file', 'New File', canCreate),
            item('new-folder', 'New Folder', canCreateFolder),
            item('upload', 'Upload File…', opts.canUpload ?? false),
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
