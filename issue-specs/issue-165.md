# Spec: preview pane animations (#165)

## Goal

All acceptance criteria in issue-specs/issue-165.md are satisfied for issue
#165, with evidence visible in the session: opening the split preview from edit
mode plays as one continuous slide — the pane comes in from the right edge
already carrying rendered document content instead of arriving blank and
popping, the editor's text column travels leftward on the same 180ms
`--mm-slide-ease` curve instead of teleporting from centred to left-flush the
frame the toggle fires, and the CodeMirror editor is not torn down and rebuilt
mid-slide — closing plays the same motion in reverse, `prefers-reduced-motion`
still switches instantly, `npm run validate:quick` passes in the implementer's
session, and a summary comment from the implementer exists on issue #165.

## Acceptance criteria

### The pane slides in carrying content

- Opening the split preview from edit mode (any surface: the `preview-expand`
  chevron, View ▸ Split Edit, `Mod+\`, the `set-split-edit` Settings checkbox)
  shows rendered document HTML inside `.split-preview` from the first painted
  frame of the slide, not an empty pane that fills in afterwards. Today the
  markdown render for split edit is debounced 200ms in `src/App.tsx` (~line
  5466, `setTimeout(render, 200)` under `mode === 'edit'`) and then resolves
  asynchronously, so the whole 180ms slide runs over a blank pane.
- The 200ms coalescing debounce still applies to keystroke-driven re-renders —
  the fix targets the render that the *pane opening* asks for, not typing. A
  test or a named code path distinguishes "the split just opened" from "the
  buffer changed".
- Where a first render genuinely cannot be ready in time (e.g. no document
  open), the pane does not flash a partially-rendered or stale-document body:
  it slides in with the same content it will hold when the slide ends.

### The editor animates instead of snapping

- The editor's text column moves to its split-mode position as part of the
  slide, on the same 180ms `--mm-slide-ease` curve as the pane's transform and
  the `.split-editor` width transition. Today `.editor-wrap .cm-editor
  .cm-scroller { justify-content: center }` flips to `flex-start` via
  `.split-editor .editor-wrap .cm-editor .cm-scroller` (`src/styles.css` ~lines
  974–989) the instant the class changes, so the text jumps left in one frame
  while the pane is still sliding — the "edit text should also animate to the
  left" the issue asks for.
- All four moving edges stay locked together for the whole run: the preview's
  left edge, the editor pane's right edge, the divider, and the editor's text
  column. No gap, overlap, tearing, or transient horizontal scrollbar appears
  mid-flight, and nothing overshoots its resting position.
- Closing plays the same motion in reverse — the text column returns to centred
  over the same 180ms rather than snapping back when the pane unmounts.

### No teardown mid-slide

- Toggling split edit does not unmount and remount the CodeMirror editor.
  Today the plain-edit branch renders `<Suspense><Editor/></Suspense>` as the
  workspace's first child while the split branch nests it inside
  `<div className="split-editor">` (`src/App.tsx` ~lines 7011 and 7098), so
  React unmounts the whole `Editor` subtree at exactly the frame the slide
  starts — a main-thread stall through the animation's opening frames. A test
  asserts the editor instance survives the toggle (e.g. a `.cm-editor` node
  identity / mount-count check, or a preserved scroll position and selection
  that a fresh mount would lose).
- The editor's scroll position and caret/selection are the same immediately
  after the toggle as immediately before it, in both directions, so nothing
  visibly jumps into place once the slide ends. If the repo already carries a
  reading position across this toggle, that behaviour is preserved rather than
  re-derived.
- The `Suspense` fallback (`data-testid="editor-loading"`) does not appear when
  toggling split edit on a document that is already being edited.

### Nothing else regresses

- `prefers-reduced-motion: reduce` still switches the pane instantly with no
  slide (PRD 003 Req 11): the phase collapse in `usePaneSlide` and the
  media-query carve-out in `src/styles.css` (~line 1178) still cover every
  transition this work adds, including the editor text column's.
- The steady states stay transition-free: dragging the split divider and
  resizing the folder pane never animate, the settled `.split-preview` carries
  no `transform` (a steady-state transform would become the containing block
  for fixed-position menus — the reason `.sliding`/`.preview-sliding` exist),
  and `settings.splitEdit` persists exactly as before.
- Programmatic, unarmed flips (workspace-layer resolution, launch restore,
  mode swaps) still switch instantly — only user toggles slide (PRD 003 Req 12,
  the `armSplitSlide` ref in `src/App.tsx` ~line 2816).
- The existing suites still pass unchanged in intent: `E133` (pane slides —
  mount/unmount, persistence, reduced motion) in
  `tests/e2e/shell-and-menus.spec.ts`, `E134` (no blank strip at the folder
  seam, issue #7) and the `tests/e2e/split-view.spec.ts` suite, plus the split
  behaviours that ride the pane — SPEC15 scroll sync, SPEC23 selection
  mirroring, SPEC44 caret cues, comment anchoring, and issue #167's sync-scroll
  toggle. Any test edited is edited because the contract moved, not to
  accommodate a regression.
- The folder pane's slide is untouched by this work, or moves only in ways that
  keep it visually identical — the shared `--mm-slide-ease` token, `SLIDE_MS`,
  and `src/lib/paneSlide.ts`'s phase table stay one definition, not forked per
  pane.

### Verification and hygiene

- Unit coverage exists for any pure logic this adds or changes in `src/lib/`
  (e.g. `src/lib/paneSlide.ts` phase-table changes are covered in
  `tests/unit/pane-slide.test.ts`).
- At least one new Playwright test exists (next free number: `E316`), in
  `tests/e2e/split-view.spec.ts` or `tests/e2e/shell-and-menus.spec.ts`
  alongside `E133`, asserting the observable end states above: the pane holds
  rendered content at the start of the slide, the editor instance survives the
  toggle with its scroll/selection intact, and reduced motion is still instant.
  Frame-by-frame interpolation sampling is deliberately NOT the mechanism —
  `E135` was removed on 2026-08-03 for exactly that flakiness (see the note in
  `E133`); assert on structural facts and settled geometry instead.
- New and changed behaviour carries citation comments in the repo's format
  (`docs/COMMENT-FORMAT.md`, `.sandcastle/CODING_STANDARDS.md`), citing issue
  #165 alongside the PRD 003 Reqs 9–12 sites it modifies. If any `SPEC<n>`
  citations are added or moved, `docs/MAP.md` is regenerated with `npm run map`
  and committed (validate:quick diffs it).
- Iteration used `npm run typecheck` and `npm run test:unit` (or a single
  targeted e2e via `npx playwright test -g '<title>'`); the full gate was run
  ONCE, right before declaring the goal met — not after every change and not as
  a start-of-attempt baseline (baseline with the quick tier only).
- `npm run validate:quick` has been run in the implementer's session and printed
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #165.

## Context

The issue has no PRD reference and no parent, and its thread has no replies —
the two-line body is the whole brief: "make them smoother … when opening it, it
should slide in, and the edit text should also animate to the left to make room
for it, this seems to be broken or not very smooth."

The slide already exists: PRD 003 Reqs 9–12
(`prd/003-pane-chevrons-and-slide-animations.md` § Slide animations) built it,
`src/lib/paneSlide.ts` holds the pure phase table
(`closed → pre-open → opening → open → closing`, `SLIDE_MS = 180`), and
`usePaneSlide` in `src/App.tsx` (~line 283) is the React wiring — layout effect,
double rAF for the painted from-state, settle timer. The CSS is
`--mm-slide-ease` (`src/styles.css` ~line 27) plus the
`.workspace.split.preview-sliding` / `.preview-out` rules (~lines 1152–1186).
So this issue is about *why the existing slide reads as broken*, not about
building one; the three concrete causes are named in the criteria above
(blank pane during the slide, the centred→flush text snap, the editor remount).

Grep before opening files — `rg 'PRD 003' src`, `rg 'SPEC7' src` for split edit,
`rg 'SPEC15' src` for scroll sync. Do NOT read `src/App.tsx` end-to-end (4,700+
lines); citation-grep into it, per `CLAUDE.md`. `docs/MAP.md` is the spec→code
table.

Prefer transform/opacity over layout-affecting properties where a choice
exists: `.split-editor`'s width transition already forces CodeMirror to
re-measure every frame, so any additional animated property on the editor
should be one the compositor can handle. Whatever technique is chosen for the
text column, keep it behind the same `.preview-sliding` arming so the divider
drag and pane resizing stay instant.
