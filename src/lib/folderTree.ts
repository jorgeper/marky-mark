/**
 * SPEC34 §2.1: the folder sidebar's pure logic — entry classification,
 * ordering, dotfile filtering, reveal ancestry, and the persisted state
 * (foldertree.json: chosen root + expanded directories). No DOM, no
 * platform imports; path splitting is '/'-and-'\\'-tolerant so the same
 * logic serves macOS, Windows, and the virtual shim fs.
 */

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export interface FolderState {
  version: 1;
  root: string | null;
  expanded: string[];
}

export const EXPANDED_CAP = 200;

export function isMarkdownFile(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

/** Folders first, then case-insensitive alphabetical within each group. */
export function compareEntries(a: DirEntry, b: DirEntry): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

/** Dotfiles and dot-directories stay hidden (SPEC34 scope). */
export function visibleEntries(entries: DirEntry[]): DirEntry[] {
  return entries.filter((e) => !e.name.startsWith('.')).sort(compareEntries);
}

/**
 * The directories that must be expanded to reveal `path` under `root`,
 * outermost first, INCLUDING the root itself. Empty when `path` is not
 * inside `root` (the caller retargets the root instead).
 */
export function ancestorsOf(root: string, path: string, dirname: (p: string) => string): string[] {
  const norm = (p: string) => p.replace(/[\\/]+$/, '');
  const r = norm(root);
  if (!path.startsWith(`${r}/`) && !path.startsWith(`${r}\\`)) return [];
  const chain: string[] = [];
  let dir = norm(dirname(path));
  while (dir.length >= r.length) {
    chain.unshift(dir);
    if (dir === r) break;
    const parent = norm(dirname(dir));
    if (parent === dir) break; // filesystem root — never reached r; not inside
    dir = parent;
  }
  return chain[0] === r ? chain : [];
}

export function parseFolderState(json: string): FolderState {
  const empty: FolderState = { version: 1, root: null, expanded: [] };
  try {
    const d = JSON.parse(json) as Partial<FolderState>;
    const root = typeof d.root === 'string' && d.root ? d.root : null;
    const expanded = Array.isArray(d.expanded)
      ? d.expanded.filter((e): e is string => typeof e === 'string' && e.length > 0).slice(0, EXPANDED_CAP)
      : [];
    return { version: 1, root, expanded };
  } catch {
    return empty;
  }
}

export function serializeFolderState(state: FolderState): string {
  return `${JSON.stringify({ ...state, expanded: state.expanded.slice(0, EXPANDED_CAP) }, null, 2)}\n`;
}
