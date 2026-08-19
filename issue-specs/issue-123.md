# Spec: Code block text selection doesn't render (#123)

## Goal

All acceptance criteria in issue-specs/issue-123.md are satisfied for issue
#123, with evidence visible in the session: selecting text inside a fenced
code block or an inline code span in the editor shows the theme's selection
tint over that text instead of the code background hiding it, the same holds
in the preview pane and in split view, a regression test covers it,
`npm run validate:quick` has been run and passes, and a summary comment from
the implementer exists on issue #123.

## Acceptance criteria

- In edit mode, dragging or keyboard-extending a selection across the body of
  a fenced code block renders the theme's selection tint (`--mm-selection`)
  visibly over the selected characters, in a theme whose `--mm-code-bg` is
  fully opaque (e.g. `crisp`, `github-dark`, `dracula`) as well as one whose
  value is translucent (e.g. `claude`).
- The same is true for a selection over an inline code span (`` `like this` ``)
  and for a selection that starts outside a code construct and runs through
  one — the tint is continuous across the whole range, not interrupted where
  the code background begins.
- The same is true in the preview pane and in the live-preview / split editor
  pane, where the code background must likewise not paint over the selection.
- Code constructs keep their existing appearance when nothing is selected:
  the code background, code foreground colour, mono font, and border-radius
  are unchanged from before the fix, in both light and dark themes. The fix
  does not simply drop the code background.
- The selection tint stays legible: selected code text remains readable
  (foreground colour is not swallowed by the tint) in at least one light and
  one dark theme.
- Existing selection-adjacent behaviours still work and are not visually
  regressed: the mirrored editor→preview selection (`mark.mm-mirror-sel`),
  find/replace match marks, comment highlights, and the active-line /
  active-word tints. Where these overlap a code construct, the documented
  stacking order (find > selection > comments > word > line) still holds.
- A regression test exists that fails against the pre-fix code and passes
  after: either an e2e assertion in `tests/e2e/editor.spec.ts` (alongside
  E82, which already covers markdown highlighting) or `live-preview.spec.ts`
  that asserts the selection is actually visible over code, or an equivalent
  unit test in `tests/unit/`. Its intent is stated in a comment.
- Any changed or added behaviour carries a `// SPEC<n> §x.y:` citation in the
  repo's format, and `npm run map` has been re-run if the spec→code table it
  generates would otherwise drift (`docs/MAP.md` is generated, never
  hand-edited).
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (or tests targeted at the changed code, e.g.
  `npx playwright test -g 'E82'`), not the full gate. Baseline, if taken at
  all, was the quick tier only.
- `npm run validate:quick` has been run ONCE, at the end, right before
  declaring the goal met, and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #123 describing what
  changed and the verification evidence.

## Context

The reporter's words: *"seems background of code block is rendered in
foreground"* and *"so when I select text in a code block I can't see the
selection"*.

The likely mechanism in the editor: CodeMirror 6 paints
`.cm-selectionBackground` in a layer *behind* `.cm-content`, so any inline
span in the content with its own background paints on top of it. The
markdown-highlighting style `tags.monospace → 'mm-md-code'`
(`src/components/Editor.tsx:320`) is styled at `src/styles.css:765` with
`background: var(--mm-code-bg, …)`, and nearly every bundled theme sets
`--mm-code-bg` to a **fully opaque** colour (`themes/*.css` line ~22), which
hides the selection entirely. The live-preview extension has the same shape
at `src/components/livePreview.ts:225` (`.mm-lp-code`), and
`.cm-line.mm-table-mode-line` (`src/styles.css:2603`) uses `--mm-code-bg` the
same way. `.cm-selectionBackground` is themed at `src/styles.css:882`.

The preview pane uses ordinary DOM: `.doc code` / `.doc pre`
(`src/styles.css:387`, `:396`) plus `.theme-root ::selection`
(`src/styles.css:51`); check whether the same symptom appears there before
changing it.

There is no PRD and no parent issue. Relevant specs: SPEC23 (markdown
highlighting in the editor), SPEC24 §1 (mirrored selection), SPEC44
(active-line / active-word stacking), PRD 006 (live preview). Grep the spec
number before opening files — never read `src/App.tsx` end-to-end. Themes are
plain CSS token files under `themes/`; `tests/unit/themes.test.ts` already
exercises them, and if a token is added or its contract changes, every bundled
theme should stay consistent.
