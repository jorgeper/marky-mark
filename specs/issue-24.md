# Spec: comment render over text (#24)

## Goal

All acceptance criteria in specs/issue-24.md are satisfied for issue #24, with evidence visible in the session: the comments panel never renders on top of document text — it always sits to the right of the doc in flow, with the host pane growing a horizontal scrollbar when the doc floor plus panel don't fit — a Playwright e2e test asserts no doc/panel overlap and the scrollbar-based reachability by measured geometry and passes, and `npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- The comments panel (`aside.panel`, `data-testid="panel"`) never overlaps the rendered document text: in both hosts where it renders (full preview and split-edit's `data-testid="split-preview"`), at any pane width and any horizontal scroll position, the panel's bounding box does not intersect the `.doc` content's bounding box. The panel sits to the right of the doc in the flex row, never floating over it.
- When the pane's content (doc floor + 300px panel) is wider than the pane — the #20 repro: `paneMinWidth` 768 in split-edit at a 1280px window — the pane shows a horizontal scrollbar (`scrollWidth > clientWidth`) instead of pinning the panel over the doc; at scroll-left 0 the doc text is unobscured, and scrolling fully right brings the comment cards into view with the #19/#20 right-edge gap (≥16px from the window's right border) intact.
- The current sticky-pinning of `.panel` (src/styles.css:456–470, `position: sticky; right: 0` — whose own comment says "The doc scrolls beneath") no longer produces the overlay; whatever replaces it keeps the non-overflow behavior visually unchanged (panel beside the doc, cards keeping their right gap).
- E130 (tests/e2e/app.spec.ts:5286) is updated, not deleted: its overflowing-split-pane section — which currently asserts the gap holds *without* scrolling, i.e. asserts the sticky overlay — now asserts the new model (no overlap with the doc, scrollbar present, gap ≥16px after scrolling the pane fully right); its non-overflow assertions (full preview, fitting split pane, composer, resolved section) still hold and pass.
- A new or extended Playwright e2e test asserts by measured geometry (`boundingBox()` / `scrollWidth`) that in the overflowing split pane the comment card's box does not intersect the doc's box, and that test passes.
- No regression to the card-flow layout (the layout effect at src/App.tsx:3540 still animates only `top`) or to existing comment e2e tests.
- The implementer iterated with `npm run typecheck` and `npm run test:unit` (plus targeted `npm run test:e2e` runs for the touched tests), and ran the full quick gate `npm run validate:quick` exactly ONCE, right before declaring the goal met — not after every small change and not as a starting baseline; that final run passed in the implementer's session.
- A summary comment from the implementer exists on issue #24.

## Context

The panel renders in two hosts (App.tsx:3772-3775 builds one `aside.panel`, mounted in the full-preview workspace and in `.split-preview`, both flex rows holding `.docwrap` + panel). `.workspace` and `.split-preview` already have `overflow-x: auto` (src/styles.css:194-204, 825-835); `.docwrap` floors at `--mm-pane-min` (768px, src/styles.css:252-260). Issue #20's fix made `.panel` `position: sticky; right: 0` (src/styles.css:456-470) so it pins to the scrollport's right edge when content overflows — the doc scrolling beneath it is precisely the "comment box drawn on top of the text" this issue's screenshot shows. The likely fix is dropping the sticky pinning so the panel stays in flow and the pane's existing horizontal scrollbar takes over — but the implementer must verify the #20 gap still holds at full-right scroll (that was #20's complaint) and rework E130's overflow section accordingly. E2E harness: tests/e2e/helpers.ts; gap-measurement precedent in E130 (tests/e2e/app.spec.ts:5286).
