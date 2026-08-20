/**
 * PRD 014 Req 4 + Req 5: the Search view's scan plumbing — enumerate the
 * markdown files the folder tree shows and load their text, as pure functions
 * over injected seams. No platform import and no React: the caller hands in
 * `readDirEntries` / `readTextFile` / `join` (the `src/platform/types.ts`
 * seams on desktop, the browser virtual fs and hosted workspaces alike) plus
 * the in-memory overrides for open buffers, and gets back the `SearchFile[]`
 * that `src/lib/searchCore.ts` scans. Issues #152–#155 extend the same
 * plumbing rather than rewriting it.
 */

import { isMarkdownFile, visibleEntries, type DirEntry } from './folderTree';
import type { LineMatch } from './searchCore';

/** The two filesystem seams the scan walks, plus the path joiner. */
export interface ScanSeams {
  readDirEntries(dir: string): Promise<DirEntry[]>;
  readTextFile(path: string): Promise<string>;
  join(...parts: string[]): string;
}

/** One file the scope contains — the name is kept for the filename match. */
export interface ScanEntry {
  path: string;
  name: string;
}

/**
 * PRD 014 Req 4: the scope — every open root, recursively, through the SAME
 * predicates the folder tree renders with (`visibleEntries` hides dotfiles
 * and dot-directories, `isMarkdownFile` cuts binaries, images and sidecars),
 * so the scan can never search a file the tree would not show. An unreadable
 * directory is skipped rather than failing the whole walk.
 */
export async function collectMarkdownFiles(roots: string[], seams: ScanSeams): Promise<ScanEntry[]> {
  const out: ScanEntry[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: DirEntry[];
    try {
      entries = await seams.readDirEntries(dir);
    } catch {
      return; // unreadable directory — skip it, keep the rest of the scan
    }
    for (const e of visibleEntries(entries)) {
      const path = seams.join(dir, e.name);
      if (e.isDir) await walk(path);
      else if (isMarkdownFile(e.name)) out.push({ path, name: e.name });
    }
  };
  for (const root of roots) await walk(root);
  return out;
}

/**
 * PRD 014 Req 5: load each file's text — the in-memory override where one
 * exists (the active document's buffer, a parked open file's parked buffer),
 * the disk text otherwise — so an unsaved edit is findable and text deleted
 * but not yet saved is not. A non-markdown path never reaches here (Req 4:
 * `collectMarkdownFiles` already cut it), and an unreadable file is skipped
 * rather than failing the scan.
 */
export async function loadSearchFiles(
  entries: ScanEntry[],
  overrides: ReadonlyMap<string, string>,
  readTextFile: (path: string) => Promise<string>
): Promise<Array<ScanEntry & { text: string }>> {
  const out: Array<ScanEntry & { text: string }> = [];
  for (const e of entries) {
    const override = overrides.get(e.path);
    if (override !== undefined) {
      out.push({ ...e, text: override });
      continue;
    }
    try {
      out.push({ ...e, text: await readTextFile(e.path) });
    } catch {
      /* unreadable file — skipped (Req 4) */
    }
  }
  return out;
}

/**
 * PRD 014 Req 8: a match's absolute [from, to) offsets in the document text,
 * from the line-relative `LineMatch` the result row carried — what the edit
 * pane's selection needs to highlight the hit. Line terminators are counted
 * with the SAME rule `findMatches` split on (`\r\n`, `\n`, and a lone `\r`
 * are each one break), so the offsets cannot skew against the match. Null
 * when the text no longer has that line (it changed since the scan).
 */
export function matchDocOffsets(text: string, match: LineMatch): { from: number; to: number } | null {
  let line = 1;
  let lineStart = 0;
  const breaks = /\r\n|\n|\r/g;
  while (line < match.line) {
    const b = breaks.exec(text);
    if (!b) return null;
    lineStart = b.index + b[0].length;
    line++;
  }
  const from = lineStart + match.start;
  const to = lineStart + match.end;
  return to <= text.length ? { from, to } : null;
}
