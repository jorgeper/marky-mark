/**
 * PRD 014 Req 12: the search core — query compilation from the toggle states,
 * per-file match extraction with line context, and result grouping/ordering,
 * as pure functions over plain data. Both surfaces (the Search sidebar view,
 * issues #151–#153, and the in-file find bar, issue #154) share this module,
 * so an option cannot behave differently in the two.
 *
 * PRD 014 Req 4 + Req 5: scope is the caller's job. Nothing here reads the
 * filesystem or a platform seam — the caller enumerates files (the folder
 * tree's `visibleEntries`/`isMarkdownFile`) and passes `{ path, name, text }`,
 * supplying an unsaved buffer's in-memory text instead of the stale disk text
 * where one exists. The same matcher therefore serves a folder-wide scan and
 * a single in-memory buffer.
 */

/** PRD 014 Req 6: the three query toggles. All off = case-insensitive literal substring. */
export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** One hit inside a single string, as [start, end) offsets. */
export interface MatchRange {
  start: number;
  end: number;
}

/**
 * PRD 014 Req 6: what a compiled query can do — find every hit in a string,
 * or just answer whether one exists (the filename test). Stateless between
 * calls, so one matcher scans any number of files.
 */
export interface SearchMatcher {
  /** Every match in `text`, in order. Never loops: a zero-length hit advances. */
  findAll(text: string): MatchRange[];
  /** True when `text` contains at least one match. */
  test(text: string): boolean;
}

/**
 * PRD 014 Req 10 (issue #154): the final pattern behind a compiled matcher —
 * escaping, whole-word wrapping and the case decision already applied — for
 * an engine that runs its own regex over the same semantics. The find bar's
 * edit mode builds CodeMirror's `SearchQuery` from exactly this source, so
 * the two modes cannot diverge on escaping, word boundaries or flags.
 */
export interface CompiledPattern {
  /** Regex source, ready for `new RegExp` — empty for the empty query. */
  source: string;
  caseSensitive: boolean;
}

/**
 * PRD 014 Req 6: compilation is a discriminated result, never a throw — an
 * invalid regex comes back as `kind: 'invalid-regex'` with a message the UI
 * renders inline, and is never silently matched as a literal instead.
 */
export type CompiledQuery =
  | { kind: 'matcher'; matcher: SearchMatcher; pattern: CompiledPattern }
  | { kind: 'invalid-regex'; message: string };

/** PRD 014 Req 6: an empty query finds nothing — it never matches everything. */
const NEVER: SearchMatcher = {
  findAll: () => [],
  test: () => false,
};

/** Literal mode escapes every regex metacharacter, so `a.b` matches only `a.b`. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matcherFrom(source: string, flags: string): SearchMatcher {
  // Two instances because `g` turns `lastIndex` into carried-over state, and
  // `RegExp.test` would advance it between calls. `matchAll` is immune: it
  // iterates a clone, so `finder.lastIndex` never moves and one matcher scans
  // any number of files. PRD 014 Req 6: `matchAll` is also what makes a
  // zero-length match (e.g. `a*`) advance past its position rather than
  // re-match it forever, so the scan cannot loop.
  const finder = new RegExp(source, `${flags}g`);
  const tester = new RegExp(source, flags);
  return {
    findAll(text: string): MatchRange[] {
      return [...text.matchAll(finder)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
    },
    test(text: string): boolean {
      return tester.test(text);
    },
  };
}

/**
 * PRD 014 Req 6: compile the query string plus the option state into a
 * matcher, or the structured invalid-regex error. Options combine: the flags
 * and the whole-word wrap apply to regex queries exactly as to literal ones,
 * and whole-word means word boundaries, not substring containment — `cat`
 * does not match `concatenate`.
 */
export function compileQuery(query: string, options: SearchOptions): CompiledQuery {
  if (query === '') {
    // The empty pattern source means "no query" to a downstream engine.
    return { kind: 'matcher', matcher: NEVER, pattern: { source: '', caseSensitive: options.caseSensitive } };
  }
  if (options.regex) {
    // Validate the pattern exactly as the user wrote it, before any wrapping,
    // so the error message names their input and not our scaffolding.
    try {
      new RegExp(query);
    } catch (e) {
      return { kind: 'invalid-regex', message: e instanceof Error ? e.message : String(e) };
    }
  }
  let source = options.regex ? `(?:${query})` : escapeRegExp(query);
  if (options.wholeWord) source = `\\b(?:${source})\\b`;
  return {
    kind: 'matcher',
    matcher: matcherFrom(source, options.caseSensitive ? '' : 'i'),
    pattern: { source, caseSensitive: options.caseSensitive },
  };
}

/**
 * PRD 014 Req 10 (issue #154): every match in one text as absolute [start,
 * end) offsets — the same line-scoped scan as `findMatches` (each terminator
 * is one break, no pattern spans one), mapped back into the whole string for
 * surfaces that highlight by document offset (the find bar's preview marks).
 */
export function findMatchRanges(text: string, matcher: SearchMatcher): MatchRange[] {
  const out: MatchRange[] = [];
  // Capturing split: even slots are lines, odd slots the terminators between
  // them, so the running offset stays exact for every terminator width.
  const parts = text.split(/(\r\n|\n|\r)/);
  let at = 0;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      for (const r of matcher.findAll(parts[i])) out.push({ start: at + r.start, end: at + r.end });
    }
    at += parts[i].length;
  }
  return out;
}

/**
 * PRD 014 Req 10 (issue #154): a replace text for a regex-mode engine while
 * the user's query is NOT in regex mode — `$` group references neutralized
 * (`$$` is the engine's escape for a literal `$`), so the replacement stays
 * byte-literal exactly as the literal engine behaved.
 */
export function literalReplacement(replace: string): string {
  return replace.replace(/\$/g, '$$$$');
}

/**
 * PRD 014 Req 7: one hit with the context the result list renders — the
 * 1-based line it sits on, that line's text, and the hit's offsets WITHIN the
 * line so the caller can highlight it without re-searching.
 */
export interface LineMatch {
  /** 1-based line number in the file. */
  line: number;
  /** The full line's text, terminator excluded. */
  lineText: string;
  /** Match start offset within `lineText`. */
  start: number;
  /** Match end offset within `lineText` (exclusive). */
  end: number;
}

/**
 * PRD 014 Req 7: every match in one file's text, in document order — multiple
 * hits on a line each get their own entry.
 *
 * The matcher runs against one line at a time, which buys two things and costs
 * one. It buys line-relative offsets for free, and it makes every terminator
 * (`\n`, `\r\n`, and a lone `\r`) count as exactly one break, so line numbers
 * cannot skew. It costs cross-line matching: `^` and `$` anchor to each line
 * rather than to the file, and no pattern can span a line break. Both surfaces
 * sharing this module get that same rule, which is the point.
 */
export function findMatches(text: string, matcher: SearchMatcher): LineMatch[] {
  const out: LineMatch[] = [];
  const lines = text.split(/\r\n|\n|\r/);
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    for (const range of matcher.findAll(lineText)) {
      out.push({ line: i + 1, lineText, start: range.start, end: range.end });
    }
  }
  return out;
}

/** PRD 014 Req 4: the caller-supplied unit of scope — plain data, no handle. */
export interface SearchFile {
  path: string;
  name: string;
  text: string;
}

/**
 * PRD 014 Req 7: one file's result group — whether its NAME matched (those
 * groups list first), its content matches, and the per-file match count the
 * group header shows (`matches.length`; a name-only hit is a group with 0).
 */
export interface FileSearchResult {
  path: string;
  name: string;
  nameMatch: boolean;
  matches: LineMatch[];
  matchCount: number;
}

/** PRD 014 Req 7 + Req 9: the grouped results plus the totals the UI reports. */
export interface SearchResults {
  /** Only files with a hit: name-matching files first, then content matches. */
  files: FileSearchResult[];
  /** Files with at least one hit of either kind. */
  fileCount: number;
  /** Content matches across all files. */
  matchCount: number;
}

/** PRD 014 Req 7: scan one file — its name for the group ordering, its text for the matches. */
export function searchFile(file: SearchFile, matcher: SearchMatcher): FileSearchResult {
  const matches = findMatches(file.text, matcher);
  return {
    path: file.path,
    name: file.name,
    nameMatch: matcher.test(file.name),
    matches,
    matchCount: matches.length,
  };
}

/**
 * PRD 014 Req 7: group per-file results — filename matches ordered before
 * content matches, hitless files dropped, totals summed. Each bucket keeps
 * the caller's file order, so the outcome is deterministic for a given input.
 */
export function groupResults(perFile: FileSearchResult[]): SearchResults {
  const hits = perFile.filter((f) => f.nameMatch || f.matchCount > 0);
  const files = [...hits.filter((f) => f.nameMatch), ...hits.filter((f) => !f.nameMatch)];
  return {
    files,
    fileCount: files.length,
    matchCount: files.reduce((n, f) => n + f.matchCount, 0),
  };
}

/** PRD 014 Req 7: the whole scan in one call — every file through `searchFile`, then grouped. */
export function searchFiles(files: SearchFile[], matcher: SearchMatcher): SearchResults {
  return groupResults(files.map((f) => searchFile(f, matcher)));
}
