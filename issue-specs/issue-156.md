# Spec: bug with tabs (#156)

## Goal

All acceptance criteria in issue-specs/issue-156.md are satisfied for issue
#156, with evidence visible in the session: switching file tabs (including
Ctrl+Tab cycling past the last tab) no longer throws "Ranges must be added
sorted by `from` position and `startSide`", the cause is fixed at the
decoration source with regression coverage that fails without the fix, the
file tab strip's cast shadow is visibly softer and subtler while the three
planes still read as stacked, `npm run validate:quick` passes in the
implementer's session, and a summary comment from the implementer exists on
issue #156.

## Acceptance criteria

- Switching the active file — a sidebar row, a tab click, and Ctrl+Tab /
  Ctrl+Shift+Tab cycling that wraps past the last tab (SPEC36 §6.3, App.tsx
  ~line 2339) — leaves the newly activated document rendered in the editor
  with no thrown error: no "Ranges must be added sorted by `from` position
  and `startSide`", no fall-through to the error boundary, no console error.
  This holds for documents that contain **two or more Markdown tables** with
  the SPEC40 grid view on (`tableGridView` defaults to true).
- The fix is at the source, not a try/catch around the symptom. The known
  reproduction path: `src/components/Editor.tsx` (the `[value]` effect, ~line
  1538, and the mount-time convergence, ~line 1270) swaps documents with one
  whole-document replace `{ from: 0, to: current.length, insert: value }`;
  `tableModeField` in `src/components/tableMode.ts` then maps every stale
  grid span through that change, where `mapPos(from, -1)` / `mapPos(to, 1)`
  collapse *every* span onto the same `{0, newLength}` range, and
  `tableModeDecos` walks each span's lines in turn — the second span restarts
  at line 1, so `RangeSetBuilder.add` gets a `from` that moved backwards and
  throws. Confirm this is the failing path before fixing (a failing test is
  the confirmation); if the real cause turns out to be a different builder,
  fix that one and say so in the summary comment.
- No decoration assembly in the editor can be handed out-of-order ranges
  after a whole-document replace. The other range-assembly sites are audited
  and each is provably sorted or made sorted: the `RangeSetBuilder` uses in
  `src/components/Editor.tsx` (`codeSelectionDeco`, `mountedCodeDeco`,
  `diffDecorations`), `tableModeDecos` in `src/components/tableMode.ts`, and
  the unsorted `Decoration.set(ranges)` in `src/components/imageView.ts`
  (~line 125, `RangeSet.of` with `sort = false` routes into the same throw).
- A unit test in `tests/unit/` (vitest, node environment; `tests/unit/dirty.test.ts`
  and `tests/unit/live-preview.test.ts` show the pattern of importing
  `src/components/*` and building an `EditorState` headlessly) reproduces the
  bug: a state carrying two or more grid spans, a full-document replace
  transaction, and the decorations computed from the resulting state without
  throwing. The test fails on the pre-fix code and passes after.
- An e2e test in `tests/e2e/file-tabs.spec.ts`, numbered with the next free
  E-number (E306 is currently the highest in `tests/e2e/`), opens two
  documents that each contain multiple tables, cycles the tabs with Ctrl+Tab
  through a wrap, and asserts the document switched and that no page error
  was raised.
- The shadow the top tabs cast is softer and subtler than today's: `.file-tab`
  (`0 -1px 3px rgba(0,0,0,0.14), 0 -2px 7px rgba(0,0,0,0.09)`) and
  `.file-tab.active` (`0 -2px 6px rgba(0,0,0,0.18), 0 -5px 16px rgba(0,0,0,0.14)`)
  in `src/styles.css` end up with lower alpha and/or wider, more diffuse blur
  so the lift reads as a soft ambient cast rather than a hard dark edge. The
  active tab still reads as lifted above its neighbors, both planes still
  compute a non-`none` box-shadow, and E305 / E306 (the three-planes and dark
  theme assertions) still pass. The sidebar seam (`.folder-panel::after`) is
  left as it is; if `.file-tab-strip::after`'s seam cast is softened too, its
  `--mm-panel-shadow` themeable override keeps working.
- Behaviour that changed carries a citation comment naming its contract
  (`// SPEC40 §…`, `// PRD 013 Req …`, `// Issue #156: …`) per
  `.sandcastle/CODING_STANDARDS.md` and `docs/COMMENT-FORMAT.md`, and
  `docs/MAP.md` is regenerated with `npm run map` if the spec→file mapping
  moved.
- Iteration used `npm run typecheck` and `npm run test:unit` (or a single
  targeted `npx playwright test -g '<title>'`) — not the full suite after
  every change, and no full-suite baseline at the start.
- `npm run validate:quick` has been run ONCE, at the end, in the
  implementer's session and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #156 describing the
  root cause, the fix, the shadow change, and the verification evidence.

## Context

Two things in one issue: a crash on tab switch and a visual complaint about
the tab strip's shadow.

The crash message comes from `RangeSetBuilder.add` in `@codemirror/state` —
it is thrown whenever ranges arrive with a `from` earlier than the previous
one (`Decoration.set(ranges)` without `sort` funnels into the same check).
Grep `SPEC40` and `SPEC36` for the grid-view and open-file-set code;
`docs/MAP.md` maps both to their files. The doc-swap path is
`src/components/Editor.tsx`'s `[value]` effect; the grid spans it invalidates
live in `src/components/tableMode.ts` (`tableModeField`, `tableModeDecos`).
Whatever the fix — dropping spans that collapse or coincide on a whole-doc
replace, deduping lines before the builder, or re-scanning after the swap —
keep SPEC40's promise that an untouched grid collapses back to its original
source bytes, and keep the "same document in display dress" convergence
guards in `Editor.tsx` intact (they exist so a grid swap doesn't poison undo).

The shadows are pure CSS in `src/styles.css`: `.file-tab` (~2363),
`.file-tab.active` (~2403), and the strip seam overlay `.file-tab-strip::after`
(~2290), which mirrors `.folder-panel::after` (~2541) and shares the optional
`--mm-panel-shadow` theme key. `tests/e2e/file-tabs.spec.ts` (~1177) asserts
only that both planes have *a* shadow and that the active tab stacks above
its neighbors, so softening the values is safe as long as neither becomes
`none`. Judge the result in both a light and a dark theme.
