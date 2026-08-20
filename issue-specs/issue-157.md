# Spec: add support for code table preview in edit pane (#157)

## Goal

All acceptance criteria in issue-specs/issue-157.md are satisfied for issue
#157, with evidence visible in the session: fenced code blocks render as
preview-style code cards in the edit pane behind a persisted `codeBlockView`
setting (default on) whose bodies stay editable and reveal raw at the caret, a
Smart Edit `Code Block ▸ Show Raw Code / Show Rendered Code` toggle and a
matching Settings checkbox both flip and persist it, `npm run validate:quick`
passes in the implementer's session, and a summary comment from the
implementer exists on issue #157.

## Acceptance criteria

- A persisted setting `codeBlockView: boolean`, default `true`, exists in
  `src/lib/settings.ts` — declared in `Settings`, `DEFAULT_SETTINGS`,
  `SETTINGS_SCOPES` (scope `'U'`, the scope `tableGridView` and `inlineImages`
  already use) and the validator map — so the scope-coverage assertion in
  `tests/unit/settings-resolver.test.ts` (`SETTINGS_SCOPES` keys must equal
  `DEFAULT_SETTINGS` keys) still passes.
- With `codeBlockView` on, every fenced code block in the edit pane reads as
  the preview's code card: the fence delimiter lines and the info string
  are hidden, and the block's lines carry card chrome (background, border,
  radius) drawn from the same theme variables the preview's `pre` uses in
  `src/styles.css`, so the two panes look like the same block.
- The code body stays real, editable, syntax-highlighted editor text in both
  states: no fence is replaced by a widget, typing inside a rendered block
  edits the document exactly as it does today, and the existing `codeSyntax`
  per-language colouring still applies.
- Caret reveal, matching the rule in `src/components/imageView.ts`: while the
  selection is inside a fenced block, that block's delimiter lines and info
  string show as raw text; moving the caret out re-renders it. Other blocks in
  the document stay rendered.
- With `codeBlockView` off, the edit pane shows fences exactly as it does
  today — same text, same markdown and code highlighting, no card chrome.
- The Smart Edit ("#") menu carries a `Code Block` submenu, placed after the
  `Image` submenu in `src/lib/smartEdit.ts`, whose first child is a toggle
  labelled `Show Raw Code` when blocks are rendered and `Show Rendered Code`
  when they are raw — mirroring `Show Raw Tables` / `Show Raw Images`. Its
  entry ids do not collide with the existing top-level `code` (Inline Code)
  item, and the toggle flips the setting from both the gutter-button and
  right-click openings of the menu.
- A Settings ▸ Editor checkbox flips the same setting — a `Code` section in
  `src/components/SettingsPanel.tsx` beside the existing `Tables` and `Images`
  sections, with a `data-testid` in the style of `settings-table-grid` /
  `settings-inline-images` — and both surfaces agree and persist across a
  reload.
- Flipping the toggle in either direction changes no document text: the buffer
  is identical afterwards and the file is not marked dirty.
- The setting governs the edit pane only. Preview-pane rendering, export
  (`src/lib/exportDoc.ts`) and print output are byte-identical regardless of
  its value, and comment anchoring is unaffected.
- No regression with `livePreview` on: with both enabled the fence delimiter
  lines hide once (`src/lib/livePreview.ts` already hides `CodeMark`/`CodeInfo`
  for `FencedCode`), nothing double-hides or flickers, and
  `tests/e2e/live-preview.spec.ts` still passes.
- Explicitly NOT implemented here, and unbroken by this change: mermaid /
  diagram widgets in the edit pane (issue #162, `prd/013-mermaid-support.md`
  Reqs 5–6 — this issue adds no fence-renderer consumer), a copy button inside
  the editor, and indented (4-space) code blocks — fenced blocks only.
- Unit coverage exists for the pure span/decoration computation in a new
  `tests/unit/` file, following `tests/unit/image-spans.test.ts` and
  `tests/unit/table-mode-spans.test.ts` (fence with and without an info string,
  nested/unterminated fence, caret-inside reveal, disabled → no spans), and
  `tests/unit/smart-edit.test.ts` covers the new submenu's labels in both
  states.
- One new Playwright test in `tests/e2e/` (next free number: `E309`) covers the
  end-to-end behaviour in the style of `E121` in `tests/e2e/images.spec.ts`:
  rendered by default, caret reveal, the Smart Edit toggle and the Settings
  checkbox both flipping and persisting, preview pane unaffected.
- New behaviour carries citation comments in the repo's format
  (`docs/COMMENT-FORMAT.md`, `.sandcastle/CODING_STANDARDS.md`); if any
  `SPEC<n>` citations are added or moved, `docs/MAP.md` is regenerated with
  `npm run map` and committed (validate:quick diffs it).
- Iteration used `npm run typecheck` and `npm run test:unit` (or a single
  targeted e2e via `npx playwright test -g '<title>'`); the full gate was run
  ONCE, right before declaring the goal met — not after every change and not as
  a start-of-attempt baseline (baseline with the quick tier only).
- `npm run validate:quick` has been run in the implementer's session and
  printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #157.

## Context

The issue asks for code blocks to get the same edit-pane raw/rendered switch
that tables and images already have on the "#" (Smart Edit) menu. The two
templates to copy are SPEC40 (`tableGridView`) and SPEC41 (`inlineImages`):
grep `SPEC40` / `SPEC41` for the full set of touch points. The wiring runs
`src/lib/settings.ts` → `src/App.tsx` (a `toggleTableGrid`/`toggleInlineImages`
sibling near line 722, passed into `<Editor>` around lines 6937 and 7015) →
`src/components/Editor.tsx` (menu-id dispatch around lines 852–860, extension
install around line 1148, the reconfigure effect around line 1583) →
`src/lib/smartEdit.ts` (`SmartMenuCtx` at line 354, the submenus at 383–404) →
`src/components/SettingsPanel.tsx` (line ~822 onward).

`src/components/imageView.ts` (164 lines) is the compact model for the
CodeMirror side: a `StateField` + a `StateEffect` toggle + caret-reveal. Unlike
images, code must NOT be replaced by a widget — the body has to stay editable,
so line decorations plus `Decoration.replace` over just the delimiter lines is
the shape to aim for. `src/lib/livePreview.ts`'s `FencedCode` case (~line 327)
already computes exactly the delimiter/info spans to hide and shows how the
syntax tree is walked; reuse rather than re-derive where it fits.

The preview's code-block look lives in `src/styles.css` (`.doc pre` plus the
`.doc .mm-codeblock` block from issue #122 at line ~508); the copy button
itself (`src/lib/codeCopy.ts`) stays out of the editor.

Do not read `src/App.tsx` end-to-end — citation-grep into it. Coding rules are
in `.sandcastle/CODING_STANDARDS.md`; the spec→code table is `docs/MAP.md`.
