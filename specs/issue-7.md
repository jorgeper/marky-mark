# Spec: bug: folder (#7)

## Goal

All acceptance criteria in specs/issue-7.md are satisfied for issue #7, with evidence visible in the session: the folder pane no longer shows a blank region while the preview pane is open, a regression test covering the fix exists and passes, `npm run validate:quick` passes in the implementer's session, and a summary comment from the implementer exists on issue #7.

## Acceptance criteria

- The bug from the issue body is reproduced and its root cause identified: with the app in workspace mode, the folder pane open, and the preview pane open (the issue's screenshot shows the folder pane containing a blank/empty region under this condition — check both full preview mode and the edit-mode split preview to find which one triggers it), the folder pane shows a blank space instead of its content filling the pane.
- After the fix, the folder pane renders correctly while the preview pane is open: the folder tree and pane chrome fill the pane with no blank region, matching how the pane renders when the preview pane is closed.
- A regression test exists that fails without the fix and passes with it — a Playwright e2e test in `tests/e2e/` (where the existing folder-pane coverage lives) if the bug is layout/interaction-level, or a unit test if the cause is component logic.
- Existing folder-pane and preview-pane behaviors are unchanged: the PRD 003 slide animations, edge chevrons, folder width drag, and split divider tests all still pass.
- The implementer iterated with `npm run typecheck` and `npm run test:unit` (or Playwright runs targeted at the changed specs, e.g. `npx playwright test tests/e2e/app.spec.ts -g "<test name>"`), and ran the full gate `npm run validate:quick` exactly ONCE, right before declaring the goal met — not after every small change and not as a baseline at the start. That final `npm run validate:quick` run passes.
- A summary comment from the implementer exists on issue #7 describing what was changed and the verification evidence.

## Context

Issue #7's body is brief: "when the preview pane is open the folder pane shows a blank space" plus a screenshot (~251×281 crop of the folder pane) that is not downloadable from the sandbox — the implementer must reproduce visually (e.g. via the web build / Playwright screenshots) to see the blank region. The folder pane is `src/components/FolderPanel.tsx`, rendered inside `.body-row` in `src/App.tsx` (~line 4000) under a `.folder-slide` width wrapper; the split preview lives in the `.workspace.split` block of `src/App.tsx` (~line 4117). Relevant CSS: `.folder-slide`, `.folder-panel`, and the `.workspace.split` rules in `src/styles.css` (~lines 751–880 and 1722–1780). Note `FolderPanel.tsx` sets `--mm-folders` on the slide wrapper from a resize observer (~line 405), and the slide phases come from `src/lib/paneSlide.ts` (PRD 003 Reqs 9–12) — a stale slide phase, width var, or transform is a plausible cause, but do not assume; diagnose from the live DOM. There is no plain `npm run test` script; the repo's commands are `typecheck`, `test:unit`, `test:e2e`, `test:e2e:web`, and `validate:quick`. A prior lane incorrectly verified a stale spec against this issue (see issue comments); this spec supersedes that — the split-seam work is already merged and is not this bug.
