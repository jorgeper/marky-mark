# Spec: double ticks show in different shade when selected for some reason (#359)

## Goal

All acceptance criteria in issue-specs/issue-359.md are satisfied for issue
#359, with evidence visible in the session: with a ranged selection running
across an inline code span in the editor (raw highlighting, and live
preview's revealed line alike), the two backtick marks carry NO nested
`.mm-code-sel` tint span (`.mm-md-mark .mm-code-sel` count is 0) so they read
in the same shade of `--mm-selection` as the prose and the code text around
them, while the code text between the backticks still carries its nested
`.mm-md-code .mm-code-sel` tint at `var(--mm-selection)` and fenced-code
bodies are unchanged (E261 passes as written); a new `E<n>` test pins the
contract and SPEC23 §3 is amended; `npm run validate:quick` passes in the
implementer's session; and a summary comment from the implementer exists on
issue #359.

## Acceptance criteria

### What the issue actually shows (read this first)

The screenshot (not downloadable from the sandbox) is a selected editor line
holding an inline code span: the two backticks paint in a visibly darker
shade of selection blue than the prose and the code text. Reproduced on this
branch (crisp theme, `splitEdit: false`, doc line ``prose with `inline code`
inside``, whole line selected): the DOM is

```
prose with
<span class="mm-md-mark mm-code-meta"><span class="mm-code-sel">`</span></span>
<span class="mm-md-code"><span class="mm-code-sel">inline code</span></span>
<span class="mm-md-mark mm-code-meta"><span class="mm-code-sel">`</span></span>
inside
```

Cause: `codeSelectionDeco` (`editor/src/components/Editor.tsx`, SPEC23 §3,
issue #123) tints the whole `InlineCode` node, but @lezer/markdown styles
its `CodeMark` children (the backticks) as `tags.processingInstruction`, not
`tags.monospace`, so the highlighter emits them as flat `.mm-md-mark` spans
(opacity 0.7, transparent background) with no `--mm-code-bg`. Over the
backticks nothing hides CodeMirror's drawn selection layer, so the layer
shows through AND the nested tint paints on top at 0.7 opacity: two tints
where prose and code text get exactly one. Fenced code is not affected:
`CodeText` never includes the fence's `CodeMark` lines.

### Behaviour

- **Backticks are not re-tinted.** In edit mode with `editorSyntax` on
  (default), after selecting a whole line that holds an inline code span
  (E261's `selectLine` pattern), `editor.locator('.mm-md-mark .mm-code-sel')`
  has count 0, and no `.mm-code-sel` span's text is a backtick. The
  backticks are still rendered as `.mm-md-mark` spans (dimmed punctuation,
  SPEC23 §3.2 unchanged) and still lie inside the drawn selection, so they
  show the one selection layer, same as the surrounding prose.
- **Code text still tinted.** On the same line,
  `.mm-md-code .mm-code-sel` exists, its joined text is exactly the code
  content between the backticks (`inline code`), and its computed
  `background-color` is `--mm-selection` (crisp `rgba(9, 105, 218, 0.18)`).
  Its computed `color` equals its parent's (legibility, as E261 asserts).
- **Partial selections.** A selection that starts inside the code text and
  ends after the closing backtick, and one that covers only the opening
  backtick plus the first characters of the code, each tint only the
  selected part of the code text (never a backtick): the tinted text is the
  intersection of the selection with the content between the marks.
- **Double-backtick spans.** An inline code span written with a two-backtick
  fence (``` `` a ` b `` ```) behaves the same: no `.mm-code-sel` over any
  `CodeMark` run, the content (including its inner single backtick) tinted.
- **Live preview on.** With `livePreview` on, a selected line is revealed raw
  (PRD 006 §8), so the same assertions hold on that line; a rendered
  non-selected line's `.mm-lp-code` span is unchanged.
- **Fences unchanged.** E261 passes as written: selecting a fence body line
  still yields `.mm-md-code .mm-code-sel` whose joined text is the body, at
  `var(--mm-selection)` (claude `rgba(217, 119, 87, 0.35)`), in the full
  editor and the split pane; the fence's ``` lines never carried the tint
  and still do not.
- **Collapse.** Collapsing the selection removes every `.mm-code-sel`.

### Implementation shape (the intended mechanism)

- Fix the range, not the CSS: in `codeSelectionDeco`
  (`editor/src/components/Editor.tsx`), when the tree walk enters an
  `InlineCode` node, push the range BETWEEN its `CodeMark` children (the
  text after the opening run and before the closing run —
  `n.node.getChildren('CodeMark')`, the pattern `livePreview.ts` already
  uses for fences) instead of `n.from..n.to`; `CodeText` stays as is. The
  tint then exists only where an opaque `--mm-code-bg` hides the drawn
  layer, which is the whole point of issue #123. A CSS rule zeroing
  `.mm-md-mark .mm-code-sel` is NOT acceptable: it leaves the dead span in
  the DOM and keeps painting the tint at 0.7 opacity under future rules.
- If the trimming is written as a pure helper in
  `editor/src/lib/codeSelection.ts` (e.g. a range-minus-marks function fed
  to `intersectCodeSelection`), it gets a unit test in
  `editor/tests/code-selection.test.ts` with the next unused `U<n>` (U1427
  as of this spec; re-check with
  `grep -rhoE "'U[0-9]+:" tests editor/tests | sort -V | tail -1`). If the
  trimming stays inside the tree walk, no unit test is required; the e2e
  test carries the contract.
- The changed lines carry a citation `SPEC23 §3 (issue #359): …` explaining
  why the marks are excluded (they have no code background; tinting them
  doubles the drawn layer). No `console.*`; `editor/` imports nothing from
  the app (`editor/AGENTS.md`).
- No theme file, token or `src/styles.css` change. `.mm-md-mark`'s
  `opacity: 0.7` and `.mm-code-sel`'s rule in `editor/styles.css` stay as
  they are.

### Tests and docs

- One new desktop e2e test in `tests/e2e/editor.spec.ts`, next unused `E<n>`
  (E655 as of this spec; re-check with
  `grep -rhoE "'E[0-9]+:" tests | sort -V | tail -1` after merges — IDs are
  never reused), titled `E<n>: issue #359 — selection over inline code
  leaves the backtick marks untinted …`, booting via `bootEditorOn` with
  `{ splitEdit: false, themeLight: 'crisp' }` (the E261 pattern), using
  `getByTestId('editor')` plus the CodeMirror/markdown class locators the
  standards allow. It covers the whole-line selection, a partial selection,
  the double-backtick span, and live preview on, and it fails against the
  pre-fix build (pre-fix `.mm-md-mark .mm-code-sel` count is 2). E261 and
  U675 are not weakened, renamed or skipped.
- `docs/specs/SPEC23.md` gains an `## Amended by issue #359 (<date>)`
  section in the style of the issue #357 one: §3's selection tint covers
  the code text of an inline code span only, never its `CodeMark`
  backticks, which have no code background and would otherwise be tinted
  twice.
- `docs/MAP.md` is regenerated with `npm run map` if the citation set
  changed, so the gate's diff is clean.

### Verification (test economy)

- Iterate with `npm run typecheck` and `npm run test:unit` (or
  `npx vitest run editor/tests/code-selection.test.ts`), plus the one new
  test via `npx playwright test -g 'E<n>'` and `-g 'E261'` — not the whole
  e2e suite per change, and no full-gate baseline at the start of the
  attempt.
- `npm run validate:quick` has been run ONCE in the implementer's session,
  right before declaring the goal met, and prints
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #359 (what
  changed, the test ID, the gate result).

## Context

- Tint machinery: `editor/src/components/Editor.tsx` `codeSelectionDeco` /
  `codeSelectionExt` (Prec.highest, `rg 'issue #123' editor/src`), pure half
  `editor/src/lib/codeSelection.ts` (`intersectCodeSelection`, U675 in
  `editor/tests/code-selection.test.ts`), CSS `.editor-wrap .cm-content
  .mm-code-sel` and `.editor-wrap .mm-md-mark` in `editor/styles.css`
  (~495 and ~548), E261 at `tests/e2e/editor.spec.ts` ~706.
- Grammar facts: `@lezer/markdown` styles `"InlineCode CodeText"` as
  `tags.monospace` (→ `mm-md-code`) and `CodeMark` as
  `tags.processingInstruction` (→ `mm-md-mark`, also matched by issue
  #122's `tags.meta` → `mm-code-meta`); highlighter spans are flat, so a
  backtick span never sits inside a `.mm-md-code` span. `CodeMark` children
  of `InlineCode` are the opening and closing backtick runs; the
  `getChildren('CodeMark')` walk is in `editor/src/lib/livePreview.ts` ~359.
- Precedents for the same layering family: issue #344's `.mm-hl` comment
  tint and issue #355's caret-line layer (`issue-specs/issue-355.md`) — both
  nest inside the code span; neither needs changing here.
- Rules: `.sandcastle/CODING_STANDARDS.md` (citations, no console, test IDs
  and never-weakened tests, `getByTestId` first), `editor/AGENTS.md`
  (package boundary). Settings keys for the test: `editorSyntax`,
  `livePreview` (`src/lib/settings.ts`); helpers `bootEditorOn`, `freshApp`
  in `tests/e2e/helpers.ts`.
