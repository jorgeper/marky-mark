# Spec: Tabs on top: plane/shadow visual treatment mirroring the sidebar tabs (#148)

## Goal

All acceptance criteria in issue-specs/issue-148.md are satisfied for issue
#148, with evidence visible in the session: the file tab strip carries the
sidebar's plane system rotated to the top edge (strip on the folder-pane
surface, ACTIVE tab on the workspace's front plane with rounded top corners, a
flush bottom that breaks the strip/workspace seam, and a punch-through shadow
cast over its neighbors; open-but-inactive tabs one shade back with a softer
lift), it derives every color from existing theme variables and holds in light
and dark themes, new e2e coverage asserts the three planes from computed
styles, `npm run validate:quick` has been run and passes, and a summary comment
from the implementer exists on issue #148.

## Acceptance criteria

- `.file-tab-strip` paints the same surface shade as `.folder-panel`
  (`--mm-bg-elevated`), so with the folder pane open the two form one
  continuous L-shaped backdrop around the workspace's top-left corner — no
  visible shade step or gap where the pane's top meets the strip's left end.
- The ACTIVE tab sits on the FRONT plane, the top-edge analogue of
  `.folder-item.selected` (src/styles.css ~2575): the workspace's own surface
  (`--mm-bg`), rounded TOP corners only, flush bottom (its bottom edge merges
  into the workspace — the strip's bottom hairline does not cut across it), and
  a lift shadow that punches through the strip/workspace seam the way
  `.folder-panel::after` is punched through by the selected row.
- The active tab stacks ABOVE its neighbors (the stacking analogue of the
  sidebar's `z-index: 2` front plane) so its shadow visibly falls over the
  adjacent tabs, not under them.
- Open-but-inactive tabs sit on the MIDDLE plane, the analogue of
  `.folder-item.open` (src/styles.css ~2604): a near-workspace surface one
  shade back (the same `color-mix(... var(--mm-bg) 72%, var(--mm-bg-elevated))`
  relationship the sidebar uses), rounded top corners, and their own softer
  shadow; their hover state lightens toward the workspace surface like
  `.folder-item.open:hover`, while the active tab does not change on hover.
- The seam between strip and workspace is painted once, as a strip-level edge
  treatment (the top-edge analogue of the `.folder-panel::after` overlay:
  hairline + inset cast shadow, `pointer-events: none`), layered above the
  middle-plane tabs and below the active tab — so exactly one tab breaks it.
- Every color and shadow derives from variables already in use
  (`--mm-bg`, `--mm-bg-elevated`, `--mm-border`, `--mm-fg`, `--mm-accent`,
  `--mm-panel-shadow`) with literal fallbacks, exactly as the sidebar rules do.
  No new REQUIRED theme key: an unmodified theme in `themes/` (which defines
  none of `--mm-panel-shadow`) still renders the three planes correctly.
- The treatment holds in a dark theme as well as the default light one (e.g.
  One Dark): the tab planes stay ordered strip < inactive < active, and the
  active tab still reads as the workspace surface.
- The strip's own chrome stays coherent with the new surface: the `#147`
  scroll arrows and the tab label/dirty-●/✕ affordances remain legible and
  correctly positioned against the strip and against both tab planes.
- Nothing about strip behavior or geometry regresses: the strip stays exactly
  `--mm-tabstrip-h` tall, tabs keep their max width, ellipsis, `flex-shrink: 0`
  and non-jittering trailing slot, the overflow rail still scrolls with no
  native scrollbar, and activation/close/context-menu behavior is untouched.
  The existing e2e suites (`tests/e2e/file-tabs.spec.ts` E266–E304,
  `tests/e2e/folder-tree.spec.ts`) pass unchanged.
- New e2e coverage exists in `tests/e2e/file-tabs.spec.ts` using the next free
  E-numbers (E305+), asserting from computed styles that: the strip's
  background equals the folder panel's; the active tab's background equals the
  workspace's and differs from both the strip and an inactive tab; the inactive
  tab's background sits between the two; the active tab carries a non-`none`
  `box-shadow` and a higher effective stacking order than its neighbors; and
  the same ordering holds after switching to a dark theme.
- Web-build behavior and the W tests are unchanged (PRD 013 non-goal); the
  strip remains desktop-only.
- New/changed CSS and TSX carry citation comments in this repo's format
  (`PRD 013 Reqs 10–12 (issue #148)` / `SPEC<n> §x.y` per
  `docs/COMMENT-FORMAT.md` and `.sandcastle/CODING_STANDARDS.md`). If any
  `SPEC<n>` citation is added or removed, `docs/MAP.md` has been regenerated
  with `npm run map` (never hand-edited) so the validation gate's map diff is
  clean.
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (plus targeted `npx playwright test -g '<title>'` runs for the tab tests) and
  ran the full gate `npm run validate:quick` ONCE, right before declaring the
  goal met — not after every change and not as a baseline at the start (any
  baseline uses the quick tier only). Its `QUICK VALIDATION: ALL PASSED` line
  is visible in the session.
- A summary comment from the implementer exists on issue #148 describing what
  shipped and the gate evidence.

## Context

- **PRD:** `prd/013-tabs-on-top.md` Reqs 10–12 (Visual treatment); parent issue
  #139. The strip foundation (#144), close affordances (#145), untitled tab
  (#146) and overflow rail (#147) are already merged — this issue is the
  final look only, no behavior change. Issue #149 (e2e sweep) follows.
- **Files:** `src/styles.css` is where nearly all of this lands —
  `.file-tab-strip` / `.file-tab-rail` / `.file-tab*` at ~2268–2440 (the #144
  and #147 comments there explicitly defer the plane/shadow look to this
  issue), and the sidebar's plane system to mirror at `.folder-panel` ~2471,
  `.folder-panel::after` ~2487, `.folder-item.selected` ~2575 and
  `.folder-item.open` ~2604. `src/components/FileTabStrip.tsx` already renders
  `.file-tab.active`, `data-active`, `role="tab"` and the rail/arrows; touch it
  only if the treatment needs an extra element (e.g. a seam overlay) or a
  testid.
- **Gotchas:** the strip is a flex sibling ABOVE `.workspace` inside
  `.workspace-stack`, so getting the active tab's shadow to fall onto the
  workspace needs deliberate stacking (positioned elements / z-index), not just
  a `box-shadow`. The strip currently owns a plain `border-bottom` — replacing
  it with a punch-through seam is part of the work. Tabs sit in the scrolling
  `.file-tab-rail`, so any overlay or negative offset must not create a new
  scroll range or a native scrollbar, and must not change strip height.
- **Themes:** `themes/*.css` define `--mm-bg`, `--mm-bg-elevated`,
  `--mm-border`, `--mm-fg`, `--mm-accent` but not `--mm-panel-shadow`; keep the
  same `var(--x, fallback)` discipline the sidebar rules use.
- **Verification:** iterate with `npm run typecheck` + `npm run test:unit`;
  debug one Playwright test with `npx playwright test -g '<title>'`; finish
  with a single `npm run validate:quick`.
