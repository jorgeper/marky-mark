# Spec: comment borders (#20)

## Goal

All acceptance criteria in specs/issue-20.md are satisfied for issue #20, with evidence visible in the session: every box in the comments panel (comment cards, the composer, the resolved section) keeps a clearly visible gap of at least 16px between its right edge and the right border of the window in both full preview and split-edit modes, a Playwright e2e test asserts that gap by measured geometry and passes, and `npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- Every comment-panel box surface — comment cards (`.panel > [data-flowcard]`), the composer card (`data-testid="composer"`), and the resolved section (`data-flowcard="__resolved"`, both collapsed and expanded) — renders with its right edge at least 16px (target ~24px) from the right edge of the window/viewport, never flush against it.
- The gap holds in both hosts where the panel renders: full preview mode and split-edit mode (`data-testid="split-preview"`), and across panel states reachable in the app (idle cards, active card, composer open).
- The gap is not merely present in the stylesheet: issue #20 was filed minutes after the #19 gap fix (`right: 24px` at src/styles.css:466) merged, so the implementer verified the actual rendered geometry (e2e boundingBox measurements, and/or the running app) and fixed whatever surface or state still renders flush if one exists; if the rendered gap already satisfies the threshold everywhere, the change is the regression test plus any gap-size adjustment needed to make it clearly visible.
- At least one new or extended Playwright e2e test in tests/e2e/app.spec.ts asserts via `boundingBox()` that a comment card's right edge is ≥16px from the viewport's right edge (in preview mode at minimum), and that test passes.
- No regression to the card-flow layout: cards still absolutely position with animated tops (the layout effect at src/App.tsx:3424 sets only `top`), and existing comment e2e tests still pass.
- The implementer iterated with `npm run typecheck` and `npm run test:unit` (plus targeted `npm run test:e2e` runs where useful), and ran the full quick gate `npm run validate:quick` ONCE, right before declaring the goal met — not after every small change and not as a starting baseline; that final run passed in the implementer's session.
- A summary comment from the implementer exists on issue #20.

## Context

The comments panel is `aside.panel` (src/App.tsx:3662); cards, the composer, and the resolved section all carry `data-flowcard` and are absolutely positioned by CSS (`.panel` and `.panel > [data-flowcard]`, src/styles.css:458–472) with tops animated by the layout effect at src/App.tsx:3424 (it sets only `top`, so left/right come from CSS). Issue #19 already added `right: 24px` for the same complaint, and this issue was filed ~12 minutes after that merge — so the first job is diagnosis: measure the rendered gap rather than trusting the CSS, and check surfaces/states the #19 fix may have missed. The panel renders in two hosts: the full-preview workspace and the split-edit pane (`.split-preview`, src/styles.css:822). E2E precedent: comment tests and `boundingBox()` assertions throughout tests/e2e/app.spec.ts (e.g. card stacking around line 865, split geometry around line 1077); the harness is tests/e2e/helpers.ts.
