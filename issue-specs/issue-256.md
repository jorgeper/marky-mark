# Spec: Drop the toolbar show/hide-comments button — the View menu entry is enough (#256)

## Goal

All acceptance criteria in issue-specs/issue-256.md are satisfied for issue
#256, with evidence visible in the session: the `comments-toggle` button no
longer exists anywhere in `src/` (its now-dead Toolbar props and
`CommentsIcon` gone with it), the View ▸ Comments row, its `toggleComments`
hotkey, the edge chevron and every other comment behaviour still work
unchanged, the tests and spec docs that asserted the removed button have been
amended to exercise the menu/hotkey instead, `npm run validate:quick` passes
in the implementer's session, and a summary comment from the implementer
exists on issue #256.

## Acceptance criteria

- The toolbar's show/hide-comments button is gone: `src/components/Toolbar.tsx`
  renders no `data-testid="comments-toggle"` element, and
  `grep -rn 'comments-toggle' src` returns nothing.
- The props that existed only to feed that button — `showComments`,
  `commentsEnabled`, `commentCount`, `onToggleComments` — are removed from
  `Toolbar`'s `Props` interface and from the `<Toolbar …>` call site in
  `src/App.tsx` (around line 7554). The same settings/state remain in use
  everywhere else in `App.tsx`; only the Toolbar wiring goes.
- The now-unreferenced `CommentsIcon` helper (and its `comments-icon` testid)
  is removed from `Toolbar.tsx`; `grep -rn 'comments-icon' src` returns
  nothing. No other icon helper is touched.
- Nothing else about comments changes: the View ▸ Comments row built by
  `src/lib/menuSpec.ts` `buildViewItems` (label `Comments (n)`, checked state,
  hidden when `commentsEnabled` is false), the `toggleComments` command and
  hotkey (still listed in Settings → Hotkeys), the edge-cluster
  `CommentsToggleButton` chevron (`comments-expand` / `comments-collapse`,
  `src/components/FolderPanel.tsx`), the comments pane, the master switch
  (SPEC7 §2) and all authoring behaviour are unchanged. The unit suites
  `tests/unit/menu-spec.test.ts` and `tests/unit/app-menu.test.ts` still pass
  without edits to their `toggleComments` expectations.
- Every test that referenced the removed button has been amended so it proves
  the same behaviour through a surviving surface (View menu row, hotkey, or
  the edge chevron), not deleted wholesale:
  - `tests/e2e/comments.spec.ts` E36 (lines ~364, ~373, ~393): the master
    switch's "every comment affordance is hidden / restored" assertions no
    longer key on `comments-toggle`.
  - `tests/e2e/comments.spec.ts` E151 (lines ~912, ~919): the pane-open/closed
    state is asserted without the toolbar button's `on` class.
  - `tests/e2e/shell-and-menus.spec.ts` E17 (lines ~177-184): the icon test
    keeps its hamburger (`menu-icon`) assertions and drops the balloon half;
    its title is updated so it no longer promises an assertion it doesn't make.
  - After the sweep, `grep -rn 'comments-toggle\|comments-icon' tests` returns
    nothing.
- The spec documents that describe the removed button carry an amendment in
  this repo's existing style (`> **Amendment (issue #256, 2026-09-06):** …`),
  rather than being rewritten in place: `docs/specs/SPEC2.md` §4.1 (toolbar
  composition), `docs/specs/SPEC3.md` §1.3, §4.2, §4.3 and its E17 test line,
  `docs/specs/SPEC7.md` §2.2 and §2.4 (the master switch hides the View row
  and the chevron, not a toolbar toggle), and `docs/specs/SPEC12.md`'s
  header-contents sentence. Each amendment says the toolbar button is gone and
  the View-menu entry plus its hotkey are the toggle's home.
- Remaining code comments stay truthful: the `v2 toolbar (SPEC2 FR-U.1)` JSDoc
  above `Toolbar` no longer lists a comments toggle among the toolbar's parts.
- Citation discipline per `.sandcastle/CODING_STANDARDS.md` holds for whatever
  code the change touches, and `docs/MAP.md` is regenerated with `npm run map`
  if the spec→file citation set changed (the validation gate diffs it).
- Both builds are unaffected in kind — this is a pure chrome removal shared by
  desktop (Tauri) and hosted (web); no platform-conditional code is introduced.
- Iteration used `npm run typecheck` and `npm run test:unit` (plus targeted
  runs such as `npx playwright test -g 'E36'`), and `npm run validate:quick`
  was run ONCE at the end — not as a per-change loop and not as a starting
  baseline beyond the quick tier. It printed `QUICK VALIDATION: ALL PASSED` in
  the implementer's session.
- A summary comment from the implementer exists on issue #256 describing what
  was removed, which tests and spec sections were amended, and the
  `validate:quick` result.

## Context

The button lives at the end of `src/components/Toolbar.tsx` (~lines 276-286),
gated on `p.commentsEnabled`, with the `CommentsIcon` helper at ~line 97 and
its four props declared at ~lines 24-45. Its only call site is the `<Toolbar>`
element in `src/App.tsx` (~7554-7578), which dispatches
`dispatchCommand('toggleComments')` — the exact command the View row, the
hotkey and the edge chevron already dispatch, so no dispatch path is lost.

The View ▸ Comments row is derived by `buildViewItems` in
`src/lib/menuSpec.ts` (~line 234) and rendered into the in-app menu via
`src/lib/appMenu.ts`; it is already hidden when `commentsEnabled` is false, so
the master switch's contract survives without the toolbar button. The
edge-cluster chevron (`CommentsToggleButton`, exported from
`src/components/FolderPanel.tsx`, mounted at `src/App.tsx:7530`) is a separate
control added by PRD 023 §14 and stays.

There is no CSS keyed on `comments-toggle`, so `src/styles.css` needs no edit.
Related issue #243 separately hides this control on the home page; if this
lands first, the comments half of #243 becomes moot — do not try to implement
#243 here.
