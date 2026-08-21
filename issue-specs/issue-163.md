# Spec: code block rendering changes (#163)

## Goal

All acceptance criteria in issue-specs/issue-163.md are satisfied for issue
#163, with evidence visible in the session: in the edit pane with
`codeBlockView` on, a selection crossing a rendered fenced-code card paints
above the card instead of showing through behind it, the card's text carries a
left inset, each rendered card offers the preview's hover copy control (body
text only, no fence delimiters), the fence ``` / info-string text is reachable
and selectable with the mouse, `npm run validate:quick` passes in the
implementer's session, and a summary comment from the implementer exists on
issue #163.

## Acceptance criteria

- **Selection paints on top of the card.** With `codeBlockView` on, a selection
  that covers or crosses a rendered fenced code block in the edit pane shows
  its tint *above* the card background over the whole selected region of every
  card line — the code text, the hidden delimiter rows, and the
  run-to-end-of-line part of any line the selection continues past — so a
  selection running from prose into and through the block reads as one
  continuous band. The artefact in the issue image is gone: no selection colour
  is visible only outside/behind the card outline (its rounded corners
  included) while the interior stays untinted. Today
  `.editor-wrap .cm-line.mm-fence-card` (`src/styles.css`, the Issue #157
  block) sets an opaque `--mm-code-bg` on the line, which paints over
  CodeMirror's selection layer, and the only repaint is `.mm-code-sel`
  (`codeSelectionDeco` in `src/components/Editor.tsx`, SPEC23 §3), which covers
  `InlineCode`/`CodeText` character ranges only.
- **Left inset.** Rendered card lines carry a visible left inset so the code no
  longer sits flush against the card's ring, matching the breathing room the
  preview's `.doc pre` has. The card ring and corner radii still draw correctly
  on the first/last/only lines, the caret draws where its glyph is (no offset
  between caret and text), long lines still wrap inside the card, and toggling
  `codeBlockView` in either direction changes no document text and does not
  mark the file dirty.
- **Copy control on the edit-pane card.** Each rendered fenced card in the edit
  pane carries a copy control that behaves like the preview's
  (`decorateCodeBlocks` in `src/lib/codeCopy.ts`, styled `.doc .mm-copy-code`
  in `src/styles.css`): hidden at rest, revealed on hover of the card and on
  keyboard focus, showing a "Copied" confirmation for `CONFIRM_MS` after a
  successful write and staying at rest after a rejected one, with an
  `aria-label` and a stable `data-testid` that does not collide with the
  preview button's (`mm-copy-code`) in the split view — the existing
  `tests/e2e/reading-and-export.spec.ts` assertions that scope `mm-copy-code`
  to `getByTestId('doc')` must still hold.
- **What the copy control copies.** The block's body text exactly as the reader
  sees it — no opening/closing fence delimiters, no info string, and at most
  the trailing-newline handling `codeBlockText` already implements. Reuse that
  helper rather than a second trailing-newline rule.
- **The copy control is inert chrome.** Clicking it does not move or reveal the
  caret, does not flip a block between rendered and raw, does not edit the
  document or set the dirty flag, and does not change what the editor reports
  as its text (undo history untouched). The write goes through the app's
  clipboard seam — `copyToClipboard` in `src/App.tsx` (platform `copyText`,
  falling back to `navigator.clipboard`), threaded into `src/components/Editor.tsx`
  as a prop — not a direct `navigator.clipboard` call inside the extension.
- **The fence text is selectable.** With the card view on, a click or drag on a
  rendered block's hidden delimiter row reveals that block's raw ``` and info
  string and leaves the caret on the line the pointer hit; once revealed, the
  ``` and info-string characters can be selected by mouse drag and by
  double-click, and can be typed over/edited like any other text. Caret reveal
  for other blocks in the document is unchanged (they stay rendered).
- **Nothing else moves.** With `codeBlockView` off the edit pane looks exactly
  as it does today (no card chrome, no inset, no copy control). Preview-pane
  rendering, export (`src/lib/exportDoc.ts`) and print output are
  byte-identical regardless of the setting, comment anchoring is unaffected,
  and the SPEC40 table-grid exclusion and the PRD 013 diagram view keep their
  current behaviour over fences. No new persisted setting is added: all four
  changes ride the existing `codeBlockView`.
- **Unit coverage** exists for whatever pure logic the change adds or extends —
  the span/decoration inputs in `src/lib/codeBlockSpans.ts`, the code-selection
  arithmetic in `src/lib/codeSelection.ts`, or the copy-text helper in
  `src/lib/codeCopy.ts` — added to `tests/unit/code-block-spans.test.ts`,
  `tests/unit/code-selection.test.ts` or `tests/unit/code-copy.test.ts` in the
  existing `U<n>`-titled style (next free number: `U783`).
- **One new Playwright test** in `tests/e2e/` (next free number: `E317`)
  covers the end-to-end behaviour in the style of `E309`: the edit-pane card's
  copy control copies the body without the fence delimiters, a selection across
  a card is tinted over the card, and clicking the delimiter row reveals and
  selects the ``` text.
- New or changed behaviour carries citation comments in the repo's format
  (`docs/COMMENT-FORMAT.md`, `.sandcastle/CODING_STANDARDS.md`); if any
  `SPEC<n>` citations are added or moved, `docs/MAP.md` is regenerated with
  `npm run map` and committed (validate:quick diffs it).
- Iteration used `npm run typecheck` and `npm run test:unit` (or a single
  targeted e2e via `npx playwright test -g '<title>'`); the full gate was run
  ONCE, right before declaring the goal met — not after every change and not as
  a start-of-attempt baseline (baseline with the quick tier only).
- `npm run validate:quick` has been run in the implementer's session and prints
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #163.

## Context

The issue is about the edit pane's fenced-code card view (issue #157), not the
preview: `src/components/codeBlockView.ts` (the ViewPlugin), the pure span core
`src/lib/codeBlockSpans.ts`, the chrome under
`/* ---------- Issue #157: fenced code blocks as cards in the edit pane */` in
`src/styles.css` (~line 3270), and the compartment wiring in
`src/components/Editor.tsx` (`codeCardComp`). The delimiter lines are hidden
with `Decoration.replace({})` and stay as blank rows; `computeCodeCards`
reveals a block raw while `state.selection.main.head` is inside it.

The preview's copy button is `src/lib/codeCopy.ts` + the `.doc .mm-copy-code`
rules in `src/styles.css`; it is grafted onto preview DOM after injection
precisely so it never enters the markdown pipeline (anchoring/export). The edit
pane needs its own mechanism — a widget or an overlay in the CodeMirror
extension, not `decorateCodeBlocks` — and the `.table-chip-layer` chips
(SPEC37) and `src/components/diagramView.ts` are the two in-editor precedents.

For the selection artefact, read the SPEC23 §3 header comment above
`codeSelMark` in `src/components/Editor.tsx`: it explains why anything with its
own background hides CodeMirror's selection layer and how the existing inline
fix nests a `Prec.highest` mark inside the code span. The card's background
lives on `.cm-line`, which that mark does not cover.

The header comment on the `.mm-fence-card` CSS claims "no padding … the lines
keep their exact raw geometry, so the caret never shifts"; the issue overrides
that for the left edge, so update the comment along with the rule.

Grep `SPEC41`, `Issue #157` and `Issue #122` to land on the exact sites; never
read `src/App.tsx` end to end.
