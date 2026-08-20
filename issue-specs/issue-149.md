# Spec: Tabs on top: e2e coverage sweep and full quick gate (#149)

## Goal

All acceptance criteria in issue-specs/issue-149.md are satisfied for issue
#149, with evidence visible in the session: every behaviour PRD 013 Req 16
enumerates is covered by a named E-numbered test in
`tests/e2e/file-tabs.spec.ts` (gaps filled, nothing duplicated), the
implementer's summary comment carries the behaviour→test audit table,
`docs/MAP.md` matches what `npm run map` generates from the current tree,
`npm run validate:quick` has been run ONCE at the end and passes with
`QUICK VALIDATION: ALL PASSED`, and that summary comment exists on issue #149.

## Acceptance criteria

- An audit exists (in the implementer's summary comment on #149) mapping each
  of the nine behaviours PRD 013 Req 16 enumerates — strip presence/absence
  (splash, single file, toggle off), tab activation, ellipsis + tooltip,
  dirty ●/✕ swap, middle-click close, context-menu Close Others with a dirty
  file (Cancel stops the sequence), overflow arrows, and the untitled
  ephemeral tab — to the E-number(s) that assert it. Each row names either an
  existing test (E266–E306) or a test added by this issue.
- The audit also walks PRD 013 Reqs 1–15 for behaviours the sub-issues left
  unasserted, and every gap it finds is either closed by a new test or
  recorded in the comment with a one-line reason it needs none (e.g. covered
  by a sibling suite, or a declared non-goal). Known thin spots to check
  explicitly, each closed or justified:
  - Req 14 desktop-only: nothing today asserts the strip and the View ▸ File
    Tabs item are absent/inert in the **web** build (`tests/e2e/web.spec.ts`,
    W-numbered) — the PRD's "web build unchanged" non-goal deserves a guard.
  - Req 9 "activating a file by any means" reveals its tab: E302 covers the
    sidebar row and Ctrl+Tab; a click on a *partly clipped* tab is not
    asserted.
  - Req 3 tree order and Req 15 pure-view behaviour beyond rename/delete
    (E271): the sidebar's only-open-files mode and an external file-watch
    change reaching the strip.
- Any new e2e test lives in the suite that owns its area
  (`tests/e2e/file-tabs.spec.ts` for the strip, `tests/e2e/web.spec.ts` for a
  web guard), takes the next free E/W numbers (E307+ — E306 is the current
  maximum), and carries the repo's citation comment naming what it covers
  (`PRD 013 Req <n> (issue #149)` / `SPEC36 §x.y`, per `docs/COMMENT-FORMAT.md`
  and `.sandcastle/CODING_STANDARDS.md`).
- No new test duplicates an existing assertion. Where a behaviour is already
  covered, the audit cites the existing test instead of adding one — e2e
  runtime is the gate's dominant cost, so the sweep adds only what closes a
  real gap, and prefers extending an existing test's fixture over standing up
  a new app boot when the behaviour is a few lines.
- New tests reuse the suite's existing helpers (`freshApp`, `openNotesRoot`,
  `seedFolders`, `dirtyActiveDoc`, `fsRead`/`fsWrite`, the file-local
  `tabPaths` / `openFileTabsRow` / `openOverflow` / `railScroll` / `tabInView`
  helpers) rather than re-implementing setup.
- This issue is a coverage sweep, not a feature change: `src/` behaviour is
  untouched unless a new test surfaces a genuine PRD 013 defect. If it does,
  the fix is the minimal cited change, and the summary comment calls out both
  the defect and the fix.
- The full existing suite passes unchanged — `tests/e2e/file-tabs.spec.ts`
  (E266–E306), `tests/e2e/folder-tree.spec.ts`, `tests/e2e/shell-and-menus.spec.ts`,
  `tests/e2e/tabs-and-workspace.spec.ts` and the web suite included. No test is
  skipped, `.only`'d, or weakened to make the gate green.
- `docs/MAP.md` has been regenerated with `npm run map` (never hand-edited) and
  committed, so its spec→code/e2e rows list the strip's current test numbers
  and the gate's map diff is clean. `tests/unit/map.test.ts` still passes.
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  plus targeted `npx playwright test -g '<title>'` runs for the tests it
  touched, and ran the full gate `npm run validate:quick` ONCE, right before
  declaring the goal met — not after every change, and not as a baseline at
  the start of the attempt (any baseline uses the quick tier only:
  typecheck + unit). The run's `QUICK VALIDATION: ALL PASSED` line is visible
  in the session.
- A summary comment from the implementer exists on issue #149, carrying the
  audit table, the tests added (with E/W numbers and what each closes), any
  defect found and fixed, and the `npm run validate:quick` evidence.

## Context

- **PRD:** `prd/013-tabs-on-top.md` — Req 16 is this issue's checklist; Reqs
  1–15 are what the merged sub-issues #144 (strip foundation), #145 (close
  affordances), #146 (untitled tab), #147 (overflow rail) and #148 (plane
  treatment) shipped. Parent issue #139. All blockers are closed and merged
  into this branch, so the strip is feature-complete — what remains is proof.
- **Current coverage:** `tests/e2e/file-tabs.spec.ts` holds E266–E306 (its
  header comment already indexes which issue contributed which range).
  `tests/e2e/folder-tree.spec.ts` covers the sidebar side of the same SPEC36
  model; `tests/unit/file-tabs.test.ts` covers the tab context menu spec and
  the Req 9 rail overflow math. `src/components/FileTabStrip.tsx` (396 lines)
  and `src/lib/fileTabs.ts` (122 lines) are the strip's code; grep `SPEC36`
  and `PRD 013` to land in the right place — never read `src/App.tsx` whole.
- **Starting state (verified 2026-08-20 on this branch):** `npm run typecheck`
  and `npm run test:unit` pass, and `npm run map` produces no diff against the
  committed `docs/MAP.md`. So any map churn or type/unit failure comes from
  this issue's own edits.
- **Gotchas:** E-numbers are unique per behaviour, and a few numbers already
  repeat across suites historically — pick E307+ to stay unambiguous. The
  strip is desktop-only, so strip tests belong in the desktop-shim suites; the
  web suite uses W numbers. `npm run test:e2e` is serialized machine-wide and
  takes minutes — debug with `npx playwright test -g '<title>'` and save the
  full run for the single closing `npm run validate:quick`.
