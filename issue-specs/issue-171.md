# Spec: Click-to-select and corner-handle resize for preview diagrams (#171)

## Goal

All acceptance criteria in issue-specs/issue-171.md are satisfied for issue
#171, with evidence visible in the session: in preview mode a click on a
rendered mermaid diagram selects it (outline, four corner handles, a `W × H`
badge, overlay-only — no text mutation), dragging a corner rescales the drawn
SVG live and aspect-locked between 40 px and the drawing's natural `viewBox`
width, release rewrites the opening fence's `width=N` token through the same
buffer path typing uses (dirty dot, ⌘S, autosave-on-toggle) without re-running
mermaid or flashing raw code, double-click removes the token, Escape or a click
away deselects, and no handles appear in the edit pane, in the split preview
pane, on a document without `docGrants.edit`, or on a `pending`/`error`
diagram; `npm run validate:quick` passes in the implementer's session; and a
summary comment from the implementer exists on issue #171.

## Acceptance criteria

- **PRD 015 Req 5 — click selects, in the full preview only.** In preview mode
  (`mode === 'preview'`, the `docRef` pane under `.workspace`), clicking a
  rendered diagram — the `mm-diagram` host grafted by
  `src/lib/fenceDiagrams.ts` — selects it: an outline around the drawing, four
  corner handles (`nw`/`ne`/`sw`/`se`) and a size badge reading the live
  `W × H` in rounded CSS px. Clicking anywhere else, or pressing Escape,
  deselects. The overlay looks and behaves like the SPEC20 image overlay
  (`.img-resize-overlay` / `.img-handle` / `.img-size-badge` in
  `src/styles.css`, still present and currently unused — see Context). Scope is
  the full preview pane **only**: the split-edit preview (`splitDocRef`) and
  the CodeMirror widget (`src/components/diagramView.ts`) get no selection, no
  handles and no badge, and clicking a diagram in the edit pane keeps today's
  PRD 013 Req 5 behaviour (reveal the fence source at the caret).
- **PRD 015 Req 5 — overlay only, anchors untouched.** Selecting, dragging and
  deselecting add no text nodes and mutate no document text: the overlay is a
  sibling of `.doc` positioned in the workspace's content coordinates (the
  SPEC20 shape), never a child of the rendered document, so `getDocText`'s
  output is byte-identical before, during and after a selection. The diagram
  still contributes zero text nodes (PRD 013 Req 3) and E310 passes unchanged.
  (The dedicated comment-anchor e2e for a *resize* is PRD 015 Req 9 — issue
  #172's, not this one's.)
- **PRD 015 Req 6 — aspect-locked drag with image bounds.** Dragging a corner
  handle rescales the drawn SVG live: width clamped to a 40 px minimum and to
  the drawing's natural layout width maximum (the third number of mermaid's own
  `viewBox`), height following the drawing's aspect — the whole drawing scales,
  nothing crops. The badge tracks the live size while the pointer moves, and
  the drawing follows the pointer within the same frame (no lag behind the
  handle). A drag that does not move (a plain click) resizes nothing. The live
  rescale goes through the one place that already owns the sizing rule —
  `sizeDrawnSvg` in `src/lib/fenceDiagrams.ts` (export it if needed) — rather
  than a second copy of the same style writing.
- **PRD 015 Req 7 — release persists through the typing path.** On pointer-up
  the opening fence line is rewritten with `rewriteFenceWidth(line, N)` from
  `src/lib/fenceWidth.ts` (landed by #169) and spliced into the buffer through
  the same path typing uses — the dirty dot appears, ⌘S writes the file, and
  autosave-on-toggle behaves as it does for a typed edit. `git show
  50afdab:src/App.tsx` (`rewriteImage`, `setBuffer(res.text)`) is the precedent.
  The rewritten line is exactly what Req 2 promises: every other meta token,
  the indentation, the fence character and run length preserved verbatim. The
  diagram stays selected across the rewrite, with the overlay re-bound to the
  re-rendered host and the badge showing the new size.
- **PRD 015 Req 7 — a no-op release writes nothing.** Releasing at the width
  the fence already carries leaves the buffer byte-identical: no dirty dot, no
  undo entry, no save. `rewriteFenceWidth` returns the line unchanged in that
  case, so comparing before writing is the whole check.
- **PRD 015 Req 7 — mermaid does not re-run, and nothing flickers.** The
  already-drawn SVG is rescaled in place; mermaid re-runs only when the fence
  **body** changes, exactly as today. The obstacle is real and must be solved,
  not assumed away: a buffer write re-derives `html`, the preview's
  `doc.innerHTML = html` replaces every node, and `renderFenceDiagrams` then
  sees fresh `<pre>`s with no `data-mm-diagram` mark and calls the renderer
  again for every diagram in the document. The known route is a preview-side
  result cache keyed on (tag, source, theme) — the shape `cachedRender` already
  has at `src/components/diagramView.ts:43` — so a width-only edit is a cache
  hit; any route is acceptable that makes these observable: after a release,
  no block re-enters the `pending` state (no flash of raw fence source), the
  drawing stays continuously visible, and the renderer function is invoked once
  across two passes over unchanged sources. The unit test asserting a single
  renderer invocation across two passes is the evidence for the last one.
- **PRD 015 Req 8 — double-click resets.** Double-clicking a selected diagram
  rewrites its fence line with `rewriteFenceWidth(line, null)` — the `width`
  token and the single space before it are removed, every other token survives
  — and the drawing returns to natural size. On a diagram carrying no width
  token the double-click is a no-op: no buffer write, no dirty dot.
- **PRD 015 Req 10 — the editability gate.** Handles appear only where the
  document may be edited: the gate is `docGrants.edit`, the same grant that
  enables Edit mode (`src/App.tsx:466`, PRD 007 Req 17). On a read-only
  document a click on a diagram does nothing — no outline, no handles, no
  badge, no listeners doing work — and the document text is untouched.
- **PRD 015 Req 11 — pending and error diagrams are inert.** A fence whose
  `<pre>` is in the `pending` or `error` state (PRD 013 Reqs 10–11) is not
  selectable: clicking its code block or its failure badge produces no overlay,
  and the badge and code block read exactly as today. Likewise a diagram whose
  `<pre>` carries no `data-mm-line` stamp (`stampSourceLines` marks only direct
  children of the root, so a fence nested in a list has none) is not selectable
  — no handles rather than a rewrite aimed at the wrong line.
- **The image overlay stays gone.** SPEC41 §4 removed the preview image
  resizer; E118 and E122 (`tests/e2e/images.spec.ts`) pin that clicking an
  image in the preview grows no `img-resize-overlay`, `img-size-badge` or
  `image-chip-layer`. Those tests pass unchanged: the diagram overlay ships its
  own `data-testid`s (e.g. `diagram-resize-overlay`, `diagram-size-badge`,
  `diagram-resize-handle-<corner>`) even where it shares the SPEC20 CSS
  classes, and images gain no preview handles. If the overlay reuses a class
  the print rule at `src/styles.css:1949` hides, it is covered there too — the
  overlay is chrome and never reaches paper.
- **Nothing else moves.** No new setting, menu item, command or platform seam;
  the sanitize schema in `src/lib/markdown.ts` stays byte-identical; mermaid
  still runs at its strictest security level; no `height=` token is ever
  written or read; export and print are unchanged (mermaid fences still export
  as code). `src/lib/fenceWidth.ts` needs no new export — if one is added, say
  so in the summary comment and keep the module pure per
  `.sandcastle/CODING_STANDARDS.md` (no `react`, no CodeMirror, no
  `src/components/` imports).
- **Unit coverage.** Test titles numbered from **U783** up (re-check
  `grep -rhoE '\bU[0-9]+\b' tests/unit | sed 's/U//' | sort -n | tail -1`
  before writing), `describe` blocks naming the contract (`PRD 015 Req 6`, …),
  one file per module per `.sandcastle/CODING_STANDARDS.md`. Cover the pure
  parts: the clamp (below 40 ⇒ 40; above natural ⇒ natural; aspect preserved at
  both ends), the width→fence-line rewrite for a resize and for a reset
  including the byte-identical no-op, and the render-reuse guarantee (one
  renderer invocation across two passes over the same source/theme, a fresh
  invocation when the source changes).
- **E2e coverage.** New desktop tests in `tests/e2e/mermaid.spec.ts` numbered
  from **E317** (re-check `grep -rhoE '\bE[0-9]{3}\b' tests/e2e | sort -u |
  tail -1`), driven by `getByTestId`, using `tests/e2e/helpers.ts`
  (`freshApp`, `fsWrite`, `openPath`, `landInPreview`, `fsRead`, `stableBox`)
  rather than re-implemented setup. Between them they show: a click selects
  (overlay, four handles, badge) and Escape and a click away deselect; a corner
  drag rescales live and the release leaves `width=N` in the document with the
  dirty dot up, the value inside the clamp, and the edit-pane widget drawing
  the same N after ⌘E; a second release at the same width writes nothing;
  double-click removes the token and restores natural size, and a second
  double-click is a no-op; a `pending`/`error` diagram grows no overlay; and
  the drawing never disappears or returns to `pending` across the release. The
  read-only case (Req 10) goes where the PRD 007 viewer harness already lives
  (`tests/e2e/hosted.spec.ts`, cf. E206). Existing E309–E316, E118, E122 and
  W17 pass untouched; no existing test is weakened, renumbered or skipped.
- **Left to #172.** The comment-anchor-survives-a-resize e2e (PRD 015 Req 9),
  the single-file web-build guard (Req 12) and the closing test-matrix sweep
  belong to issue #172 and are not required here.
- New and changed code carries a citation comment naming its contract
  (`// PRD 015 Req 6: …`) per `.sandcastle/CODING_STANDARDS.md` and
  `docs/COMMENT-FORMAT.md`. No `SPEC<n>` citation is added or moved, so
  `docs/MAP.md` needs no regeneration — but if one is added or moved, run
  `npm run map` and commit the result (validate:quick diffs it).
- Test economy: iteration used `npm run typecheck` and `npm run test:unit` (or
  a targeted `npx vitest run tests/unit/<file>.test.ts`, and
  `npx playwright test -g 'E317'` while debugging one e2e) — not the full gate
  after every change, and no full-suite baseline at the start of the attempt
  (baseline with the quick tier only if you need one).
- `npm run validate:quick` has been run ONCE, at the end, in the implementer's
  session and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #171, stating what
  changed (the overlay's home and testids, the buffer-write path, how mermaid
  is kept from re-running, the tests and their numbers), the verification
  evidence, and anything deliberately left out.

## Context

Third of four issues under `prd/015-resizable-mermaid-diagrams.md` (parent
#166). #169 landed the pure `src/lib/fenceWidth.ts` (`readFenceWidth`,
`rewriteFenceWidth`); #170 made both panes *draw* a persisted width (the
pipeline stamps `data-mm-width` on the fence's `<code>` in
`src/lib/markdown.ts`, and `sizeDrawnSvg` in `src/lib/fenceDiagrams.ts`
applies it). This issue adds the gesture; #172 closes out anchors, parity and
the matrix.

**Read this before you plan:** the issue says "reuse the SPEC20 image-resize
overlay", and the overlay component no longer exists. SPEC41 (commit
`c125441`, "Preview ImageResizer removed") deleted
`src/components/ImageResizer.tsx` and moved image resizing into the edit pane
as border chips (`src/components/Editor.tsx`, `startImageDrag`,
`persistImageSize`). What survives is the CSS — the `.img-resize-overlay`
block at `src/styles.css:296` and the `position: relative` offset parents at
`:281` — plus e2e tests that pin images having *no* preview overlay. So
"reuse" here means reuse the look (that CSS) and the interaction shape, not an
existing component; do not give images handles back. The deleted component is
the best available blueprint and reads cleanly:
`git show 50afdab:src/components/ImageResizer.tsx` (delegated click/dblclick/
Escape listeners, overlay measured in workspace content coords, corner drag
with a suppress-the-click-after-a-drag flag) and its App-side owner
`git show 50afdab:src/App.tsx` around `rewriteImage`.

How a click gets back to the document: the diagram host is grafted next to the
fence's `<pre>`, and that `<pre>` carries `data-mm-line` — the opening fence's
1-based source line (`stampSourceLines`, `src/lib/markdown.ts:179`; direct
children of the root only). Line number → the buffer's line → `rewriteFenceWidth`
→ splice → `setBuffer`. The natural width for the clamp is on the drawn SVG
itself: the host's shadow root is `open`, so `host.shadowRoot.querySelector('svg')`
and its `viewBox` are reachable from the app and from Playwright alike.

Where the preview is built: `src/App.tsx` around line 5650 (full preview,
`docRef`/`workspaceRef`) and around line 5820 (split preview, `splitDocRef` —
out of scope). Citation-grep rather than reading `App.tsx` end-to-end
(`rg 'renderFenceDiagrams' src`, `rg 'docGrants' src`), and use `docs/MAP.md`
for spec→file lookups. Coding rules live in `.sandcastle/CODING_STANDARDS.md`.
Next free test numbers as of this spec: unit **U783**, desktop e2e **E317**
(re-check before you write).
