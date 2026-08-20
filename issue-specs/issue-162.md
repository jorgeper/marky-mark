# Spec: Mermaid: edit-pane diagram widgets + Diagram ▸ menu / Settings toggle (#162)

## Goal

All acceptance criteria in issue-specs/issue-162.md are satisfied for issue
#162, with evidence visible in the session: mermaid fences render as in-place
diagram widgets in the edit pane under a new persisted setting (default on)
that yields the fence source back at the caret the way the table grid and image
widgets do, a `Diagram ▸` entry on the Smart Edit menu and a Settings checkbox
both flip and persist that one setting, the seam's pure logic is unit-tested
and a new desktop e2e covers a valid and an invalid mermaid fence in both
panes, `npm run validate:quick` passes in the implementer's session, and a
summary comment from the implementer exists on issue #162.

## Acceptance criteria

- **PRD 013 Req 5 — the setting.** A persisted `diagramView: boolean` (name it
  so unless a better one is already taken), default `true`, is declared in all
  four places `src/lib/settings.ts` requires — the `Settings` interface,
  `DEFAULT_SETTINGS`, `SETTINGS_SCOPES` with scope `'U'` (the scope
  `tableGridView` / `inlineImages` / `codeBlockView` use), and the validator map
  (`bool`) — so the scope-coverage assertion in
  `tests/unit/settings-resolver.test.ts` (`SETTINGS_SCOPES` keys ≡
  `DEFAULT_SETTINGS` keys) still passes, and a hand-edited non-boolean in
  settings.json falls back to the default.
- **PRD 013 Req 5 — the widget.** With the setting on, a fenced block whose
  language has a registered fence renderer (`fenceRendererFor` /
  `fenceLanguage` from `src/lib/fenceRenderers.ts`) renders in the edit pane as
  its diagram in place of the fence text. Registration is what qualifies a
  fence: the string `'mermaid'` does not appear in the new edit-pane code
  (`rg -n "mermaid" src` stays confined to `src/lib/mermaidRenderer.ts` and its
  registration site in `src/App.tsx`), so a second registered language would
  draw here with no edit to the widget layer. Fences in unregistered languages
  (```js, ```text, no info string) keep exactly today's edit-pane rendering —
  the issue #157 code card when `codeBlockView` is on, plain fence text when it
  is off.
- **PRD 013 Req 5 — caret reveal.** While the selection head is inside a
  diagram fence, that block shows its raw source for editing and the other
  diagram fences in the document stay drawn; moving the caret out re-renders it.
  Follow the rule the neighbours already state — `src/components/imageView.ts`
  §2.2 and `computeCodeCards` in `src/lib/codeBlockSpans.ts` (which counts both
  boundaries as inside, because a caret landing on a delimiter line must reveal
  the block it opens).
- **Pure decoration, like SPEC41.** Drawing or hiding a diagram never changes
  document text, history, or the dirty flag: after toggling the setting in
  either direction, or clicking a widget, the buffer is byte-identical and the
  file is not marked dirty. Table-grid regions (SPEC40 spans, the
  `tableModeField` exclusion both `imageView.ts` and `codeBlockView.ts` honour)
  keep their geometry — a fence overlapping one stays raw.
- **One renderer, no second mermaid.** The widget goes through the same seam
  and the same adapter the preview uses (`src/lib/fenceRenderers.ts` →
  `src/lib/mermaidRenderer.ts`): no new `import('mermaid')` site, no second
  `mermaid.initialize`, no widened sanitize schema, and the SVG is injected
  post-sanitize exactly as `src/lib/fenceDiagrams.ts` documents. Reuse rather
  than re-derive where the preview graft's logic fits; if the shared part moves
  into a common helper, the preview keeps its current behaviour and E309–E311
  still pass.
- **PRD 013 Req 11, edit-pane side.** While a fence's diagram is rendering
  (including the first-use lazy import of mermaid) the block does not collapse
  — the source or a placeholder of equivalent height holds the space — and a
  result that arrives after the fence changed or the setting was turned off
  does not paint over the newer state.
- **PRD 013 Req 10, edit-pane side.** A fence that fails to render keeps its
  source visible in the editor plus a visible, unobtrusive error indicator
  carrying the renderer's message (the `mm-diagram-error` shape). A failure
  never blanks the block, never throws to the app shell, and never stops other
  fences in the document from drawing.
- **PRD 013 Req 9, edit-pane side.** The widget renders with the app's active
  theme side (`activeThemeVariant` in `src/App.tsx:2775`, which reaches the
  editor as a prop or effect the way the preview graft already gets it), and
  changing the active theme while the edit pane is open redraws the on-screen
  diagrams with the new side — the E311 property, in the other pane.
- **PRD 013 Req 6 — the two surfaces.** The Smart Edit ("#") menu carries a
  `Diagram` submenu built in `src/lib/smartEdit.ts` beside the existing
  `Table` / `Image` / `Code Block` submenus (a new `SmartMenuCtx` field, e.g.
  `diagramView`), whose toggle child reads `Show Raw Diagrams` when diagrams are
  drawn and `Show Rendered Diagrams` when they are raw — mirroring
  `Show Raw Tables` / `Show Raw Images` / `Show Raw Code`. Its entry ids collide
  with nothing existing, it dispatches from both the gutter-button and
  right-click openings (`src/components/Editor.tsx` ~line 863 onward), and a
  Settings ▸ Editor checkbox in `src/components/SettingsPanel.tsx` (a `Diagrams`
  section beside `Tables` / `Images` / `Code`, `data-testid` in the
  `settings-inline-images` style) flips the same setting through the same
  `toggleTableGrid`/`toggleInlineImages` sibling in `src/App.tsx` (~line 725).
  Both surfaces agree with each other and the setting survives a reload.
- **Edit pane only.** Preview-pane rendering, export (`src/lib/exportDoc.ts`),
  print output and comment anchoring are identical regardless of the setting's
  value; `src/lib/markdown.ts`'s pipeline and sanitize schema are untouched.
- **No regression with `livePreview` or `codeBlockView` on.** With diagrams on
  alongside either, a diagram fence draws once — nothing double-hides, flickers,
  or leaves card chrome around a drawn diagram — and
  `tests/e2e/live-preview.spec.ts` plus the issue #157 code-card tests still
  pass unchanged.
- **PRD 013 Req 12 — unit coverage.** The pure part (which fences qualify,
  caret reveal, exclusions, disabled ⇒ no spans, the error-fallback shape) lives
  in a `src/lib/` module obeying the purity rule in
  `.sandcastle/CODING_STANDARDS.md` (no `react`, no `@tauri-apps/*`, no
  `src/components/` imports — `src/lib/codeBlockSpans.ts` is the model) and is
  covered by `tests/unit/<kebab-case-module>.test.ts`, one file per module,
  titles numbered from **U754** up, `describe` blocks naming the contract
  (`PRD 013 Req 5`, `PRD 013 Req 6`). `tests/unit/smart-edit.test.ts` covers the
  new submenu's labels in both states. Tests that mutate the fence registry
  restore it — the suite runs `isolate: false`.
- **PRD 013 Req 12 — e2e across both panes.** A mermaid fixture document with a
  valid and an invalid fence exists under `fixtures/` (note `src/bundled.ts`
  globs `/fixtures/*.md`, so it is seeded into the shim's vfs and bundled into
  the app — keep it small and check it breaks no test that assumes the seeded
  doc set), and a new desktop e2e numbered from **E312** in
  `tests/e2e/mermaid.spec.ts` opens it and asserts, in the style of E121
  (`tests/e2e/images.spec.ts`) and the existing E309: the valid fence drawn in
  the edit pane by default, the invalid one keeping its source plus the error
  note, caret reveal, the `Diagram ▸` toggle and the Settings checkbox each
  flipping and persisting, and the same document's preview pane unaffected. The
  first draw of a session waits on mermaid's dynamic import — reuse E309's
  generous `FIRST_DRAW` timeout rather than the default 5s.
- **Offline and call-site clean.** Nothing added here opens a network call site:
  `FETCH_ALLOWLIST` in `scripts/validate.mjs` is unchanged and the fast-tier
  bundle guards from #161 (`tests/unit/static-desktop-mermaid.test.ts`,
  `tests/unit/static-web-no-llm.test.ts`) still pass — mermaid must stay a lazy
  chunk on desktop and inlined on web, so do not import the adapter eagerly from
  editor code.
- New or changed behaviour carries a citation comment naming its contract
  (`// PRD 013 Req 5: …`, `// PRD 013 Req 6: …`) per
  `.sandcastle/CODING_STANDARDS.md` and `docs/COMMENT-FORMAT.md`; if any
  `SPEC<n>` citation in `src/` or `tests/e2e/` is added or moved, `docs/MAP.md`
  is regenerated with `npm run map` and committed (validate:quick diffs it).
- Test economy: iteration used `npm run typecheck` and `npm run test:unit` (or a
  targeted `npx vitest run <file>` / `npx playwright test -g '<title>'` while
  debugging one behaviour) — not the full suite after every change, and no
  full-suite baseline at the start of the attempt (baseline with the quick tier
  only if you need one).
- `npm run validate:quick` has been run ONCE, at the end, in the implementer's
  session and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #162, stating what
  changed (setting, widget layer, two toggle surfaces, fixture, tests), the
  verification evidence, and anything deliberately left out.

## Context

This is the last of four mermaid issues under `prd/013-mermaid-support.md`
(parent #56): #159 landed the fence-renderer seam, #160 the preview graft, #161
the packaging guards. Everything the preview needs already exists —
`src/lib/fenceRenderers.ts` (registry + `fenceLanguage`),
`src/lib/mermaidRenderer.ts` (the only `import('mermaid')`, security posture and
SVG scrub), `src/lib/fenceDiagrams.ts` (the post-sanitize preview graft, whose
header comment explains why diagrams stay out of `src/lib/markdown.ts`), and
`src/App.tsx:209` registering the adapter. This issue adds the edit-pane
consumer and the user-facing toggle.

The wiring template is issue #157 (`codeBlockView`), one commit deep in this
history and near-identical in shape: `src/lib/settings.ts` (four sites) →
`src/App.tsx` (a `toggleCodeBlockView` sibling ~line 746, passed into `<Editor>`
at ~6983 and ~7063) → `src/components/Editor.tsx` (prop + `smartPropsRef` ~687,
menu-id dispatch ~874, compartment install ~1173, reconfigure effect ~1605) →
`src/lib/smartEdit.ts` (`SmartMenuCtx` ~354, the submenus ~385–413) →
`src/components/SettingsPanel.tsx` (~822 onward). Grep `codeBlockView` for the
full set of touch points; `SPEC40` / `SPEC41` for the two older ones.

For the CodeMirror side, `src/components/codeBlockView.ts` (80 lines, a
`ViewPlugin` over pure spans in `src/lib/codeBlockSpans.ts`) and
`src/components/imageView.ts` (164 lines, a `StateField` + `StateEffect` toggle
+ widget) are the two models. A diagram is a block, and rendering is async, so
expect a block `Decoration.replace` widget whose content arrives on a promise —
`fenceDiagrams.ts`'s pass-token guard shows how the preview keeps a late result
from painting over newer state.

Do not read `src/App.tsx` end-to-end — citation-grep into it (`docs/MAP.md` for
spec→file lookups). Coding rules are in `.sandcastle/CODING_STANDARDS.md`.
Next free test numbers as of this spec: unit **U754**, desktop e2e **E312**
(re-check before you write them).
