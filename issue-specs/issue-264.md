# Spec: Changes Since Save: hardening pass — buggy around code blocks, smart tables, images (#264)

## Goal

All acceptance criteria in issue-specs/issue-264.md are satisfied for issue
#264, with evidence visible in the session: the Changes Since Save overlay
paints its changed-line tints and deletion markers on the correct editor
lines in documents containing gridded smart tables, fenced code cards,
images and other block widgets (no coordinate drift, no swallowed or
mis-attributed markers, no spurious "changed" lines on an unedited buffer,
no visual corruption of the widgets while the diff is on); the failure modes
found are catalogued with a fix or an explicit verdict for each; regression
tests cover each construct (pure-seam unit tests plus desktop-shim e2e);
`npm run validate:quick` passes in the implementer's session; and a summary
comment from the implementer exists on issue #264.

## Acceptance criteria

**Catalog (step 1 of the issue)**

- A catalog of the reproduced failure modes exists in the implementer's
  issue comment: for each one, the construct involved (fenced code block,
  smart table, image, front matter, list/quote, whole-block add/remove), the
  observable wrong behaviour, and its disposition — fixed, or explicitly
  judged correct-as-is with the reason. Anything found and not fixed is named
  in the comment, never silently dropped.

**Correctness of the overlay (step 2 of the issue)**

- Line coordinates agree end to end. `src/App.tsx` computes the sets from
  `canonicalOf(buffer)` (canonical text, tables collapsed) while
  `diffDecorations` in `editor/src/components/Editor.tsx` applies them to raw
  editor-doc lines; a gridded table occupies more editor lines than canonical
  ones, so every line below the first grid currently drifts. After the change,
  with a document whose first table is gridded, an edit to a line *below* that
  table tints exactly that line — no off-by-N. The mapping is a tested seam
  (`canonicalLineAt` in `editor/src/components/tableMode.ts` is the existing
  raw→canonical direction; reuse or extend rather than duplicating the
  arithmetic).
- An unedited buffer produces no decorations. Opening a document that mixes
  front matter, prose, lists, quotes, a smart table (gridded on open), an
  image and a fenced code block, then turning the toggle on without typing,
  leaves zero changed-line tints and zero deletion markers — including after
  the grid pass has run.
- A deletion whose anchor line is itself changed still shows its marker.
  `diffDecorations` currently collapses `changed` and `deletedAfter` into one
  `Map` keyed by line, so the changed tint overwrites the deletion marker on a
  shared line; after the change both treatments land on that line.
- Deletion markers at the document edges land on a real, visible line:
  deletion before line 1 (`deletedAfter` 0) and deletion of the trailing lines
  (anchor at or past the last line) each mark a line the user can see, and the
  existing clamp does not silently retarget a marker onto an unrelated
  construct.
- Edits inside a fenced code block tint the code lines legibly: the tint is
  visible against the card background (`.mm-fence-card::before`,
  `--mm-code-bg`) rather than washed out or hidden behind it, and the card's
  chrome — ring, rounded first/last edges, copy button, syntax colours — is
  unchanged while the diff is on.
- A change confined to a fence delimiter row (e.g. ```` ```js ```` →
  ```` ```python ````) is attributed somewhere the user can read it, not to a
  row whose text `Decoration.replace` has hidden and which therefore looks
  blank. Whichever rule is chosen (mark the delimiter row visibly, or attribute
  to the card's first visible line) is stated in the code citation.
- Edits to an image line, and adding or removing a whole image line, mark that
  line without the `ImageWidget` replacement swallowing the marker, and the
  image itself still renders (no broken or duplicated widget while the diff
  is on).
- Whole-block adds and removals are marked coherently: adding a fenced block,
  a table or an image marks the added lines; removing one leaves a single
  deletion marker at the surviving anchor line, not a marker per removed line.
- Editing inside a gridded table's cells marks the affected row(s) and does
  not corrupt the grid's own line decorations (`.mm-table-mode-line`) or its
  padding/geometry.
- Toggle mechanics are unchanged: the View-menu "Changes Since Save"
  checkbox stays edit-mode-only, resets per document on open, is never
  persisted, and saving empties both sets. `tests/unit/menu-spec.test.ts`
  (U34) and `tests/unit/app-menu.test.ts` (U350) stay green and unmodified.
- Both builds behave identically: nothing added is desktop-only or
  hosted-only — the rendering stays in the `@marky-mark/editor` package
  behind its existing props, with no reverse import into app code (the
  validate boundary step enforces this).

**Regression coverage (step 3 of the issue)**

- Unit tests cover the pure seams for each new rule (the diff sets, and the
  canonical↔raw line mapping): added in `editor/tests/` next to the modules
  (`editor/tests/diff-lines.test.ts` holds U30 today). Note that the root
  `npm run test:unit` collects `tests/unit/**` only, so editor-package tests
  are run with `npm test --prefix editor` — both suites pass.
- E2E tests cover the rendering per construct in the desktop shim, asserting
  the `.mm-diff-changed` / `.mm-diff-deleted-after` classes land on the right
  lines for: an edit below a gridded table, an edit inside a code card, an
  image line, and an unedited document (no decorations). SPEC16's current
  e2e coverage does not reach the diff overlay at all — the issue's "E175/E176
  area" is actually the reading-position pair in
  `tests/e2e/tabs-and-workspace.spec.ts`; grep confirms no existing test
  asserts `mm-diff`.
- New test IDs are unique and above the current high-water marks (E493,
  U1190); validate's test-ID uniqueness step passes.
- No existing test is modified, weakened, skipped, or deleted.

**Repo hygiene and verification**

- Every behavioural change carries a `// SPEC16 §2: …` citation comment in the
  house format (`.sandcastle/CODING_STANDARDS.md`).
- `docs/MAP.md` is regenerated with `npm run map` if the SPEC16 file set
  changed (validate's "docs/MAP.md up to date" step passes), and any CSS
  touched satisfies the style-lint step / `docs/STYLE-GUIDE.md`.
- Iteration used `npm run typecheck` + `npm run test:unit` (plus
  `npm test --prefix editor` and targeted `npx playwright test -g '<title>'`
  runs for the tests being written); the full gate was **not** run as a
  start-of-attempt baseline and not after every change.
- `npm run validate:quick` has been run ONCE at the end, in the implementer's
  session, and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #264, carrying the
  failure-mode catalog above and the validate:quick evidence.

## Context

The feature is SPEC16 §2. Three sites own it: `src/App.tsx:5716` (the
debounced `diffLineSets(savedText, canonicalOf(buffer))` effect),
`editor/src/lib/diffLines.ts` (the pure line-set seam, diff-match-patch line
mode) and `editor/src/components/Editor.tsx:724` (`diffDecorations`, swapped
through a compartment at ~:2257). Styling is
`editor/styles.css:685` (`--mm-diff-changed-bg`, `--mm-diff-removed`).

The block widgets it collides with: `editor/src/components/codeBlockView.ts`
(fence cards — line decorations plus `Decoration.replace` hiding the
delimiter rows), `editor/src/components/imageView.ts`
(`Decoration.replace` with an `ImageWidget` over the image ref),
`editor/src/components/tableMode.ts` (grid spans, `canonicalizeAll`,
`canonicalLineAt`), and `editor/src/components/diagramView.ts` (the one
`block: true` widget — check it too).

The strongest suspect is the canonical-vs-raw coordinate mismatch: issue #260
hit the same drift from the other direction and added `canonicalLineAt`; its
header comment explains why raw lines below a grid are ahead of canonical
ones. Fix the arithmetic in one place if you can.

Fixtures live in `fixtures/` (`adversarial.md` already mixes constructs);
e2e helpers of interest are `openGridDoc`, `dirtyActiveDoc`, `menuClick`,
`fsWrite`, `editorTopGutterLine` in `tests/e2e/helpers.ts`. Candidate homes
for the new e2e tests are `tests/e2e/editor.spec.ts` or `live-preview.spec.ts`.
Per the issue's sequencing note, #269's code-block syntax colouring may land
first — validate the overlay against the code-block rendering as it exists on
this branch.
