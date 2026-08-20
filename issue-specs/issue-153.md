# Spec: Search state: match counts, loud no-results, scanning indicator, non-blocking scans (#153)

## Goal

All acceptance criteria in issue-specs/issue-153.md are satisfied for issue
#153, with evidence visible in the session: the Search view reports totals
(files and matches) while results exist, shows a visually loud no-results
state when a query matches nothing, shows a scanning indicator that clears
when the scan settles, keeps the UI responsive during a folder-wide scan,
never lets a superseded query's late results paint over a newer query's, and
`npm run validate:quick` passes.

## Acceptance criteria

- (PRD 014 Req 9) While results exist, the Search view reports a total match
  count naming BOTH numbers — how many files and how many matches — in a
  single element with a stable `data-testid`. The numbers come from
  `SearchResults.fileCount` / `SearchResults.matchCount` in
  `src/lib/searchCore.ts` (which already carries them, cited `Req 7 + Req 9`);
  no component re-counts, re-sums or re-searches. The wording is grammatical
  at 1 (`1 file`, `1 match` — not `1 files`), and the totals are absent when
  there is nothing to total (empty query, or the no-results state below).
- (PRD 014 Req 9) A query that matches nothing shows a visually loud
  no-results state in the result area — a styled block with its own stable
  `data-testid` and a message naming the query, not a silently empty list,
  and not the same quiet treatment as the `search-no-roots` line. It appears
  exactly when the debounced query is non-empty, compiles, the scan has
  settled and zero files matched; it does NOT appear while a scan is in
  flight, while the query is empty, or when the query is an invalid regex
  (that state is owned by the existing inline `search-error` from #152, and
  the two never show at once).
- (PRD 014 Req 9) A scan in flight shows a scanning indicator with a stable
  `data-testid`, and it clears when the scan settles — on results painted, on
  a no-results outcome, on the query going empty, on an invalid regex, on the
  scan being superseded by a newer one (the newer scan owns the indicator),
  and on the view being closed. No path leaves a stuck indicator: an
  unreadable tree, a failed read, or an abandoned scan all clear it.
- (PRD 014 Req 9) Searching never blocks the UI: with a large folder tree
  (a seeded tree of at least ~200 markdown files — the largest the sidebar's
  seams realistically hand back), typing in the query box keeps landing
  character by character, the sidebar and editor stay interactive, and
  editing the open document still works while the scanning indicator is up.
  The scan enumerates and matches in bounded chunks that yield to the event
  loop between them rather than walking and matching every file in one
  synchronous burst; the chunking lives in `src/lib/searchScan.ts` (or a
  sibling `src/lib/` module) as a pure, unit-testable function over injected
  seams, not as ad-hoc `setTimeout`s in `src/App.tsx`.
- (PRD 014 Req 9) A superseded query's late results never overwrite a newer
  query's: an in-flight scan is abandoned (or its results discarded) when the
  query text OR any of the three option toggles changes, the abandonment is
  checked between chunks — so a superseded scan stops issuing further
  `readDirEntries` / `readTextFile` calls rather than merely dropping its
  result at the end — and what the panel displays (results, totals, empty
  state) always corresponds to one completed scan of the CURRENT query and
  options. Stale results are never labelled with the new query's totals:
  when the query or options change, the previous result set is either cleared
  or left on screen only alongside the scanning indicator.
- The supersession/abandonment logic is a pure function or small state
  machine in `src/lib/` (e.g. the scan runner taking an `isCurrent()`
  predicate or an `AbortSignal`, plus a derivation of the panel's state —
  scanning / results / no-results / error / idle), unit-tested under
  `tests/unit/` (extending `tests/unit/search-scan.test.ts` or a new sibling)
  for: results discarded when superseded mid-scan, no further seam calls
  after supersession, the indicator's clear-on-every-outcome behaviour, and
  the totals/no-results derivation. `src/App.tsx` wires it; it does not
  reimplement it, and the existing `searchEpochRef` guard is either replaced
  by or subsumed into this tested piece rather than duplicated.
- `src/components/SearchPanel.tsx` stays a pure view — new props in
  (scanning flag, totals or the settled result set), no matching, counting or
  scheduling of its own — and the new surfaces are styled in `src/styles.css`
  beside the existing `.search-*` rules (around line 2751), readable in both
  light and dark themes.
- New e2e coverage in `tests/e2e/search.spec.ts` with new `E<n>` numbers above
  the current highest (`E286`), using `seedFolders` / `openFolderRoot` from
  `tests/e2e/helpers.ts`, exercises: the match totals over a multi-file scan
  (both numbers, updating when the query narrows), the loud no-results state
  appearing for a query that matches nothing and clearing when the query
  matches again, the scanning indicator appearing during a scan and clearing
  when it settles, and responsiveness under a large seeded tree (typing keeps
  registering while a scan is in flight). Responsiveness is asserted through
  observable interaction — input value keeps updating, a click/keystroke still
  takes effect — not through wall-clock timing thresholds, so the test is not
  flaky on a loaded machine.
- New and changed code carries citation comments in the repo's format
  (`PRD 014 Req 9: …`, as `src/lib/searchCore.ts` and
  `src/components/SearchPanel.tsx` already do for their requirements), per
  `.sandcastle/CODING_STANDARDS.md` and `docs/COMMENT-FORMAT.md`. If any
  `SPEC<n>` citation is added or moved, `docs/MAP.md` is regenerated with
  `npm run map` and committed.
- Out of scope, left to their own issues: the in-file find bar's toggles,
  counter and no-match state (#154). Nothing here changes the find bar.
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (or tests targeted at the changed code, e.g.
  `npx playwright test -g '<title>'`) and ran the full quick gate
  `npm run validate:quick` ONCE at the end — not after every change and not
  as a starting baseline — and it printed `QUICK VALIDATION: ALL PASSED` in
  the implementer's session.
- A summary comment from the implementer exists on issue #153 describing what
  landed and the gate evidence.

## Context

- Everything this issue reports on already exists upstream: `SearchResults`
  in `src/lib/searchCore.ts` carries `fileCount` and `matchCount` (added for
  this requirement); `src/lib/searchScan.ts` holds `collectMarkdownFiles` /
  `loadSearchFiles` over injected seams; `src/components/SearchPanel.tsx`
  (270 lines) renders the query row, the `#152` toggles, the inline
  `search-error`, the `search-no-roots` line and the file groups.
- The wiring is the search block in `src/App.tsx` — grep `PRD 014` into it,
  never read it whole. Around line 6091: `searchOpen`, `searchQuery` /
  `searchDebounced` (200ms debounce), `searchOptions`, `searchCompiled` /
  `searchError` from `compileQuery`, `searchResults`, `searchCollapsed`, and
  the `searchEpochRef` guard inside the scan effect (~line 6155) that today
  checks the epoch twice: after `collectMarkdownFiles` and before
  `setSearchResults(searchFiles(...))`. That single end-of-scan burst is what
  the chunking criterion replaces. The `<SearchPanel …>` render is ~line 6520.
- The repo has no existing yield/chunk idiom to copy — the nearest scheduling
  precedent is the debounce `setTimeout` pairs. Whatever shape is chosen
  (async generator, chunked loop with a `setTimeout(…, 0)` / `MessageChannel`
  yield), keep the seam-driven purity `searchScan.ts` already has so the unit
  tests can drive it with fake seams and count calls.
- Existing e2e numbering: search tests run E272–E286 in
  `tests/e2e/search.spec.ts`; start at E287. `fsWrite` in
  `tests/e2e/helpers.ts` is how a bigger tree gets seeded (loop it) — the
  e2e suite is slow and machine-serialized, so debug single tests with
  `npx playwright test -g '<title>'`.
- Sibling specs worth skimming for the house style of this feature:
  `issue-specs/issue-151.md` (the Search view) and `issue-specs/issue-152.md`
  (the toggles).
