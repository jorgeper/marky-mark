# Spec: Live preview core: CodeMirror extension with reveal rule and inline formatting (#47)

## Goal

All acceptance criteria in issue-specs/issue-47.md are satisfied for issue #47, with evidence visible in the session: a live-preview CodeMirror extension exists as a pure, internally-flagged module with no user-visible exposure; inline bold, italic, strikethrough, and inline code render with their markers hidden, subject to the reveal rule (cursor line raw, whole multi-line construct raw, selection reveals every touched line); rendering is presentation-only (document text, typing, undo/redo, find, and selection offsets are unaffected) and decorations are computed for the viewport only; `npm run validate:quick` passes in the implementer's session and a summary comment from the implementer exists on issue #47.

## Acceptance criteria

- A live-preview CodeMirror extension module exists, activated only by an
  internal flag (e.g. an exported factory/facet/compartment the caller opts
  into). It is not referenced from `SettingsPanel.tsx`, adds no persisted
  setting, and produces zero user-visible change in the app as shipped:
  with the flag off (the only reachable state), the edit pane behaves
  exactly as today and the existing e2e suite passes unchanged.
- (PRD 006 req 3) With the extension active, inline formatting renders in
  place with markers hidden: bold, italic, strikethrough, and inline code
  display styled, without the `**` / `*` / `~~` / `` ` `` characters.
- (PRD 006 req 8) Reveal rule: the line containing the cursor shows its raw
  markdown; multi-line constructs (code fences, and any construct that
  cannot reveal line-by-line) reveal whole when the cursor is inside them;
  a selection reveals every line it touches.
- (PRD 006 req 9) Rendering is presentation-only: decorations never modify
  the document. The document text remains the markdown source; typing,
  undo/redo, find, selection offsets, and file contents are unaffected by
  what is hidden or painted.
- (PRD 006 req 13) Decorations are computed for the viewport (visible
  ranges), not the whole document — verifiable in a unit test that feeds a
  large document (e.g. `fixtures/field-guide.md`-scale) with a small
  viewport and asserts no decoration work happens outside it.
- The decoration computation is structured so it is unit-testable in
  vitest's `node` environment (no DOM): a pure function of document state +
  selection + visible ranges → decoration ranges, per the `src/lib/` purity
  rule in `.sandcastle/CODING_STANDARDS.md`. Unit tests exist in
  `tests/unit/` (one file matching the module name), titles `U<n>:` using
  the next unused numbers (U161 is the highest today), `describe` blocks
  naming the contract (e.g. `PRD 006 §3`), covering: each inline construct's
  marker hiding, the reveal rule for cursor line / code-fence interior /
  multi-line selection, presentation-only invariants, and viewport-bounded
  computation.
- New behaviour carries citation comments (`// PRD 006 §<n>: …`) per
  `.sandcastle/CODING_STANDARDS.md`; no `console.*` in `src/`.
- Iteration used `npm run typecheck` and `npm run test:unit` (or tests
  targeted at the changed code) after each change; the full gate
  `npm run validate:quick` was run ONCE, right before declaring the goal
  met — not after every small change and not as a starting baseline.
- `npm run validate:quick` passes in the implementer's session, printing
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #47.

## Context

Parent #41 / `prd/006-live-preview.md`; this is the first of four
sub-issues (#48 blocks, #49 checkboxes, #50 settings toggle + wiring), so
keep the extension's API extensible — later sub-issues add block constructs
and widgets on top of it. The edit pane is CodeMirror 6
(`src/components/Editor.tsx`, ~1500 lines — grep `SPEC23` for the existing
markdown-highlighting compartment rather than reading it whole). Existing
decoration-based extensions to crib from: `src/components/tableMode.ts`
(SPEC40) and `src/components/imageView.ts` (SPEC41). The markdown syntax
tree comes from `@codemirror/lang-markdown` (Lezer). Pure logic belongs in
`src/lib/` (no react/tauri/components imports; CodeMirror state imports are
fine — see `src/lib/selectionMap.ts`); any DOM/view wiring can sit in
`src/components/`. Unit tests run with `pool: 'threads'`,
`isolate: false` — restore any global state you touch.
