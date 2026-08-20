# Spec: Search core: pure cross-file search logic in src/lib (#150)

## Goal

All acceptance criteria in issue-specs/issue-150.md are satisfied for issue
#150, with evidence visible in the session: a pure, unit-tested `src/lib/`
search module exists that compiles a query from the option state
(case-sensitive, whole-word, regex — defaulting to case-insensitive literal
substring) returning a matcher or a structured invalid-regex error instead of
throwing, extracts per-file matches with line number, line text and in-line
offsets, and groups results by file with filename matches ordered before
content matches plus file/match totals; nothing user-visible changes and no
e2e is added; `npm run validate:quick` passes in the implementer's session;
and a summary comment from the implementer exists on issue #150.

## Acceptance criteria

- A new module `src/lib/searchCore.ts` exists and is pure per
  `.sandcastle/CODING_STANDARDS.md`: no `react`, no `@tauri-apps/*`, no
  `src/components/` imports, no `src/platform/` imports, no DOM, no I/O, no
  network, no `console.*`. Callers supply the file list and the text to scan,
  so the same functions serve a folder-wide scan and a single in-memory
  buffer. Nothing user-visible changes in this issue — no component, sidebar
  view, toolbar button, hotkey or settings wiring lands here (those are
  issues #151–#155).
- **Query compilation** (PRD 014 Req 6, Req 12): an exported function takes
  the query string plus the option state (`caseSensitive`, `wholeWord`,
  `regex` — all off by default, i.e. a case-insensitive literal substring
  match) and returns a discriminated result: either a compiled matcher or a
  structured invalid-regex error carrying a message the UI can render. It
  **never throws** and **never silently falls back to literal matching** when
  a regex is invalid. Option combinations are supported, including
  case-sensitive regex and whole-word regex; a literal query's regex
  metacharacters are escaped, and whole-word uses word boundaries rather than
  substring containment (`cat` does not match `concatenate`). An empty query
  compiles to a matcher that finds nothing (or a clearly-typed empty result)
  rather than matching everything.
- **Per-file match extraction** (PRD 014 Req 7, Req 12): an exported function
  takes file text plus a compiled matcher and returns every match with its
  1-based line number, the line text for context, and the match's start/end
  offsets **within that line** so the caller can highlight the hit. Multiple
  matches on one line are all returned, in order. Zero-length regex matches
  (e.g. `a*`) advance rather than loop forever, and both `\n` and `\r\n` line
  endings produce correct line numbers and line text.
- **Result grouping and ordering** (PRD 014 Req 7, Req 12): an exported
  function takes the per-file results and returns matches grouped by file,
  each group carrying its per-file match count; **filename matches** (files
  whose name matches the query) are ordered before content matches; and the
  totals the UI reports (file count, match count) are returned. Group order
  is deterministic for a given input.
- The module holds no state of its own and performs no scanning of the
  filesystem: the caller enumerates files (the folder tree's job) and passes
  in `{ path, name, text }`-shaped plain data.
- Unit tests live in `tests/unit/search-core.test.ts` (the required
  `searchCore.ts` → `search-core.test.ts` pairing) and cover the module
  directly: each option alone, option combinations (at minimum case-sensitive
  regex and whole-word), an invalid regex returning the structured error, a
  zero-match query, multiple matches on one line, filename-vs-content
  ordering, and the empty file list. Every test title starts with its stable
  `U<n>:` id taking the next unused numbers (U677 is the current highest, so
  start at U678; numbers are never reused or renumbered), and `describe`
  blocks name the contract (e.g. `describe('PRD 014 Req 12 — search core')`).
  No existing test is weakened, deleted, or marked `.skip`/`.only`/`.fixme`,
  and the new tests do not depend on per-file isolation (`isolate: false`).
- **No e2e lands in this issue.** The e2e coverage PRD 014 Req 12 calls for —
  a multi-file search, each toggle, the no-results state, and click-to-open on
  both filename and content matches — arrives with the surfaces that provide
  it, in issues #151–#154.
- Module and tests carry citation comments per `.sandcastle/CODING_STANDARDS.md`
  and `docs/COMMENT-FORMAT.md`, in the `PRD 014 Req <n>: <what and why>` form
  that `src/lib/tocModel.ts` uses for PRD 012. If any `SPEC<n>` citation is
  added, `npm run map` has been run and the regenerated `docs/MAP.md` is
  committed.
- Iteration during the attempt uses `npm run typecheck` and
  `npm run test:unit` (or `npx vitest run tests/unit/search-core.test.ts`
  targeted at the changed code). `npm run validate:quick` is run **once**,
  right before declaring the goal met — not after every change, and not as a
  start-of-attempt baseline (baseline with the quick tier only) — and it
  prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #150, naming the
  module and test file, the U-numbers added, and the `validate:quick` result.

## Context

- **PRD:** `prd/014-search-all-files.md` is on this branch. Req 12 is this
  issue; Reqs 4–9 are the behaviours the module must make possible for the
  Search view, and Reqs 10–11 for the in-file find bar. Both surfaces share
  this module, so an option behaving differently in the two is a test failure,
  not a review catch.
- **Shape to copy:** `src/lib/tocModel.ts` (+ `tests/unit/toc-model.test.ts`)
  is the named mold — a pure, PRD-cited `src/lib/` layer with plain data in
  and out. `src/lib/fuzzy.ts` and `src/lib/folderTree.ts` are the other close
  siblings for the matching and file-entry idioms.
- **Scope enumeration is not this module's job:** `src/lib/folderTree.ts`
  already has `isMarkdownFile` and `visibleEntries`; the caller in #151 uses
  them plus the `readDirEntries`/`readTextFile` platform seams to build the
  file list, and PRD 014 Req 5 (unsaved buffers scanned in memory) is handled
  by the caller passing buffer text instead of disk text.
- **The in-file find bar** today drives `@codemirror/search` from
  `src/components/Editor.tsx` (`SearchQuery`, `setSearchQuery`). Do not change
  that here — issue #154 rewires it onto this module's option semantics.
- Commands worth knowing: `npm run typecheck`, `npm run test:unit`,
  `npm run validate:quick` (the gate; the e2e suite is slow and serialized —
  run it once at the end via the gate, not in the inner loop).
