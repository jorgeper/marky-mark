/**
 * PRD 014 Req 4 + Req 5: the Search view's scan plumbing — enumerate the
 * markdown files the folder tree shows and load their text, as pure functions
 * over injected seams. No platform import and no React: the caller hands in
 * `readDirEntries` / `readTextFile` / `join` (the `src/platform/types.ts`
 * seams on desktop, the browser virtual fs and hosted workspaces alike) plus
 * the in-memory overrides for open buffers, and gets back the `SearchFile[]`
 * that `src/lib/searchCore.ts` scans. Issues #152–#155 extend the same
 * plumbing rather than rewriting it.
 *
 * PRD 014 Req 9 (issue #153) sits on top (`runSearchScan`): the same
 * enumeration and loading, paced in bounded chunks that yield to the event
 * loop and abandoned the moment a newer query supersedes the run.
 *
 * PRD 014 Req 8 rides along at the bottom (`matchDocOffsets`): the same
 * line-numbering rule read backwards, turning a result row's line-relative
 * match into the document offsets the edit pane selects.
 */

import { isMarkdownFile, visibleEntries, type DirEntry } from './folderTree.ts';
import {
  groupResults,
  searchFile,
  type FileSearchResult,
  type LineMatch,
  type SearchFile,
  type SearchMatcher,
  type SearchResults,
} from './searchCore.ts';

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
  // An always-open gate can never abandon the walk, so the null branch is
  // unreachable here — `?? []` states that without asserting a type.
  return (await walkRoots(roots, seams, async () => true)) ?? [];
}

/**
 * PRD 014 Req 9 (issue #153): the shared walk under `collectMarkdownFiles` and
 * `runSearchScan` — same scope predicates, but gated: `gate()` runs before
 * every directory read, and a false return abandons the walk (null) without
 * issuing another seam call.
 */
async function walkRoots(
  roots: string[],
  seams: ScanSeams,
  gate: () => Promise<boolean>
): Promise<ScanEntry[] | null> {
  const out: ScanEntry[] = [];
  let live = true;
  const walk = async (dir: string): Promise<void> => {
    if (!(await gate())) {
      live = false;
      return;
    }
    let entries: DirEntry[];
    try {
      entries = await seams.readDirEntries(dir);
    } catch {
      return; // unreadable directory — skip it, keep the rest of the scan
    }
    for (const e of visibleEntries(entries)) {
      if (!live) return;
      const path = seams.join(dir, e.name);
      if (e.isDir) await walk(path);
      else if (isMarkdownFile(e.name)) out.push({ path, name: e.name });
    }
  };
  for (const root of roots) {
    if (!live) break;
    await walk(root);
  }
  return live ? out : null;
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
): Promise<SearchFile[]> {
  const out: SearchFile[] = [];
  for (const e of entries) {
    const file = await loadSearchFile(e, overrides, readTextFile);
    if (file) out.push(file);
  }
  return out;
}

/**
 * PRD 014 Req 5 for one entry — the whole rule in one place, so the batch
 * above and `runSearchScan`'s file-at-a-time chunking cannot drift apart.
 * The `SearchFile` return type is `searchCore`'s own unit of scope, so the
 * scan's output and the matcher's input cannot drift either. Null is an
 * unreadable file: skipped rather than failing the scan (Req 4).
 */
async function loadSearchFile(
  entry: ScanEntry,
  overrides: ReadonlyMap<string, string>,
  readTextFile: (path: string) => Promise<string>
): Promise<SearchFile | null> {
  const override = overrides.get(entry.path);
  if (override !== undefined) return { ...entry, text: override };
  try {
    return { ...entry, text: await readTextFile(entry.path) };
  } catch {
    return null;
  }
}

/**
 * PRD 014 Req 9 (issue #153): how a scan run is paced and abandoned. All
 * three knobs are injectable so unit tests can drive the run with fake seams
 * and count exactly which calls happen after a supersession.
 */
export interface ScanControl {
  /**
   * False once a newer (query, options) pair owns the panel. Checked between
   * chunks and once more before the results are returned, so a superseded
   * scan stops issuing seam calls instead of merely dropping its result.
   */
  isCurrent?: () => boolean;
  /** The yield between chunks — a macrotask by default, immediate in tests. */
  yieldNow?: () => Promise<void>;
  /** Seam operations (directory reads + file loads) per chunk. */
  chunkSize?: number;
}

/** PRD 014 Req 9: one event-loop turn — the default between-chunk yield. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * PRD 014 Req 9: bounded chunks. Small enough that a keystroke never waits
 * behind more than a handful of seam calls, large enough that a ~200-file
 * tree costs only a few yields.
 */
const DEFAULT_SCAN_CHUNK = 16;

/**
 * PRD 014 Req 9 (issue #153): the whole scan as ONE cancellable run —
 * enumerate (Req 4's scope), load (Req 5's overrides) and match (Req 7's
 * grouping) in bounded chunks that yield to the event loop between them, so a
 * folder-wide scan never blocks typing or editing. Returns the grouped
 * results of a completed scan, or null when `isCurrent()` reported the run
 * superseded — in which case no further seam call was issued after the check,
 * and the caller must paint nothing: the newer run owns the panel.
 */
export async function runSearchScan(
  roots: string[],
  seams: ScanSeams,
  overrides: ReadonlyMap<string, string>,
  matcher: SearchMatcher,
  control: ScanControl = {}
): Promise<SearchResults | null> {
  const isCurrent = control.isCurrent ?? (() => true);
  const yieldNow = control.yieldNow ?? yieldToEventLoop;
  const chunk = control.chunkSize ?? DEFAULT_SCAN_CHUNK;
  let ops = 0;
  // The chunk boundary: after every `chunk` seam operations, yield one
  // event-loop turn (keystrokes, paints and the debounce land here) and
  // re-check ownership before issuing the next seam call.
  const gate = async (): Promise<boolean> => {
    if (ops > 0 && ops % chunk === 0) {
      await yieldNow();
      if (!isCurrent()) return false;
    }
    ops++;
    return true;
  };
  const entries = await walkRoots(roots, seams, gate);
  if (entries === null) return null;
  const perFile: FileSearchResult[] = [];
  for (const entry of entries) {
    if (!(await gate())) return null;
    // Req 5 unchanged: the override where one exists, the disk text
    // otherwise, an unreadable file skipped — one entry at a time so the
    // matching happens inside the same chunked cadence as the loading.
    const file = await loadSearchFile(entry, overrides, seams.readTextFile);
    if (file) perFile.push(searchFile(file, matcher));
  }
  // The finish line is a check too: a run superseded during its last chunk
  // must not hand back results the caller could mistake for current.
  return isCurrent() ? groupResults(perFile) : null;
}

/**
 * PRD 014 Req 8: a match's absolute [from, to) offsets in the document text,
 * from the line-relative `LineMatch` the result row carried — what the edit
 * pane's selection needs to highlight the hit. Line terminators are counted
 * with the SAME rule `findMatches` split on (`\r\n`, `\n`, and a lone `\r`
 * are each one break), so the offsets cannot skew against the match. Null
 * when the text cannot hold the match at all — fewer lines than the match
 * names, or offsets past its end — both signs it changed since the scan.
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
