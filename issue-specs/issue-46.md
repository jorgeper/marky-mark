# Spec: Live preview engine: viewport decorations, reveal rule, inline formatting and headings (#46)

## Goal

All acceptance criteria in issue-specs/issue-46.md are satisfied for issue #46, with evidence visible in the session: the live-preview decoration engine (pure core in `src/lib/livePreview.ts`, CodeMirror wiring in `src/components/livePreview.ts`) renders inline formatting (bold, italic, strikethrough, inline code) and ATX headings with their markers hidden, subject to the reveal rule (cursor line shows raw markdown, multi-line constructs reveal whole, selections reveal every touched line); rendering is presentation-only, styled through theme CSS tokens, and computed only for the viewport's visible ranges; `npm run validate:quick` passes in the implementer's session and a summary comment from the implementer exists on issue #46.

## Acceptance criteria

- (PRD 006 §3) With the live-preview extension active, inline formatting
  renders in place with its markers hidden: bold, italic, strikethrough,
  and inline code display styled, without the `**` / `*` / `~~` / `` ` ``
  characters — covered by unit tests in `tests/unit/live-preview.test.ts`.
- (PRD 006 §4) ATX headings render at their per-level heading size/weight
  (H1–H6) with the leading `#` markers (and the space after them) hidden —
  covered by unit tests.
- (PRD 006 §8) Reveal rule: the line containing the cursor shows its raw
  markdown; multi-line constructs (e.g. code fences) reveal whole when the
  cursor is inside them; a selection reveals every line it touches —
  covered by unit tests.
- (PRD 006 §9) Rendering is presentation-only: decorations never modify
  the document. The document text remains the markdown source; typing,
  undo/redo, find, selection offsets, and file contents are unaffected by
  what is hidden or painted — covered by unit tests.
- (PRD 006 §10) Live-preview styling resolves through the current theme's
  CSS tokens (`var(--mm-*)` custom properties with fallbacks) rather than
  hard-coded colors, so rendered constructs follow the active theme in
  both light and dark. (Full toggle-on theming parity with the preview
  pane is #50's scope; the engine-level criterion here is that the
  decoration classes derive their colors/fonts from theme tokens.)
- (PRD 006 §13) Decorations are computed for the viewport (visible
  ranges), not the whole document — asserted by a unit test feeding a
  large document with a small viewport — and editing the largest fixture
  document (see `fixtures/`) shows no perceptible lag with the extension
  active.
- The engine is not user-exposed: it activates only via the internal
  `livePreviewExtension()` factory (test harness / caller opt-in), with no
  reference from `SettingsPanel.tsx` and no persisted setting; the shipped
  edit pane behaves exactly as before, evidenced by the existing e2e suite
  passing inside `npm run validate:quick`.
- Live-preview behaviour carries citation comments (`// PRD 006 §<n>: …`)
  per `.sandcastle/CODING_STANDARDS.md`, and `docs/MAP.md` is current
  (regenerated via `npm run map` if citations changed).
- `npm run validate:quick` has been run in the implementer's session and
  prints `QUICK VALIDATION: ALL PASSED`. Iterate with `npm run typecheck`
  and `npm run test:unit` (or tests targeted at the changed code) during
  development; run the full quick gate ONCE, right before declaring the
  goal met — not after every small change, and not as a baseline at the
  start of the attempt.
- A summary comment from the implementer exists on issue #46.

## Context

Issue #46 was decomposed and largely delivered by sibling sub-issues of
parent #41 that have already merged to main (and are contained in this
branch): #47 landed the core extension, reveal rule, inline formatting,
presentation-only and viewport invariants (`eebb87a`); #48 landed headings
and block constructs (`625e0dd` lineage, merged in `54c94ac`); #49 added
task-list checkboxes. The pure decoration core lives in
`src/lib/livePreview.ts` (unit-testable, no DOM), the ViewPlugin/theme
wiring in `src/components/livePreview.ts`, and ~29 unit tests in
`tests/unit/live-preview.test.ts`. The implementer's job is therefore
chiefly verification: confirm each criterion above holds in the current
tree (grep `PRD 006` citations, run the targeted unit tests), close any
gap found — heading marker hiding, reveal-rule edge cases, and theme-token
styling are the criteria most worth spot-checking — then run the quick
gate once and post the summary comment. Do not build the settings toggle
or edit-adjacent-feature compatibility work; that is #50.
