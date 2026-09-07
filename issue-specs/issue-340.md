# Spec: fixes in tabs (#340)

## Goal

All acceptance criteria in issue-specs/issue-340.md are satisfied for issue #340, with evidence visible in the session: the page's cast shadow, corner radius and outline belong to the white document surface and start at its top corners below the tab strip band (the band and the sidebar above that corner are one flat ground plane with no shadow between them); the page carries a 1px `--mm-border` outline on all four sides while a side pane is open, with the active tab joined to it through a break in that top edge; every file tab casts a token-derived shadow consistent with the page's, the active tab sharing the page's fill and plane; E353/E306/E585/E587/W19 are rewritten to assert the new treatment and `npm run validate:quick` passes in the implementer's session; a summary comment from the implementer exists on issue #340.

## Acceptance criteria

### A. The shadow stops at the page corner (issue point A)

- The white document surface (the page proper: the area below the file tab strip band holding `.workspace`, the editor and the split preview) is the element that carries the page's `border-radius` and `box-shadow`. The shadow's top edge begins at the page's top corners, level with the bottom of the tab strip band. It no longer runs up the sides of the strip band to the top of the body row. Observable: with the sidebar open, the strip band (`[data-testid="file-tab-strip"]`) has `box-shadow: none` and no `border-radius`, and the element whose top edge equals the strip's bottom edge has a non-`none` `box-shadow` and a `border-top-left-radius` / `border-top-right-radius` equal to `--mm-radius-small` (the same radius the tabs use).
- Above the page corner, the strip band, the folder sidebar, the comments column and the body-row ground are one continuous `--mm-bg-elevated` plane with no shadow, hairline or radius painted between any of them. Observable: the strip's, the folder panel's and the body row's computed background colours are equal (today's E353 assertion, kept) and no element in that region paints a `box-shadow`.
- The shadow still reads from `--mm-panel-shadow`, and the radius from `--mm-radius-small`. No literal colour, radius or shadow value appears in a chrome rule (the style lint in `npm run validate:quick` passes).

### B. The page is a bordered, higher plane with the tabs on it (issue point B)

- While at least one side pane is open, the page proper carries a 1px `--mm-border` outline on all four sides: left, right, bottom and top. The top edge runs along the bottom of the strip band and is interrupted under the active tab, so the active tab and the page are one continuous `--mm-bg` surface with no hairline between them. Observable: the page element's computed `border-left-width`, `border-right-width`, `border-top-width` and `border-bottom-width` are `1px` in `--mm-border`; the active tab's `border-bottom-width` is `0px`; sampling the pixel row where the tab meets the page shows the page colour, not the border colour.
- Every tab, active and inactive, stands on the page's plane: a 1px `--mm-border` outline on its top and sides, `--mm-radius-small` top corners, and a non-`none` `box-shadow` that resolves through a token. The shadow token is either `--mm-panel-shadow` itself or a new internal token declared beside it in the internal token family of `src/styles.css` (the family that holds `--mm-toolbar-shadow`), derived from the same colour and softness so the tabs and the page read as one shadow system. The tab shadow falls on the strip band around the tab; it never paints across the page surface below the active tab (the joined seam stays one colour).
- The active tab's computed background equals the page's (`--mm-bg`); inactive tabs' background differs from the active tab's, so the active file stays identifiable. Inactive tabs keep hover through `--mm-hover`; the active tab does not change on hover.
- Everything else sits on the plane beneath the page: the strip band, the sidebar, the comments column and the ground carry no lift of their own. The retired three-plane treatment (PRD 013 Reqs 10–12, the `.workspace-stack::after` L-shaped seam, `--mm-lift-tab` / `--mm-lift-tab-active`, `--mm-lift-row*`) stays retired; no `::after` overlay returns on the stack.
- Both side panes closed (`.body-row.panes-none`, including the static web build): the page keeps PRD 025 Req 7's edge-to-edge form at its sides, with no side or bottom border, no corner radius and no cast shadow. The strip band and the tabs look the same as with a pane open (PRD 025 Req 18), including the page's top hairline and the tabs' outlines and shadows.
- Light and dark themes both render the treatment from their own tokens: E306's One Dark form of the strip assertions passes without theme edits. No bundled theme is changed.

### C. Nothing else moves

- Page geometry is unchanged: the page's inner width still equals `max(--mm-content-width, --mm-pane-min)` editor-only and twice that plus the divider with the preview open (E584), the cluster is still centred with equal ground either side (E583, E587), and toggling a pane still applies no transition (E585). The 1px outline may not change the measured inner width by more than 2px in total; adjust the width rule if it does.
- The strip's height (`--mm-tabstrip-h`), its scroll rail, overflow arrows, per-tab ellipsis, dirty ●/✕ swap, context menu and the trailing control group with the Edit/Preview toggle are unchanged (E579, E587's control-group check, `file-tabs.spec.ts`).
- The strip-hidden edge clusters (`.edge-cluster-left`, `.edge-cluster`) still anchor to the page column's top corners at their current inset; W20 passes.
- Print output is unchanged: the strip stays hidden and the page prints flat with no border, radius or shadow (the existing `@media print` rules are extended to whichever element now carries them).
- Toolbar-static mode (the web/shim build) keeps the strip clearing the overlaid toolbar exactly as today.

### D. Tests, citations and docs

- Tests that assert the retired look are rewritten, not deleted: `assertFlatStrip` behind E353/E306 (tab `box-shadow: none`, active tab `z-index: auto`, radius and shadow on `.workspace-stack`), E585 and E587 (radius and shadow read from `.workspace-stack`), and W19 (same). Each now targets the element that carries the page treatment and asserts: strip band has no shadow and no radius; page proper has the radius, the shadow and the 1px outline on four sides; every tab has a non-`none` shadow and a 1px top outline; the active tab has no bottom edge and the page's fill.
- At least one new desktop e2e test (next free number: E589) covers the geometry of point A: the top of the page's shadowed element equals the bottom of the strip band, the strip band's sides paint no shadow, and the page's four border widths are 1px with a pane open and 0px in `panes-none`.
- Every changed rule carries a citation: `PRD 025 Req 6 / 17` amended by issue #340, or `issue #340` where no numbered contract applies. PRD 025 Reqs 6, 17 and 18 and PRD 013's Reqs 10–12 amendment note gain an `> **Amended (issue #340, 2026-09-07)**` note describing the new treatment (page shadow and outline on the page proper, tabs shadowed on the page's plane). SPEC36 §4.1's issue #331 note is updated the same way if its wording contradicts the new look. `docs/MAP.md` is regenerated with `npm run map` if any citation set changed, and the validation gate's map diff passes.

### E. Verification and reporting

- Iterate with `npm run typecheck` and `npm run test:unit`, and run individual e2e tests with `npx playwright test -g '<title>'` (E353, E306, E585, E587, W19, E583, E584 and the new test) while working. Do not run the full suite as a baseline or after every change.
- `npm run validate:quick` has been run once in the implementer's session, right before declaring the goal met, and prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #340, naming the commit, what changed and the gate result.

## Context

The issue has no comment thread; its one screenshot shows the sidebar seam shadow running straight up past the white page's top-left corner through the strip band, and flat outlined tabs. The owner wants the pre-PRD-025 depth back in a corrected form: the page as one bordered, shadowed sheet, tabs on that same plane with matching shadows, and everything else one flat plane beneath.

Where things are today (`rg 'PRD 025' src/styles.css`): `.workspace-stack` at `src/styles.css:2118` is the page column and holds `--mm-bg`, the top radius and `--mm-panel-shadow`; its first child is `.file-tab-strip` (`:2160`, `--mm-bg-elevated`, also rounded), then `.workspace`. Because the shadow sits on the whole column, it wraps the band too, which is issue point A. The fix is to move background/radius/shadow/outline onto the surface below the strip: either `.workspace` itself or a new wrapper around `.workspace` inside the stack (markup at `src/App.tsx:8499`; the stack's `panes-none` and print rules at `:2144` and `:1756` follow the moved properties). `.edge-cluster*` (`:2022`) are absolutely positioned against the stack and need no change if the stack stays `position: relative`.

Tabs: `.file-tab` (`:2247`) has the outline open at the bottom and `box-shadow: none`; `.file-tab.active` (`:2282`) is `--mm-bg` with a transparent border. The rail `.file-tab-rail` (`:2199`) is an `overflow: hidden` scroll box that ends at the strip's bottom edge, so a tab cannot overhang the page's top hairline by 1px unless the rail is extended 1px downward (or the hairline is drawn as the strip's `border-bottom` and the rail overlaps it). Mind that overlap when breaking the top edge under the active tab. The old three-plane CSS for reference is in `git show 1a203dc^:src/styles.css` (search `--mm-lift-tab`); do not restore its `::after` seam.

Token rules: `docs/STYLE-GUIDE.md` and the style lint forbid literal colours, radii and shadows in chrome rules; a new tab shadow goes in the internal token family next to `--mm-toolbar-shadow` (`src/styles.css:147`) with a comment. Existing tests to rewrite: `tests/e2e/file-tabs.spec.ts:1170–1240` (`assertFlatStrip`, E353, E306) and `:1360–1420` (E585), `tests/e2e/hosted.spec.ts:3458–3520` (E587), `tests/e2e/web.spec.ts:682–722` (W19). Highest numbers in use: E588, W20.
