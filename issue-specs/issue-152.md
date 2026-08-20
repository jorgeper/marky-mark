# Spec: Search query options: case-sensitive, whole-word and regex toggles (#152)

## Goal

All acceptance criteria in issue-specs/issue-152.md are satisfied for issue
#152, with evidence visible in the session: the Search view's query box
carries case-sensitive, whole-word and regex toggles that combine and re-run
the current query live without re-typing, an invalid regex shows an inline
error and matches nothing (never throwing, never falling back to literal),
the toggles are a reusable control over `src/lib/searchCore.ts`'s
`compileQuery` with no matching logic of their own, and
`npm run validate:quick` passes.

## Acceptance criteria

- (PRD 014 Req 6) The Search view's query box has three toggle controls —
  **case-sensitive**, **whole-word** and **regular expression** — each with a
  stable `data-testid`, an accessible name/label, and a pressed state
  (`aria-pressed` plus a visual active state, in the `SidebarViewSwitch`
  mold in `src/components/TocPanel.tsx`) that reflects whether the option is
  on. With all three off the query is a case-insensitive literal substring —
  today's behaviour, unchanged.
- (PRD 014 Req 6) Each toggle changes what matches: case-sensitive makes
  `Cat` stop matching `cat`; whole-word makes `cat` stop matching
  `concatenate`; regex makes `c.t` match `cat` where literal mode would not.
- (PRD 014 Req 6) Toggle states combine — case-sensitive regex, whole-word
  case-sensitive, whole-word regex, and all three at once each behave as the
  conjunction of the individual options (the semantics `compileQuery` already
  implements).
- (PRD 014 Req 6) Flipping any toggle re-runs the current query against the
  same scope and repaints the results with no re-typing and no extra
  keystroke: the option state is an input to the scan, and the same
  superseded-scan (epoch) guard that protects a changing query protects a
  changing option, so a late result from the previous option state never
  overwrites the newer one.
- (PRD 014 Req 6) With regex on and the pattern invalid (e.g. `[`, `(`,
  `a{2,1}`), an inline error is shown on the query box — a visible message
  the e2e test can assert, with a stable `data-testid` — and the view shows
  no results for that query: nothing is matched, no exception escapes to the
  console or an error boundary, and the query is never quietly re-run as a
  literal. Any results from the previous valid query are cleared rather than
  left stale on screen.
- (PRD 014 Req 6) Correcting the pattern (or turning regex off) clears the
  error and results return on the same debounce path, with no reload,
  re-focus or re-type needed.
- All compilation of query text + option state into a matcher comes from
  `compileQuery` in `src/lib/searchCore.ts` (#150), and the invalid-regex
  message rendered is the one its `{ kind: 'invalid-regex', message }` result
  carries. The toggles set option state and render that error; no regex
  building, escaping, flag assembly, word-boundary wrapping or `try/catch`
  around `new RegExp` is added in `src/App.tsx` or in any component.
- The options UI is factored as a reusable control (e.g. a
  `SearchOptions`-style component in `src/components/`, or an exported piece
  of `src/components/SearchPanel.tsx`) taking a `SearchOptions` value and an
  `onChange`, with the option state owned by the caller — so the in-file find
  bar (#154) can mount the same control and the same semantics rather than
  writing a second implementation. `SearchOptions` from
  `src/lib/searchCore.ts` is the single option type; no parallel option shape
  is introduced.
- Out of scope, left to their own issues: the find bar actually mounting the
  control and its counter/no-match state (#154), and the match totals, loud
  no-results state and scanning indicator (#153). Whether the option state
  persists across sessions is not required by PRD 014 — if it is persisted it
  goes through `src/lib/settings.ts` with a validator like every other
  setting; if not, it simply resets, and either choice is acceptable so long
  as it is deliberate and tested.
- Unit tests under `tests/unit/` cover the option state added alongside the
  UI (toggle flipping, the default all-off state, and any option→scan input
  derivation), and extend `tests/unit/search-core.test.ts` only if a
  `compileQuery` behaviour this issue relies on is not already covered there.
- New e2e coverage in `tests/e2e/search.spec.ts` with new `E<n>` numbers
  above the current highest (`E279`) exercises: each toggle changing the
  result set on a multi-file scan, at least one combination of two toggles,
  a toggle flip re-running the query with no re-typing, and the
  invalid-regex state (error visible, no results) clearing when the pattern
  is corrected.
- New and changed code carries citation comments in the repo's format
  (`PRD 014 Req 6: …`, as `src/lib/searchCore.ts` and
  `src/components/SearchPanel.tsx` already do), per
  `.sandcastle/CODING_STANDARDS.md` and `docs/COMMENT-FORMAT.md`. If any
  `SPEC<n>` citation is added or moved, `docs/MAP.md` is regenerated with
  `npm run map` and committed.
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (or tests targeted at the changed code, e.g.
  `npx playwright test -g '<title>'`) and ran the full quick gate
  `npm run validate:quick` ONCE at the end — not after every change and not
  as a starting baseline — and it printed `QUICK VALIDATION: ALL PASSED` in
  the implementer's session.
- A summary comment from the implementer exists on issue #152 describing what
  landed and the gate evidence.

## Context

- `src/lib/searchCore.ts` (#150, merged) already implements everything about
  matching: `SearchOptions { caseSensitive, wholeWord, regex }`,
  `compileQuery(query, options)` returning
  `{ kind: 'matcher' } | { kind: 'invalid-regex', message }` (it escapes
  literals, wraps whole-word in `\b(?:…)\b`, applies the `i` flag, and
  validates the user's pattern before wrapping so the message names their
  input). This issue is UI + wiring only.
- The wiring lives in `src/App.tsx` around the search state block (grep
  `searchDebounced` / `PRD 014 Req 7`, ~line 6090): the debounce effect, the
  scan effect that today calls
  `compileQuery(searchDebounced, { caseSensitive: false, wholeWord: false, regex: false })`
  and bails on a non-matcher result, and the `<SearchPanel …>` render (~line
  6493). The scan effect's dependency list and its `searchEpochRef` guard are
  where "flipping a toggle re-runs the query" and "no stale paint" are won.
  Never read `App.tsx` whole — grep `PRD 014` into it.
- `src/components/SearchPanel.tsx` (208 lines) is a pure view: props in,
  callbacks out. The query box is the `.search-query-row` block; styles for
  the search rows are in `src/styles.css` around line 2751. The existing
  toggle-button idiom to copy (aria-pressed, `data-active`, title) is
  `SidebarViewSwitch` in `src/components/TocPanel.tsx`.
- #154 will mount this control in `src/components/FindBar.tsx`, which today
  has no options at all — keep the control free of sidebar-only assumptions
  (no folder width, slide phase or result-list coupling).
- E2e helpers `seedFolders` / `openFolderRoot` in `tests/e2e/helpers.ts` give
  the multi-file tree the existing E272–E276 search tests use; follow their
  shape. The e2e suite is slow and machine-serialized — debug single tests
  with `npx playwright test -g '<title>'`.
