# Spec: rendering of code blocks selection (#355)

## Goal

All acceptance criteria in issue-specs/issue-355.md are satisfied for issue
#355, with evidence visible in the session: with the caret on an editor line
that holds an inline code span or a fenced-code body line, the code span on
that `.cm-activeLine` line paints the `--mm-active-line` caret-line tint
layered over its `--mm-code-bg` (computed `background-image` is a
`linear-gradient` of the token's colour, `background-color` stays the code
background) while the same span on a non-caret line has
`background-image: none`; this holds in raw highlighting, live preview
(the revealed caret line), the SPEC40 table grid and the issue #157 fence
card alike; the SPEC23 §3 selection tint over code (E261) is unchanged; a
new `E<n>` test pins the contract and SPEC44 §2.1 is amended;
`npm run validate:quick` passes in the implementer's session; and a summary
comment from the implementer exists on issue #355.

## Acceptance criteria

### What the issue actually shows (read this first)

The screenshot in the issue is the editor with the caret parked inside
`` `MM_LLM_BASE_URL` `` on a raw (non-gridded, soft-wrapped) GFM table row and
NO ranged selection: the blue band across that row and its wrapped
continuation is the SPEC44 §2.1 caret-line tint (`.cm-activeLine`, painted
through `--mm-active-line`), and the code span sits on it as an untinted box
because `.mm-md-code`'s (usually opaque) `--mm-code-bg` paints above the
line's own background. The line above is a live-preview rendered row
(backticks and `**` hidden), unselected. Reproduced on this branch with the
crisp theme, caret on such a line: the line computes
`color(srgb 0.0352941 0.411765 0.854902 / 0.1)` and the `.mm-md-code` span on
it computes `background-color: rgb(246, 248, 250)` with `background-image:
none` — in prose, in a table row, and on a fence body line, with live
preview off and on. The RANGED selection tint over code is not broken:
issue #123's `.mm-code-sel` mark (SPEC23 §3, E261) paints in every mode
tried, including inside table cells and inside the SPEC40 grid (where SPEC39
§2.1 confines a ranged selection to one cell). So the fix is the caret-line
tint, the same layering problem issue #123 solved for the selection.

### Behaviour

- **Caret-line tint over inline code, raw highlighting (defaults).** In edit
  mode with `editorSyntax` on and live preview off, with the caret on a
  prose line holding an inline code span and on a raw GFM table row whose
  cell is an inline code span (`| \`MM_LLM_API_KEY\` | – |`, `tableGridView`
  off so the row stays raw): the `.mm-md-code` span inside
  `.cm-line.cm-activeLine` has computed `background-image` that is a
  `linear-gradient(…)` whose colour is `--mm-active-line`'s resolved value
  (equal to the line's own computed `background-color`), and computed
  `background-color` still equal to `--mm-code-bg` (crisp:
  `rgb(246, 248, 250)`). The same span on a non-caret line has
  `background-image: none` and the unchanged code background. The code text
  colour is untouched (computed `color` equals the code span's colour on a
  non-caret line).
- **Fence body.** With the caret on a body line of a fenced block (fence
  cards on, the default; a `js` fence so issue #122's token spans are
  present): the `.mm-md-code` span on `.cm-line.mm-fence-card.cm-activeLine`
  carries the same layered background; the fence card's `::before` chrome,
  ring and radius are unchanged, and the sibling body lines keep
  `background-image: none`.
- **Live preview on.** With `livePreview` on, the caret line is revealed raw
  (PRD 006 §8), so its code is the highlighter's `.mm-md-code`: the layered
  background holds there exactly as above, and a rendered non-caret line's
  `.mm-lp-code` span keeps `background-image: none` and its code background.
- **Table grid on (default).** With `tableGridView` on and the caret in a
  gridded row's code cell, the `.mm-md-code` span on
  `.cm-line.mm-table-mode-line.cm-activeLine` carries the same layered
  background; the grid wash (`::before` at z-index −3) is unchanged.
- **Token-bound.** The layer reads `--mm-active-line` (fallback
  `rgba(9, 105, 218, 0.1)`, the token's own default) — overriding the token
  on `.theme-root` (the E126 pattern) recolours the code-span layer to the
  override, in step with the line.
- **Selection over code unchanged.** E261 passes as written: a ranged
  selection over inline code or a fence body still yields
  `.mm-md-code .mm-code-sel` nested spans with computed `background-color`
  `var(--mm-selection)` (crisp `rgba(9, 105, 218, 0.18)`, claude
  `rgba(217, 119, 87, 0.35)`), and with the selection head on a code line
  both the caret-line layer and the selection mark paint (the mark inside
  the span). No change to `codeSelectionDeco`, `.mm-code-sel`, or
  `editor/src/lib/codeSelection.ts` is required.
- **No regression on the other line cues.** The SPEC44 §2.1 caret-line tint
  on prose lines, E126's token binding, the fence-card e2e tests
  (`tests/e2e/editor.spec.ts` ~980/1193/1242, `smart-edit.spec.ts` ~665)
  and E327's grid alignment still pass.

### Implementation shape (the intended mechanism)

- A CSS-only fix in `editor/styles.css`, beside the SPEC44 §2.1
  `.editor-wrap .cm-editor .cm-activeLine` rule: a rule targeting
  `.editor-wrap .cm-editor .cm-activeLine .mm-md-code` that sets
  `background: linear-gradient(var(--mm-active-line, rgba(9, 105, 218, 0.1)), var(--mm-active-line, rgba(9, 105, 218, 0.1))), var(--mm-code-bg, rgba(175, 184, 193, 0.2))`
  — the tint as an image layer over the code background, so the caret line
  reads as one continuous band through the code, and the code text paints on
  top unchanged. Specificity must beat `.editor-wrap .mm-md-code` (three
  classes do). Adding `.mm-lp-code` to the selector is harmless but not
  required: a caret line is always a revealed line under PRD 006 §8, so
  `.mm-lp-code` never sits on `.cm-activeLine`.
- The rule carries a citation comment `SPEC44 §2.1 (issue #355): …`
  explaining the layering (mirror the tone of the issue #123 comment on
  `.mm-code-sel`). No `console.*`, no new decoration or tree walk — a
  decoration-based alternative (a `Prec.highest` mark like `.mm-code-sel`
  for code ranges on each head line) is acceptable only if the CSS layer
  cannot meet the criteria; if taken, its class is `mm-code-active` and the
  observable criteria above are restated for it in the test.
- Translucent themes (claude's `--mm-code-bg`) get the line tint through the
  code background AND the layer — the same accepted doubling as
  `.mm-code-sel` (E261's claude branch); no theme file changes.

### Tests and docs

- One new desktop e2e test in `tests/e2e/editor.spec.ts`, ID the next unused
  `E<n>` (E626 as of this spec; re-check with
  `grep -rhoE "'E[0-9]+:" tests | sort -V | tail -1` after merges — IDs are
  never reused), titled `E<n>: issue #355 — caret-line tint paints over
  code …`, covering the raw prose + raw table row, the fence body, live
  preview on, the table grid on, and the token override; it boots through
  the E261 pattern (`fsWrite` + settings.json patch + reload + `#open=`),
  uses `getByTestId('editor')` and the CodeMirror/markdown class locators
  the standards allow, and would fail against the pre-fix build (assert
  `background-image` contains `linear-gradient` and is not `none`). Existing
  tests are not weakened, renamed or skipped.
- `docs/specs/SPEC44.md` §2.1 gains an amendment note (issue #355): the
  caret-line tint is layered over `--mm-code-bg` on code constructs of the
  caret line so the band is continuous through inline code and fence bodies.
- `docs/MAP.md` is regenerated with `npm run map` if the citation set
  changed, so the gate's diff is clean.

### Verification (test economy)

- Iterate with `npm run typecheck` and `npm run test:unit`, plus the one new
  test via `npx playwright test -g 'E<n>'` (and `-g 'E261'`, `-g 'E126'`
  for the neighbours) — not the whole e2e suite per change, and no
  full-gate baseline at the start.
- `npm run validate:quick` has been run ONCE in the implementer's session,
  right before declaring the goal met, and prints
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #355 (what
  changed, the test ID, the gate result).

## Context

- Caret-line tint: `editor/styles.css` `.editor-wrap .cm-editor .cm-activeLine`
  (SPEC44 §2.1, issue #345; `rg 'SPEC44 §2.1'`), token default in
  `src/styles.css` (`--mm-active-line`, accent at 10%), documented in
  `editor/THEMING.md`. CodeMirror's `highlightActiveLine()` adds the class
  to every selection range's head line (Editor.tsx, the `drawSelection()`
  neighbour).
- Code backgrounds: `.editor-wrap .mm-md-code` (`editor/styles.css` ~482,
  SPEC23 §3 highlighter class for `InlineCode`/`CodeText`; also re-asserted
  over mounted fence bodies by `codeBodyMark`), and the live-preview
  `.mm-lp-code` in `editor/src/components/livePreview.ts`'s base theme.
- Precedent for the same layering bug: issue #123's `.mm-code-sel`
  (`editor/src/components/Editor.tsx` ~591 `codeSelectionDeco`,
  `editor/src/lib/codeSelection.ts`, CSS ~488, E261 at
  `tests/e2e/editor.spec.ts` ~700) and issue #344's `.mm-hl` nesting; the
  fence card's `::before` at z-index −3 (`.mm-fence-card`, issue #163) and
  the grid wash (`.mm-table-mode-line`, SPEC40) explain why line-level
  backgrounds sit below the code span.
- Boot/settings pattern for the test: E261 (settings.json patch via
  `window.__mmfs`, `themeLight: 'crisp'`, `splitEdit: false`), E146/E327
  for `livePreview` / `tableGridView`, E126 for overriding
  `--mm-active-line`. Settings keys: `editorSyntax`, `codeSyntax`,
  `livePreview`, `tableGridView` (`src/lib/settings.ts`).
- Rules: `.sandcastle/CODING_STANDARDS.md` (citations, no console, test IDs,
  `editor/` never imports app code — `editor/AGENTS.md`). The app style lint
  covers `src/styles.css` and `src/**/*.tsx`; `editor/styles.css` keeps the
  same discipline by convention (tokens with fallbacks only).
