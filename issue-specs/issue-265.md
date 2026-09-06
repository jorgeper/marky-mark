# Spec: Code blocks: keep the copy button visible while the cursor is inside, not hover-only (#265)

## Goal

All acceptance criteria in issue-specs/issue-265.md are satisfied for issue
#265, with evidence visible in the session: in the edit pane a fenced code
block that holds the main selection shows its copy control steadily — no
pointer needed — from the moment the caret lands in it until it leaves, the
revealed (raw-fence) state included; hover reveal for every other block is
unchanged and the preview pane's own button is untouched; the persistent
button neither moves document text, dirties the document, disturbs the
Changes-Since-Save overlay (#264) nor collides with the smart-edit cursor-line
icon (#263); a numbered e2e regression test covers the cursor-inside state;
`npm run validate:quick` has been run in the implementer's session and passed;
and a summary comment from the implementer exists on issue #265.

## Acceptance criteria

- With the fenced-code card view on (`codeBlockView`, default `true`) and the
  caret placed anywhere inside a fenced code block in the edit pane, that
  block's copy control is visible (`opacity: 1`, `pointer-events: auto`) with
  the pointer nowhere near it, and stays visible for as long as the selection
  stays in the block.
- "Inside" is the same rule the card view already uses for caret reveal
  (`computeCodeCards` in `editor/src/lib/codeBlockSpans.ts`: the main
  selection's head within the `FencedCode` node, both boundaries inclusive), so
  at most one block carries the persistent state at a time and a selection
  dragged from prose into a block counts as inside. If the implementation picks
  a different rule (e.g. head-or-anchor), it is stated in the citation comment
  and covered by a test.
- The control is present at all while the caret is inside. Today
  `buildDecorations` in `editor/src/components/codeBlockView.ts` skips the
  copy widget entirely for a `revealed` card (`if (!card.revealed)`), so a
  revealed block currently has no button to show — the fix must render it for
  the cursor-inside block too, anchored on the card's first line exactly where
  it sits on a rendered card (top-right, `top: 8px; right: 8px`).
- Moving the caret out of the block returns that block to the old hover-only
  behaviour: at rest its button is `opacity: 0` / `pointer-events: none` again.
- Hover behaviour for other blocks is unchanged — pointing at any card still
  reveals that card's button via the `is-hover` walk (`setHoveredCard`), and
  keyboard focus (`:focus-visible`) and the `is-copied` confirmation still
  reveal it as before.
- The persistent state and the hover state do not clobber each other: with the
  caret in block A and the pointer over block B, both buttons are visible.
  (Note the trap: `setHoveredCard` toggles `is-hover` off on every other
  button on each pass, so the persistent state must be expressed as its own
  class/decoration, not by reusing `is-hover`.)
- Clicking the persistent button copies the same text the hover button does —
  the block's interior lines only, no fence delimiters and no info string, one
  implied trailing newline off (`card.body` + `codeBlockText`) — whether the
  block is rendered or revealed, and it confirms with the usual "Copied" state.
- The click stays inert chrome: it does not move the caret, does not change
  the selection, does not dispatch a transaction, and does not dirty the
  document (no `dirty-dot`); the file on disk is unchanged.
- The document text is byte-identical with the button present — it still holds
  no text node (label is `::after` content), so comment anchors and
  `getDocText()` offsets are unaffected.
- Position and styling are unchanged: this is purely a visibility-state change.
  The card's own 16px text inset, the card ring/rounded corners, line heights
  and the caret's glyph alignment are all untouched, and the fence text on a
  revealed card does not reflow or shift when the button appears.
- No fight with issue #263: with the caret on a card line the smart-edit button
  keeps the geometry that issue established (`.cm-line.mm-fence-card
  .smart-edit-btn { right: calc(var(--mm-smart-edit-gap) +
  var(--mm-fence-inset)) }` in `editor/styles.css`) — it stays left of the
  card and its box does not overlap the copy button's box. `E490` in
  `tests/e2e/smart-edit.spec.ts` still passes unmodified.
- No fight with issue #264: with the Changes Since Save overlay on and the
  caret inside an edited code block, the persistent button is visible, the
  changed-line tint and the card chrome still render correctly, and the
  diff-overlay suite (`tests/e2e/diff-overlay.spec.ts`, E496/E497/E501)
  still passes unmodified.
- The preview pane is untouched: `.doc .mm-copy-code` keeps its
  hover / `focus-within` / `is-copied` reveal, and split-view tests that scope
  `mm-copy-code` to the preview root still find exactly one match.
- With `codeBlockView` off, nothing changes — no cards and no copy control in
  the edit pane, as today.
- The change lives entirely in the `editor/` package
  (`editor/src/components/codeBlockView.ts` and/or
  `editor/src/lib/codeBlockSpans.ts`, plus `editor/styles.css`) with no import
  from `src/` and no desktop-only or hosted-only branch, so it applies to both
  builds as the issue's "Build applicability: both builds" line requires. The
  editor-package-boundary check in `scripts/validate.mjs` passes.
- The existing card tests still pass in substance: `E309` and `E317`
  (`tests/e2e/editor.spec.ts`) may gain assertions but their existing
  expectations — caret reveal, hover reveal from `opacity: 0`, body-only copy
  text, fence text selectable by drag and double-click on a revealed row — must
  not be relaxed, and `editor/tests/code-block-spans.test.ts` /
  `editor/tests/code-copy.test.ts` keep passing.
- A new numbered e2e regression test (next free number: `E527`) in
  `tests/e2e/editor.spec.ts` asserts the cursor-inside behaviour and fails
  against the pre-fix code: caret into a code block ⇒ button visible with no
  hover, caret out ⇒ button hidden again, hover on another block still works,
  and clicking the persistent button copies the body without dirtying the
  document.
- If a pure predicate/span change is added under `editor/src/lib/`, it carries
  a unit test on the repo-wide `U<n>` register (next free number: `U1222`) in
  the matching `editor/tests/` file.
- Changed/added behaviour carries the repo's citation comments
  (`// Issue #265: <what and why>` per `.sandcastle/CODING_STANDARDS.md`, the
  style `codeBlockView.ts` already uses for issues #157/#163), and
  `docs/MAP.md` is regenerated with `npm run map` if the citation/test set
  changed, so the validation gate's MAP diff passes.
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (or a single targeted Playwright test, `npx playwright test -g '<title>'`)
  rather than the full suite, and ran the full gate only once at the end — not
  as a starting baseline (baseline with the quick tier only).
- `npm run validate:quick` has been run in the implementer's session and
  printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #265 describing the
  visibility rule chosen, how the revealed-card case is handled, and the
  regression test.

## Context

The edit pane's control is issue #163's `CardCopyWidget` in
`editor/src/components/codeBlockView.ts`: an inline widget at `card.from`
(side `-1`) on the card's first line, class/testid `mm-copy-code-editor`,
built by `createCopyButton` in `editor/src/lib/codeCopy.ts` (shared with the
preview's `mm-copy-code`). `buildDecorations` there omits the widget when
`card.revealed` is true — that is the main thing to change, since a caret
inside the block *is* the revealed state. Reveal itself is computed in
`computeCodeCards` (`editor/src/lib/codeBlockSpans.ts`), which already returns
`revealed` and the `body` span the button copies, so the cursor-inside signal
is available without new plumbing. Visibility is CSS: `.editor-wrap
.mm-copy-code-editor` is `opacity: 0` at rest and lit by `.is-hover`
(set by the `setHoveredCard` walk), `:focus-visible` and `.is-copied` in
`editor/styles.css` (~line 1026) — add one more lit state rather than
touching position or styling. Follow `docs/STYLE-GUIDE.md` for any new CSS.

The card lines are `.cm-line.mm-fence-card{,-first,-last}`; the smart-edit
override for those lines (issue #263) sits just above the copy-button rules in
`editor/styles.css`. Existing e2e coverage to read first: `E317` in
`tests/e2e/editor.spec.ts` (~line 891) for the hover/copy assertions and
`tests/e2e/diff-overlay.spec.ts` for the overlay interaction. Per
`editor/AGENTS.md`, nothing under `editor/` may import from `src/`.
