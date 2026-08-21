# Spec: Diagram resize: comment-anchor invariance, parity posture and the test matrix (#172)

## Goal

All acceptance criteria in issue-specs/issue-172.md are satisfied for issue
#172, with evidence visible in the session: a desktop e2e proves a sidecar
comment anchored below a diagram keeps resolving — its stored anchor bytes
unchanged — across selection, a corner-drag resize, a double-click reset and a
cold reopen (PRD 015 Req 9); a web e2e on the BUILT single-file page proves the
resize gesture persists `width=N` there too (Req 12); the posture audit is
recorded — the sanitize schema unchanged, mermaid still at `securityLevel:
'strict'`, no new setting, menu item, command or platform seam, no `height=`
token; every line of PRD 015 Req 13's matrix maps to a named passing test, with
no existing test weakened, renumbered or skipped; `npm run validate:quick`
passes in the implementer's session; and a summary comment from the implementer
exists on issue #172.

## Acceptance criteria

- **PRD 015 Req 9 — a comment below a diagram survives a resize, proved in the
  desktop shim.** A new e2e in `tests/e2e/mermaid.spec.ts`, numbered from
  **E324** (re-check `grep -rhoE '\bE[0-9]{3}\b' tests/e2e | sort -u | tail -1`
  before writing), opens a document carrying a mermaid diagram with commentable
  prose **below** it (and, for the stronger case, above it too), places sidecar
  comments with `addComment` from `tests/e2e/helpers.ts`, then: selects the
  diagram, drags a corner and releases, and double-clicks to reset. After each
  step the comment still resolves — `mark.hl` still highlights the same phrase,
  the comment card is still present and unorphaned — and after the whole
  sequence the document is reopened from cold (`openPath` away and back, per
  E310's shape) and the highlight resolves again against a freshly drawn
  diagram.
- **PRD 015 Req 9 — the anchor bytes themselves are unmoved.** The same test
  reads the sidecar JSON with `fsRead` before the resize and after the resize
  and reset, and asserts each comment's `anchor` object is deep-equal — the
  same `start`, `end`, `exact`, `prefix` and `suffix`, in rendered-text
  coordinates. Nothing may rewrite an anchor to compensate: the numbers are the
  same numbers, not merely still-resolving ones. Alongside it, the rendered
  document's text (`doc.textContent`) is byte-identical before selection,
  during the drag, after the release and after the reset — the diagram
  contributes zero text nodes and the info string is not rendered text (PRD 013
  Req 3, which E310 pins and which keeps passing untouched).
- **PRD 015 Req 9 — a unit-level guarantee of the same invariant.** The
  rendered *text* of a document is byte-identical whether its fence carries
  `width=500`, no width token, or a malformed one — i.e. the width token never
  reaches the rendered-text coordinate space. If an existing test already
  states exactly that (`U776` in `tests/unit/fence-width-stamp.test.ts` asserts
  the width-bearing and widthless renders differ by the attribute alone —
  check whether it compares text or markup), cite it in the summary comment
  rather than duplicating it; otherwise add one numbered from **U792**
  (re-check `grep -rhoE '\bU[0-9]+\b' tests/unit | sed 's/U//' | sort -n |
  tail -1`) in the file that owns the module, `describe` block naming
  `PRD 015 Req 9`.
- **PRD 015 Req 12 — one web guard on the built single-file page.** A new test
  in `tests/e2e/web.spec.ts` numbered from **W18** (max today is W17) drops a
  mermaid document onto the built page (the file's `dropFile` helper), waits
  for the draw, clicks the diagram to get the overlay
  (`diagram-resize-overlay`, `diagram-resize-handle-<corner>`,
  `diagram-size-badge` — the same testids the desktop tests drive), drags a
  corner and releases, and shows the width persisted **into the document** on
  this platform: the dirty indicator is up and the fence line reads
  ```` ```mermaid width=N ```` when the edit pane is opened (there is no
  filesystem to `fsRead` on web — the buffer and the edit pane are the
  evidence), with N inside the `[40, natural viewBox width]` clamp. One test is
  the requirement; it is a parity guard, not a re-run of the desktop matrix.
- **The web suite is actually run, and its cost is understood.** `npm run
  validate:quick` does **not** run the web e2e (it is step 4 of the full
  `npm run validate`, which also needs Rust on PATH). So the web guard is
  exercised directly and the output quoted in the summary comment:
  `npm run build:web` then `npm run test:e2e:web` (or, while iterating on the
  one test, `npx playwright test --config playwright.web.config.ts -g 'W18'`).
  A W-test that has never been run is not evidence.
- **PRD 015 Req 12 — the posture audit, recorded not assumed.** Verified and
  stated in the summary comment with the command that shows each:
  (a) the sanitize schema in `src/lib/markdown.ts` is byte-identical to its
  pre-PRD-015 state — the `'*'`, `input`, `span`, `img` allow-lists and the
  `protocols` block unchanged (`git diff c125441 HEAD -- src/lib/markdown.ts`
  shows the `stampFenceWidths` pass, which runs *after* `rehypeSanitize` and
  rides `data.meta`, and no schema line); (b) mermaid still initialises at
  `securityLevel: 'strict'` with HTML labels off
  (`src/lib/mermaidRenderer.ts`, unchanged); (c) no new setting
  (`src/lib/settings.ts`), menu item or command (`src/lib/menuSpec.ts`,
  `src/lib/commands.ts`) and no new platform seam (`src/platform/types.ts`)
  was added by PRD 015 — the feature is always on where the document may be
  edited; (d) no `height=` token is written or read anywhere. Anything that
  turns out to have drifted is fixed here rather than noted.
- **PRD 015 Req 13 — the matrix has no holes.** Every case Req 13 names maps to
  a named test that passes, and the mapping appears in the summary comment as a
  short table. Today's homes are: click selects with handles and badge, and
  Escape/click-away deselect — **E317**; drag persists `width=N` with the dirty
  dot, ⌘S writing the file and the edit-pane widget drawing the same N —
  **E318**; a no-op release writes nothing — **E319**; double-click resets and a
  second is a no-op — **E320**; `error` and unstamped fences inert — **E321**;
  `pending` inert — **E322**; a read-only document shows no handles —
  **E323** (`tests/e2e/hosted.spec.ts`); the width is drawn in both panes —
  **E316**; unit coverage of the meta surgery and tolerant parse —
  `tests/unit/fence-width.test.ts` and `tests/unit/diagram-resize.test.ts`
  (U761–U791 range). This issue adds the two missing rows (Req 9 and the web
  guard). Any row that is genuinely absent or only incidentally covered gets a
  test here; a row already covered is cited, not re-written.
- **Nothing existing is weakened.** E309–E323, E310 in particular, E118/E122
  (images grow no preview overlay), W17 and the whole unit suite pass
  unchanged: no test renumbered, retitled away from its contract, `skip`ped or
  loosened to accommodate the new ones. New test documents get their own paths
  under `/docs/…` so they cannot collide with the existing fixtures.
- **Citations and the map.** New and changed code and tests carry a citation
  comment naming the contract (`// PRD 015 Req 9: …`) per
  `.sandcastle/CODING_STANDARDS.md` and `docs/COMMENT-FORMAT.md`. `docs/MAP.md`
  is generated from `SPEC<n>` citations only, so PRD-cited tests do not change
  it; if a `SPEC<n>` citation is added or moved, `npm run map` has been run and
  its output committed (`validate:quick` diffs the committed file against the
  generator).
- **Test economy.** Iteration used `npm run typecheck` and `npm run test:unit`
  (or a targeted `npx vitest run tests/unit/<file>.test.ts`, and
  `npx playwright test -g 'E324'` / the W18 form above while debugging one
  e2e) — not the full gate after every change, and no full-suite baseline at
  the start of the attempt (baseline with the quick tier only if you need one).
- `npm run validate:quick` has been run ONCE, at the end, in the implementer's
  session and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #172, stating what
  changed (the new test numbers and what each proves, the posture-audit
  findings, anything cited rather than added), the verification evidence
  (`validate:quick`, the web-suite run and its result), and anything
  deliberately left out.

## Context

Last of four issues under `prd/015-resizable-mermaid-diagrams.md` (parent
#166). #169 landed the pure `src/lib/fenceWidth.ts`; #170 made both panes draw
a persisted width (`stampFenceWidths` in `src/lib/markdown.ts` →
`data-mm-width` → `sizeDrawnSvg` in `src/lib/fenceDiagrams.ts` and
`src/components/diagramView.ts`); #171 added the gesture
(`src/components/DiagramResizer.tsx`, mounted in the full preview only at
`src/App.tsx:7045` with `active={docGrants.edit}` and `onRewrite=
{rewriteDiagramWidth}`). This issue is mostly **tests plus an audit** — expect
little or no production code, and treat any production change as a signal that
something in Reqs 9/12 actually regressed, worth saying so in the summary.

Where to work: `tests/e2e/mermaid.spec.ts` already has the resize harness —
`RESIZE_DOC` / `openResizeDoc` / `viewBoxOf` around line 294, `FIRST_DRAW` for
the 20s cold-import wait — and E310 is the model for the anchor case
(`addComment`, `mark.hl`, reopen-from-cold). Reuse those rather than
re-implementing setup; the anchor document needs prose *below* the diagram,
which `RESIZE_DOC` lacks, so a small local document is fine. Sidecar path
convention is `<doc>.comments.json`; the anchor shape is
`{exact, prefix, suffix, start, end}` (see `fixtures/interop-sidecar.comments.json`).
`tests/e2e/web.spec.ts` runs against `dist-web/index.html` served by `vite
preview` (`playwright.web.config.ts`); W17 at line 608 is the mermaid-on-web
precedent, and the file's `dropFile` helper opens a document there.

Do not read `src/App.tsx` end-to-end — citation-grep into it (`rg 'PRD 015'
src`, `rg 'DiagramResizer' src`) and use `docs/MAP.md` for spec→file lookups.
Coding rules live in `.sandcastle/CODING_STANDARDS.md`. Next free test numbers
as of this spec: unit **U792**, desktop e2e **E324**, web e2e **W18**
(re-check before you write).
