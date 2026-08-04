# Spec: Live preview blocks: headings, links, blockquotes, lists, rules, code fences (#48)

## Goal

All acceptance criteria in issue-specs/issue-48.md are satisfied for issue #48, with evidence visible in the session: the live-preview extension from #47 covers block-level constructs and links — headings render at heading size/weight with `#` markers hidden, links show styled link text with the `[text](url)` syntax hidden and cmd/ctrl-click opening the URL through the same platform hand-off the preview pane uses, blockquotes/lists/horizontal-rules/code-fences render with their markers hidden — all still subject to the #47 reveal rule and presentation-only/viewport-only invariants, exercised by unit tests with no user-visible exposure in the shipped app; `npm run validate:quick` passes in the implementer's session and a summary comment from the implementer exists on issue #48.

## Acceptance criteria

- (PRD 006 §4) With the extension active, ATX headings render at their
  heading size/weight (per-level, H1–H6) with the leading `#` markers —
  including the space after them — hidden.
- (PRD 006 §5) Links display their link text styled as a link with the
  surrounding `[text](url)` syntax (brackets, parens, URL) hidden;
  cmd/ctrl-click on a rendered link opens the URL the same way links open
  from the preview pane (`platform.openExternal` — see `src/App.tsx`
  around line 4269). Plain click just places the cursor. The `src/lib/`
  layer stays platform-free: the URL-opening hand-off lives in the
  component layer (e.g. an option on `livePreviewExtension()`), keeping
  #50 free to wire in the real platform.
- (PRD 006 §6) Block elements render: blockquotes show quote-bar styling
  with `>` markers hidden; bullet and ordered list items keep visible
  bullets/numbers; horizontal rules draw as a rule instead of raw
  `---`/`***`; code fences hide the ``` fence lines (including any info
  string) while the code body keeps its existing syntax highlighting.
- (PRD 006 §8) All new constructs obey the existing reveal rule
  unchanged: the cursor line shows raw markdown, multi-line constructs
  that cannot reveal line-by-line (code fences, setext headings if
  handled) reveal whole, and a selection reveals every touched line.
- (PRD 006 §9/§13) The invariants from #47 still hold with the new
  constructs: decorations never modify the document (typing, undo/redo,
  find, selection offsets unaffected), and decoration work stays bounded
  to the visible ranges — extend the existing viewport unit test to cover
  a block construct.
- The work remains library-level: no reference from `SettingsPanel.tsx`,
  no persisted setting, zero user-visible change in the app as shipped
  (the extension is still reachable only via the `livePreviewExtension()`
  internal factory), and the existing e2e suite passes unchanged inside
  `npm run validate:quick`.
- Unit tests exist in `tests/unit/live-preview.test.ts` (extend the
  existing file), titles `U<n>:` using the next unused numbers (U174 is
  the highest today), `describe` blocks naming the contract (`PRD 006
  §4` / `§5` / `§6`), covering: per-level heading marker hiding and
  styling; link syntax hiding, link styling, and the cmd/ctrl-click
  hand-off (assert the callback/URL, not a real browser); blockquote
  marker hiding; list marker rendering; horizontal-rule rendering; fence
  line hiding with code body left undecorated by hide spans; and reveal
  behaviour for at least a heading line and a fence interior.
- New behaviour carries citation comments (`// PRD 006 §<n>: …`) per
  `.sandcastle/CODING_STANDARDS.md`; no `console.*` in `src/`.
- Iteration used `npm run typecheck` and `npm run test:unit` (or tests
  targeted at the changed code) after each change; the full gate
  `npm run validate:quick` was run ONCE, right before declaring the goal
  met — not after every small change and not as a starting baseline.
- `npm run validate:quick` passes in the implementer's session, printing
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #48.

## Context

Parent #41 / `prd/006-live-preview.md`; blocked-by #47 is merged (commit
eebb87a). Extend, don't replace: `src/lib/livePreview.ts` holds the pure
core (`INLINE_NODES` table, `revealedRanges`, `computeLivePreviewDecos`)
and was explicitly structured so #48 adds node tables to the existing
walk; `src/components/livePreview.ts` maps specs onto CodeMirror
decorations (`Decoration.mark` classes + `Decoration.replace` hides,
themed via `EditorView.baseTheme`). Lezer node names come from
`@codemirror/lang-markdown` (tests parse with the GFM `markdownLanguage`
base): `ATXHeading1..6`/`HeaderMark`, `Link`/`LinkMark`/`URL`,
`Blockquote`/`QuoteMark`, `BulletList`/`OrderedList`/`ListItem`/`ListMark`,
`HorizontalRule`, `FencedCode`/`CodeMark`/`CodeInfo`. Line-level styling
(heading size, quote bar) likely needs `Decoration.line` alongside the
existing mark/replace kinds — the `LivePreviewDeco` union is yours to
grow. `revealsWhole` already treats `FencedCode` as atomic. Purity rule:
`src/lib/` imports no react/tauri/platform code (CodeMirror state is
fine); DOM/event wiring (mousedown for cmd/ctrl-click) belongs in
`src/components/`. Unit tests run with `pool: 'threads'`,
`isolate: false` — restore any global state you touch.
