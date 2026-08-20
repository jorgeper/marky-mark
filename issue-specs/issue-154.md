# Spec: In-file find bar: same three options and an unmissable hit state (#127) (#154)

## Goal

All acceptance criteria in issue-specs/issue-154.md are satisfied for issue
#154, with evidence visible in the session: the `Mod+F` find bar mounts the
same `SearchOptionsBar` control as the Search view and matches through
`compileQuery` in both preview and edit mode (invalid regex → inline error,
nothing matched, no throw, no literal fallback), its hit state is unmissable
(current/total counter that tracks stepping, high-contrast highlighting of all
matches with the current one distinct in light and dark themes, and a loud
no-match state on the bar itself), no replace UI is added, and
`npm run validate:quick` passes.

## Acceptance criteria

- (PRD 014 Req 10) `src/components/FindBar.tsx` renders the three toggles —
  case-sensitive, whole-word, regular expression — by mounting the existing
  `SearchOptionsBar` control from `src/components/SearchPanel.tsx` (#152), with
  its `search-opt-case` / `search-opt-word` / `search-opt-regex` test ids and
  `aria-pressed` state intact. No second toggle implementation, no parallel
  option shape: the state is a `SearchOptions` from `src/lib/searchCore.ts`,
  flipped with `toggleSearchOption` and defaulted with `DEFAULT_SEARCH_OPTIONS`
  from `src/lib/searchOptions.ts`. If mounting the control in the find bar
  needs it to shed a sidebar assumption, the control is adjusted in place
  rather than copied.
- (PRD 014 Req 10) With all three toggles off the find bar behaves exactly as
  today — literal, case-insensitive, live and debounced — so the existing find
  e2e tests (E89 in `tests/e2e/editor.spec.ts` and the find assertions in
  `split-view.spec.ts` / `web.spec.ts` / `live-preview.spec.ts`) keep passing
  with their assertions unchanged.
- (PRD 014 Req 10) Each toggle changes what the find bar matches, and the
  toggles combine: case-sensitive makes `Cat` stop matching `cat`, whole-word
  makes `cat` stop matching `concatenate`, regex makes `c.t` match `cat` where
  literal mode does not, and e.g. case-sensitive regex applies as the
  conjunction of both. Flipping a toggle re-runs the current query in place —
  no re-typing, no re-open, the caret stays in the query box — and the count,
  the highlights and the current match all repaint.
- (PRD 014 Req 10) The semantics are identical to the Search view's because
  both surfaces compile through `compileQuery` in `src/lib/searchCore.ts`. The
  preview engine (`applyFindMarks` in `src/App.tsx`, SPEC30 §1.3) finds its
  matches with the compiled matcher instead of the current
  `toLowerCase()`/`indexOf` scan, and the edit engine's CodeMirror query
  (`EditorSearchHandle.setQuery` in `src/components/Editor.tsx`, which today
  hardcodes `caseSensitive: false, literal: true`) is derived from the same
  option state such that a divergence is a unit-test failure, not a review
  catch — either by building the CM `SearchQuery` from a regex source exported
  by `searchCore.ts` alongside `compileQuery`, or by passing the option flags
  through and unit-testing CM-mode parity against `compileQuery` over a table
  of query/option cases (both modes agree on case, whole-word, regex, and
  their combinations). No regex building, escaping, flag assembly, word-
  boundary wrapping or `try/catch` around `new RegExp` is added in `App.tsx`,
  `FindBar.tsx` or `Editor.tsx`.
- (PRD 014 Req 10) With regex on and the pattern invalid (e.g. `[`, `(`,
  `a{2,1}`), the find bar shows an inline error carrying `compileQuery`'s own
  `{ kind: 'invalid-regex', message }` text under a stable `data-testid`, and
  nothing is matched: zero highlights, a zero count, next/prev inert, no
  exception in the console or an error boundary, and the query is never quietly
  re-run as a literal. This holds in preview and in edit mode alike — the
  invalid pattern never reaches CodeMirror. Correcting the pattern (or turning
  regex off) clears the error and matches return live, with no re-open or
  re-type.
- (PRD 014 Req 11) The bar shows a current/total match counter that tracks
  stepping: the existing `find-count` reads `N of M` and advances/wraps on
  Enter, Shift+Enter and the prev/next buttons, in both preview and edit mode
  and under every toggle combination.
- (PRD 014 Req 11) Every match in the document is highlighted with
  high-contrast highlighting and the current match is visually distinct from
  the rest, in a light and a dark bundled theme alike and in both modes: the
  preview `mark.mm-find` / `mm-find-active` treatment sets its own foreground
  as well as its background so legibility does not depend on the theme's text
  colour, and edit mode's CodeMirror match decorations
  (`.cm-searchMatch` / `.cm-searchMatch-selected`) get the matching treatment
  rather than CodeMirror's defaults. An e2e test asserts the distinction with
  computed styles under both a light and a dark theme (the
  `settings-theme-light` / `settings-theme-dark` selects the settings e2e tests
  already drive).
- (PRD 014 Req 11) A query that matches nothing puts an unmistakable state on
  the bar itself — not just the muted "No matches" text it shows today: a
  loud, asserted signal on the bar or its input (e.g. a `data-state` /
  no-match class driving an accent-coloured input and message), reachable by a
  stable selector, that clears the moment the query matches again.
- No replace UI is added (PRD 014 non-goal). Edit mode's existing SPEC30 §1.4
  replace row stays exactly as it is; its behaviour under the new toggles is a
  deliberate, tested choice (working, or plainly disabled) that neither throws
  nor silently corrupts the buffer.
- Marks, counts and options never leak across documents or closes: closing the
  bar clears the highlights and leaves the document text byte-identical (E89's
  invariant), and switching documents still closes the bar (SPEC30 §1.5).
- `docs/specs/SPEC30.md` no longer reads as contradicting this change: its §1
  out-of-scope line ("regex/whole-word/case-sensitive find options") and §1.2's
  "Matching is **literal and case-insensitive**" carry a short amendment note
  in the file's existing idiom (see the `**Amendment (issue #53, …)**` block in
  §2) naming PRD 014 Req 10–11 and issue #154. No other spec history is
  rewritten.
- Unit tests under `tests/unit/` (new `U<n>` numbers above the current highest,
  `U705`) cover the shared option/matching behaviour this issue adds — in
  particular the find-bar/Search-view parity assertion described above, and any
  new `searchCore.ts` export — extending `tests/unit/search-core.test.ts` /
  `search-options.test.ts` where they are the natural home.
- New e2e coverage with new `E<n>` numbers above the current highest (`E286`),
  in `tests/e2e/editor.spec.ts` next to E89 or a find-focused block of
  `tests/e2e/search.spec.ts`, exercises: each of the three toggles changing the
  find bar's matches (at least one of them in edit mode as well as preview), at
  least one two-toggle combination, a toggle flip re-running the query with no
  re-typing, the counter tracking next/prev, the invalid-regex state (error
  visible, zero matches) recovering when corrected, the loud no-match state,
  and the current-vs-other match distinction in a light and a dark theme.
- New and changed code carries citation comments in the repo's format
  (`PRD 014 Req 10: …` / `PRD 014 Req 11: …`, as `src/lib/searchCore.ts` and
  `src/components/SearchPanel.tsx` already do), per
  `.sandcastle/CODING_STANDARDS.md` and `docs/COMMENT-FORMAT.md`. If any
  `SPEC<n>` citation is added, moved or removed, `docs/MAP.md` is regenerated
  with `npm run map` and committed.
- The implementer iterated with `npm run typecheck` and `npm run test:unit` (or
  tests targeted at the changed code, e.g. `npx playwright test -g '<title>'`)
  and ran the full quick gate `npm run validate:quick` ONCE at the end — not
  after every change and not as a starting baseline — and it printed
  `QUICK VALIDATION: ALL PASSED` in the implementer's session.
- A summary comment from the implementer exists on issue #154 describing what
  landed and the gate evidence.

## Context

- `src/lib/searchCore.ts` (#150) owns every matching semantic:
  `SearchOptions`, `compileQuery(query, options)` returning
  `{ kind: 'matcher' } | { kind: 'invalid-regex', message }`, and `findMatches`
  (line-scoped, so no pattern spans a line break). `src/lib/searchOptions.ts`
  (#152) owns the option state: `DEFAULT_SEARCH_OPTIONS`, `toggleSearchOption`,
  `SEARCH_OPTION_TOGGLES`. `SearchOptionsBar` in
  `src/components/SearchPanel.tsx` is the reusable control #152 factored
  explicitly for this issue — options in, `onChange` out, state owned by the
  caller.
- The find-bar wiring is in `src/App.tsx`: state at ~line 492
  (`findQuery`/`findDebounced`/`findCount`/`findCurrent`), the preview engine
  `clearFindMarks`/`activateFindMatch`/`applyFindMarks` at ~line 902,
  `openFind`/`closeFind`/`stepFind` at ~line 947, `replaceFind` at ~line 1235,
  the debounce + per-mode effects at ~line 5508, and the `<FindBar …>` render
  at ~line 6390. Grep `SPEC30` / `PRD 014` into it — never read `App.tsx`
  whole. The Search view's equivalent wiring (`compileQuery` via `useMemo`, the
  epoch guard) is a working model to follow; grep `searchOptions` in `App.tsx`.
- `src/components/FindBar.tsx` (104 lines) is a pure view and stays one: props
  in, callbacks out, no matching logic. Existing test ids (`find-bar`,
  `find-input`, `find-count`, `find-prev`, `find-next`, `find-close`,
  `find-replace-*`) are load-bearing for current tests — add, don't rename.
- `EditorSearchHandle` is declared at `src/components/Editor.tsx:154` and built
  at ~line 1317; `setQuery` currently constructs
  `new SearchQuery({ search, caseSensitive: false, literal: true, replace })`.
  CodeMirror's own `SearchQuery` supports `caseSensitive` / `regexp` /
  `wholeWord`, but its word-boundary and regex rules are its own — parity with
  `compileQuery` is what the unit tests must pin, whichever route is taken.
- Styles: `.find-bar` and `mark.mm-find` / `mm-find-active` in
  `src/styles.css` around lines 2009–2068; the toggle styles `.search-options`
  / `.search-opt.on` / `.search-error` (#152) at ~line 2772. No theme in
  `themes/` defines `--mm-find` or `--mm-find-active` today — the fallbacks in
  `styles.css` are what actually renders, so contrast is won there rather than
  by editing 27 theme files.
- Tests: E89 in `tests/e2e/editor.spec.ts:353` is the existing find-bar test
  and the best template (count text, mark counts, wrap-around, lossless close,
  prefill); E280–E283 in `tests/e2e/search.spec.ts` are the Search view's
  toggle tests and show the assertions to mirror. The e2e suite is slow and
  machine-serialized — debug single tests with
  `npx playwright test -g '<title>'`.
