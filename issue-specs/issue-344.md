# Spec: Editor highlights and comment marks fail in code blocks, inline code, emphasis, and grid-view tables; grid-cell selections cannot be highlighted (#344)

## Goal

All acceptance criteria in issue-specs/issue-344.md are satisfied for issue
#344, with evidence visible in the session: a new e2e fixture document carrying
every context in issue Req 1 (prose, bold, italic, strikethrough, inline code,
labelled and unlabelled fences, blockquote, bullet/numbered/task items, heading,
link text, a table cell with the grid view on and off, a callout body) paints
every stored highlight and comment as a `.mm-hl[data-cid]` decoration in
`.cm-content` over exactly its anchored visible text — with live preview off
and on, and with the caret inside each range — the tint is visible on top of
`--mm-code-bg` for inline code and fence bodies (the SPEC23 §3 `.mm-code-sel`
nesting applied to `.mm-hl`), a selection inside a grid-view table cell turned
into a highlight or comment anchors to the canonical file text and shows in
both editor and preview after a reload, no existing highlight/comment test is
weakened, `npm run validate:quick` passes in the implementer's session, and a
summary comment from the implementer exists on issue #344.

## Acceptance criteria

### Painting: every context paints its full visible extent (issue Reqs 1, 2, 6)

- A committed e2e fixture document (suggested: a `SOURCE` constant in
  `tests/e2e/comments.spec.ts` next to `SYNTAX_SOURCE`, or a file under
  `fixtures/` if it must be shared) contains every context named in issue
  Req 1: plain prose, `**bold**`, `*italic*`, `~~strikethrough~~`,
  `` `inline code` ``, a labelled fence (```` ```ts ````) and an unlabelled
  fence, a blockquote, a bullet item, a numbered item, a task item, a heading,
  link text, a GFM table, and a `> [!NOTE]` callout body. Each context carries
  one highlight record and one comment record in its `<doc>.comments.json`
  sidecar (same shape `seedSyntaxDoc` writes: rendered-text `exact` with
  `prefix`/`suffix`), so every context is a distinct `data-cid`.
- With that document open in **plain edit** (the `set-split-edit` checkbox
  off) and in **split edit** (the default), every record's `.mm-hl[data-cid]`
  exists in `.cm-content` and its joined `textContent` equals the visible
  source text of the anchored range (the `expectSyntaxPaint` assertion shape:
  first through last visible character; hidden-but-in-range syntax such as a
  closing `**` may ride along, syntax before/after the range does not). A
  highlight carries its `data-color`; a comment record carries none.
- The same assertions hold with the PRD 006 live-preview setting on
  (`editor-live-preview` checkbox), where `*`, `_`, backticks and fence lines
  are `Decoration.replace`d: a range that begins or ends at hidden syntax
  (`livePreview.ts` HIDE, `linkView.ts`, `codeBlockView.ts` fence lines,
  `calloutView.ts` label) paints over exactly the visible characters it covers.
  The implementer verifies rather than assumes how CodeMirror splits a mark
  around a replaced range; if the current behaviour is already correct, the
  test is still added as the pin.
- With the caret placed inside each annotated range (the syntax revealed by
  live preview / the fence card / the link view), the mark still covers the
  same visible text — one assertion per context, after `caretInto` or a click
  into the range.
- Active, flash and ghost states keep working: activating the comment card
  for at least the inline-code, fence-body and grid-cell records lands
  `.mm-hl.active` and `.mm-hl.flash` on the decoration (the E590 tail), and a
  resolved comment in a fence body renders `.mm-hl.ghost`.

### Code backgrounds: the tint paints above `--mm-code-bg` (issue Req 3)

- Over inline code (`.mm-md-code` from the SPEC23 §3 highlighter at
  `Prec.high`, and PRD 006's `.mm-lp-code`) and over fence bodies (the
  highlighter's `.mm-md-code` for unlabelled fences; `codeBodyMark` for mounted
  labelled fences, Editor.tsx ~L644; the issue #122 `mm-code-*` token spans at
  `Prec.highest`), the `.mm-hl` span is nested INSIDE the code span so its
  background paints above the code background and below the code text —
  the SPEC23 §3 / issue #123 `.mm-code-sel` treatment (`Prec.highest` on the
  decoration source, or an equivalent explicit precedence), cited as such.
  Code text stays readable: the tint strengths are unchanged (42% / 60% /
  ghost 27%, `editor/styles.css` ~L829–L872).
- An e2e assertion proves the tint is visible over a fence body and over an
  inline code span in the Crisp theme (`settings-theme-light` = `crisp`) and
  in one dark theme (`settings-theme-dark`, e.g. `one-dark`): the resolved
  `background-color` of the `.mm-hl` element inside the code span is the
  highlight tint (not transparent), and the `.mm-hl` element is a descendant
  of the `.mm-md-code` / `.mm-lp-code` / `mm-code-*` element (DOM nesting
  assertion), or an equivalent screenshot-free check the implementer
  documents in the test.
- The SPEC23 §3 selection tint (`.mm-code-sel`, E-tests for issue #123) and
  the issue #122 fence colouring keep their existing tests green; the new
  nesting does not double a translucent theme's `--mm-code-bg`.

### Grid view: marks paint inside table cells (issue Reqs 1, 4)

- With `tableGridView` on (its default), a highlight or comment whose anchor
  lies inside a table cell paints in the editor over the cell's display text.
  Today `canonToDocOffset` (Editor.tsx ~L953) returns `null` for any offset
  inside a grid span and `docHighlightRanges` skips the record; the new
  mapping resolves a canonical offset inside a span to its display position
  through the span's `parseDisplay` / `layoutTable` / `displayPosOf` map
  (`editor/src/lib/tableEdit.ts`) — cell, content offset — so the range lands
  on the cell fragment(s) that show that text. A range that word-wraps across
  continuation lines of one cell paints each fragment's visible characters
  (never the padding, pipes, separator lines or the `↩` marker). A canonical
  range that cannot be placed confidently (e.g. spanning two cells) is still
  skipped, never painted at a wrong position — the PRD 022 Req 12 skip rule
  stands and is restated in the citation comment.
- The mapping is pure and unit-tested: a new or extended `editor/tests/`
  test (repo-wide `U<n>` register; **the current maximum is U1349**, so new
  tests begin at U1350) pins canonical→display for: an offset before the
  first table (identity), inside a cell on the first display line, inside a
  wrapped continuation fragment, on a cell boundary, and after a table
  (shifted by the span delta). If the implementer extracts
  `canonToDocOffset` into `editor/src/lib/` to test it, the extraction keeps
  Editor.tsx behaviour identical.
- With `tableGridView` off (`settings-table-grid` unchecked), the same table
  records paint over the raw pipe-table text — the existing identity path,
  now pinned by a test.

### Grid view: a cell selection can be highlighted or commented (issue Reqs 4, 5)

- Selecting text inside a grid cell (SPEC39 §2.1 already clamps a ranged
  selection to one cell's `contentStart..contentEnd`, `tableMode.ts`
  `alignFilter`) and invoking Highlight or Comment — the Smart Edit menu rows
  (`smartEditAnnotation(page, 'highlight', 'hl-yellow')` /
  `('comment', 'insert-comment')`) and the hotkeys (`Control+Alt+H`,
  `Control+Alt+M`) — creates a record anchored to the **canonical** file text.
  The `AnnotationSelection` the package reports (`annotationSelection`,
  Editor.tsx ~L1517) carries raw grid-form `text` and offsets today, so
  `mapSourceRangeToRendered` (`src/lib/annotationMenu.ts`) sees padded cell
  text; the fix maps display→canonical before anchoring — either the seam
  reports canonical text and canonical offsets (the `canonicalText` /
  `canonicalizeAll` collapse, with the selection mapped through the same
  span math as painting), or the App canonicalizes with the offsets mapped
  — and the chosen seam is cited (PRD 023 §7/§19 plus this issue).
- Round trip: after the highlight is created in a grid cell, `menuSave` then
  a reload (`page.goto` the same `#open=` path) shows the record painted in
  the editor over the cell text (grid on) AND as `mark.hl` over the cell text
  in the preview; the sidecar's `anchor.exact` equals the selected cell text
  with no pipes, padding, or `↩`.
- A selection that would span a cell boundary is clipped to one cell by the
  existing SPEC39 §2.1 filter; a test pins that Highlight on such a selection
  creates exactly one record whose `exact` is within one cell, never a broken
  anchor. If the implementer finds a path where the clamp does not apply
  (e.g. `selectRangeRef` host selections), Highlight/Comment is disabled for
  that selection (`annotationMenuModel` returns no anchor) rather than
  mis-anchoring.
- Grid view off: the same cell selection → Highlight → reload assertions
  hold over the raw pipe table.

### Non-regression and scope (issue Req 7)

- No change to the anchoring format, `src/lib/commentFormat.ts`,
  `embedded.ts`, `sidecar.ts`, `docs/COMMENT-FORMAT.md`, or the preview's
  mark rendering. `git diff --stat` in the implementer's comment shows none
  of those files touched.
- Every existing highlight/comment e2e test (E424, E426, E440, E445, E562,
  E563, E590–E593 and the rest of `tests/e2e/comments.spec.ts`), the SPEC23
  §3 selection-tint tests, the issue #122 fence colouring tests, the SPEC40
  grid tests (`tests/e2e/tables.spec.ts`) and the live-preview suite stay
  green and unmodified (no test weakened, renumbered, skipped or deleted).
- New e2e tests use the next unused `E<n>` numbers (**the current maximum is
  E607**, so new tests begin at E608), titles start with the ID, `describe`
  / titles name the contract (`issue #344`, plus the SPEC/PRD section), and
  setup goes through `tests/e2e/helpers.ts` (`fsWrite`, `openGridDoc`,
  `caretInto`, `smartEditAnnotation`, `openCommentsPane`, `menuSave`,
  `openSettings`/`saveSettings`) rather than re-implemented.
- Every new or changed behaviour carries the citation comment the repo
  requires (`// SPEC23 §3: …`, `// PRD 022 Req 12: …`, `// SPEC40 §2: …`,
  `// PRD 023 §19: …`, each naming issue #344 where the behaviour is new),
  per `.sandcastle/CODING_STANDARDS.md`. No `console.*` in `src/` or
  `editor/src/`; `editor/` imports nothing from `src/` (the boundary check
  in the quick gate).
- If a citation moved between files, `npm run map` has been run and the
  regenerated `docs/MAP.md` is committed (the quick gate diffs it).

### Verification

- Iteration used `npm run typecheck` and `npm run test:unit` (or a targeted
  `npx vitest run editor/tests/<file>` / `tests/unit/<file>`) after each
  change, and single e2e tests via `npx playwright test -g '<title>'` — not
  the full gate after every edit, and no full-gate baseline at the start of
  the attempt (baseline with the quick tier only, if at all).
- `npm run validate:quick` has been run **ONCE**, at the end, in the
  implementer's session, and prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #344, naming the
  root cause found for each of the four observed failures (fence, inline
  code, emphasis, grid), the files changed, the new E and U numbers, the
  untouched-files diff-stat check, and the gate result.

## Context

Verified pipeline (read these before touching anything):

- **Records → editor paint.** `mapHighlightsToSource` (`src/lib/anchoring.ts`
  ~L269) locates each record's rendered `exact` in the canonical source's
  visible text (`visibleIndex` / `stripInline` in
  `editor/src/lib/selectionMap.ts`: emphasis markers, backticks, link syntax
  stripped; fence bodies verbatim; fence delimiter lines empty) and yields
  canonical offsets. The App debounces this 200ms into `editorHighlights`
  (`src/App.tsx` ~L6371) and passes `HighlightRange[]` to the package.
  `docHighlightRanges` (Editor.tsx ~L978) maps canonical→editor-doc through
  the grid set and `highlightDecorations` (~L1047) emits `.mm-hl` marks at
  **default precedence** in `hlComp` (~L2641). E590 proves marks already
  paint across `**`, backticks and a hidden `](url)` with live preview off.
- **Why code hides the tint.** `.mm-md-code` comes from the SPEC23 §3
  highlighter (`Prec.high`) and `.mm-lp-code` from the live-preview plugin;
  both paint opaque-ish `--mm-code-bg`. CodeMirror nests the
  lowest-precedence mark outermost, so the default-precedence `.mm-hl` wraps
  the code span and the code background paints on top. SPEC23 §3 / issue
  #123 solved this for the selection with `codeSelectionExt` at
  `Prec.highest` (Editor.tsx ~L585–L620, CSS ~L488–L497). The fence card
  chrome (`.mm-fence-card::before`, z-index −3) is NOT the culprit; the
  `.mm-md-code` span over `CodeText` (or `codeBodyMark` for mounted fences)
  is.
- **Why the grid skips.** `canonToDocOffset` (Editor.tsx ~L945–L966)
  deliberately returns `null` inside a grid span ("the grid's padded lines
  have no honest per-character home"). The honest home exists: each span's
  display is `layoutTable(model, width)` → `DisplayMap.fragments`
  (`row`, `col`, `contentOffset`, `from`/`to` relative to the span), and
  `displayPosOf` / `displayCellBounds` / `parseDisplay` in
  `editor/src/lib/tableEdit.ts` are the inverse tools. Canonical cell text is
  `serializeCompactTable` / `canonicalizeAll` output (`tableMode.ts` ~L298);
  cell whitespace normalizes to single spaces in the display and
  continuation fragments join with a space unless the `↩` `HARD_BREAK`
  marker ends the fragment.
- **Why a grid selection cannot be highlighted.** `annotationSelection`
  (Editor.tsx ~L1517) reports raw grid-form `text` + raw offsets to the App;
  `resolveAnnotationModel` (App.tsx ~L7371) feeds them to
  `mapSourceRangeToRendered` (`src/lib/annotationMenu.ts` ~L39), whose
  comment already says "a range inside a table grid simply fails to map
  (disabled, never mis-anchored)". SPEC39 §2.1 (`alignFilter`, tableMode.ts
  ~L154) already clamps ranged selections to one cell, so cross-cell anchors
  are prevented at the selection layer.
- **Tests to copy.** `seedSyntaxDoc` / `SYNTAX_PAINT` / `expectSyntaxPaint`
  and E590–E593 in `tests/e2e/comments.spec.ts` (~L2150–L2300) are the
  pattern for fixture-plus-sidecar seeding and joined-textContent paint
  assertions; `openGridDoc` (`helpers.ts` ~L718) opens a gridded doc in edit
  mode; `tests/e2e/tables.spec.ts` shows grid-cell caret placement and the
  `settings-table-grid` toggle. Unit patterns: `tests/unit/anchoring.test.ts`
  (mapHighlightsToSource), `tests/unit/annotation-menu.test.ts`,
  `editor/tests/selection-map.test.ts`. Unit suite runs with
  `isolate: false`; restore any global state.
- **Defaults that matter for tests:** `livePreview: false`,
  `tableGridView: true`, `codeBlockView: true`, `splitEdit: true`,
  `editorHighlights: true` (`src/lib/settings.ts` ~L223–L245). Test ids:
  `set-split-edit`, `editor-live-preview`, `settings-table-grid`,
  `settings-theme-light`, `settings-theme-dark`, `smart-edit-menu`,
  `comment-card`, `composer-input`.
- **Boundary.** `editor/` must not import from `src/`; any new seam is a
  prop or exported helper on the package side (`editor/AGENTS.md`). Keep the
  blast radius to `editor/src/components/Editor.tsx`, `editor/src/lib/`,
  `editor/styles.css` (nesting only, tokens unchanged), `src/App.tsx` /
  `src/lib/annotationMenu.ts` for the canonical selection seam, and tests.
