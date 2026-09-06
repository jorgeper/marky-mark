# Spec: new icons (#307)

## Goal

All acceptance criteria in issue-specs/issue-307.md are satisfied for issue #307, with evidence visible in the session: the preview-pane and comments-pane edge toggles in the workspace's top-right cluster no longer share one chevron glyph — each carries its own recognisable icon (a split-pane/preview glyph and a comment-bubble glyph) drawn in the same 16×16 `currentColor` stroke style as the sibling edge icons, with the open and closed states still visually distinguishable and pinned by `data-icon` attributes on `data-testid` SVGs; the existing `preview-collapse`/`preview-expand`/`comments-collapse`/`comments-expand` test ids, titles and aria-labels are unchanged and every other `Chevron` user (folder rows, TOC, sidebar hide/show) still renders the chevron; a new E-numbered e2e test proves the two glyphs differ; `npm run validate:quick` passes in the implementer's session; and a summary comment from the implementer exists on issue #307.

## Acceptance criteria

### Distinct glyphs (issue #307)

- `PreviewToggleButton` and `CommentsToggleButton` in `src/components/FolderPanel.tsx` no longer render the shared `Chevron`. Each renders its own inline SVG glyph, so the two buttons that sit side by side in the top-right edge cluster are visually distinct at a glance:
  - the **preview toggle** shows a glyph that reads as "preview / split pane" (e.g. a rectangle split by a vertical divider, or a document-with-eye), and
  - the **comments toggle** shows a glyph that reads as "comments" (e.g. a speech bubble).
- Both glyphs are drawn in the **same style as the sibling edge icons** (`ModeSwitchButton`'s pencil/eye, `CopyLinkButton`'s link, `TocPanel`'s magnifier): an inline `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">` whose paths use `stroke="currentColor"`, `fill="none"` (or `currentColor` fills), `strokeWidth` ≈ 1.4, round caps and joins. No raster asset, no new dependency (no icon library added to `package.json`), no raw colour literal or inline `style` (the style lint in `scripts/validate.mjs` rejects both).
- **Open and closed states stay distinguishable.** Each button still conveys whether a click will hide or show its pane — either by a visible variation of the glyph (e.g. filled vs. outline, a divider present vs. absent, a small directional cue) or by keeping a subtle direction marker alongside the new glyph. The two states of one button must not be pixel-identical.
- The glyph SVGs carry stable hooks so tests can pin them without screenshots: the preview SVG has `data-testid="preview-toggle-icon"` and the comments SVG has `data-testid="comments-toggle-icon"`; each carries a `data-icon` attribute whose value names the glyph and state (suggested: `preview-open` / `preview-closed` and `comments-open` / `comments-closed`). The preview and comments `data-icon` values never coincide.

### Nothing else moves

- The button test ids `preview-collapse`, `preview-expand`, `comments-collapse`, `comments-expand` are unchanged (36 e2e call sites depend on them), as are the `title`/`aria-label` pairs `Hide the preview pane` / `Show the preview pane` and `Hide the comments pane` / `Show the comments pane` (asserted by E-tests in `split-view.spec.ts` and `comments.spec.ts`).
- Both buttons still use the `IconButton` wrapper with their `preview-edge` / `comments-edge` classes, so the edge-cluster layout, size, hover and colour rules in `src/styles.css` (the `.edge-cluster` / `.file-tab-strip-trail` block) apply verbatim; the position assertions in E-tests (comments chevron right-most, preview immediately left of it, within a few px) keep passing without change.
- The commands dispatched (`toggleSplit`, `toggleComments`) and the render conditions in `src/App.tsx` (preview toggle only in edit mode; comments toggle in every mode when the comments seam is enabled) are untouched.
- The shared `Chevron` component and every other caller (folder tree rows, `FolderExpandButton`, the TOC header's collapse chevron, the sidebar hide button) are unchanged — the sidebar still uses chevrons; only the two right-edge pane toggles get new icons.
- Both glyphs read in light and dark themes because they use `currentColor` (no hard-coded colour).

### Tests and citations

- A new e2e test in `tests/e2e/split-view.spec.ts` (or `comments.spec.ts`), titled with the **next unused E number (E564 at the time of writing — re-check with `grep -rho 'E[0-9]\+:' tests/e2e | sort -t E -k2 -n | tail -1` before committing)**, proves with the fixtures/helpers already in `tests/e2e/`: in edit mode with the split open and comments enabled, `preview-toggle-icon` and `comments-toggle-icon` are both visible and their `data-icon` values differ; after toggling each pane via its button, its `data-icon` changes to the other state value while the sibling's does not. The test drives buttons by `getByTestId` only.
- No existing test is weakened, deleted, renumbered or marked `.skip`/`.only`/`.fixme`.
- New or changed behaviour carries the citation comment the repo requires — `// Issue #307: <what and why>` (the edge-cluster code already cites `Issue #125` / `issue #284` this way) — per `.sandcastle/CODING_STANDARDS.md`. The JSDoc on the two components is updated so it no longer describes a chevron "pointing in the direction a click will move the pane".
- If `npm run validate:quick` reports a `docs/MAP.md` diff, `npm run map` has been run and the regenerated file committed (an issue-cited change in `FolderPanel.tsx` is not expected to alter it, since the map keys on `SPEC<n>` citations).

### Verification

- Iteration used `npm run typecheck` and `npm run test:unit`, plus the single targeted e2e run `npx playwright test -g 'E564'` (and `-g 'E435'` / the preview chevron test to confirm nothing regressed) after each change — not the full gate after every edit, and no full-gate baseline at the start of the attempt.
- `npm run validate:quick` has been run **once**, at the end, in the implementer's session, and prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #307, naming the two glyphs chosen, the `data-icon` values, the new E number, and the gate result.

## Context

The owner's report (issue #307, with a screenshot of the two side-by-side arrows) is that the preview toggle and the comments toggle in the workspace's top-right edge cluster are both the same chevron, so they cannot be told apart. Both are `IconButton`s in `src/components/FolderPanel.tsx` (`PreviewToggleButton` ~line 309, `CommentsToggleButton` ~line 333) that render `<Chevron dir={open ? 'right' : 'left'} />`; `Chevron` (~line 222) is shared with the folder tree and TOC, so change the two callers, not `Chevron`. They are rendered from `src/App.tsx` (~line 8140) inside the `rightCluster` next to `ModeSwitchButton` (pencil/eye) and `CopyLinkButton` (link) — those two, plus `TocPanel`'s `Magnifier`, are the style reference: 16×16 viewBox, `currentColor` stroke 1.4, round caps/joins, `aria-hidden` SVG, accessible name on the button.

Contracts already governing these buttons: PRD 003 Reqs 6–7 and 13 (preview edge chevron, tooltip + aria-label), PRD 023 §14 (`prd/023-comments-highlights-split.md`, issue #284: comments chevron right of the preview chevron in every mode), PRD 018 Req 12 / §B9 (edge controls are the pane header's icon buttons; `IconButton` requires an accessible name). Existing coverage to keep green: the preview chevron test around `tests/e2e/split-view.spec.ts:360-415` (positions, titles, aria-labels), E435/E438 in `tests/e2e/comments.spec.ts`, and the `mode-switch-icon` `data-icon` assertions at `split-view.spec.ts:889/909`, which are the precedent for pinning a glyph by attribute.

Constraints from `.sandcastle/CODING_STANDARDS.md` and `docs/STYLE-GUIDE.md`: no colour literals or inline `fontSize`/`color` styles in TSX; every `<button>` is a ui/ wrapper; `getByTestId` selectors; test ids are never renamed; unit suite runs with `isolate: false`. Do not read `src/App.tsx` end to end — grep `PreviewToggleButton` / `CommentsToggleButton`.
