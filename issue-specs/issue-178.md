# Spec: cursor position when toggling edit (#178)

## Goal

All acceptance criteria in issue-specs/issue-178.md are satisfied for issue #178, with evidence visible in the session: a collapsed caret placed in the preview lands the editor caret at the corresponding source position on toggle, an edit → preview → edit round trip with no preview interaction restores the exact caret/selection and top visible line, existing SPEC25 selection-carry behavior is unregressed, and `npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- **Preview caret carries into edit.** With a collapsed caret placed in the
  preview pane (e.g. a click inside a paragraph), toggling to edit mode
  (⌘E / toolbar / menu — all routes funnel through `toggleMode`) leaves the
  CodeMirror caret at the corresponding source position — exact when the
  text-mapping machinery can resolve it, otherwise at the start of the
  covering `data-mm-line` block (a safe fallback, never a wrong guess) —
  and the caret is visible in the editor viewport. Today this carries
  nothing: `sourceRangeFromDomSelection` (src/App.tsx:913) returns null for
  `sel.isCollapsed`.
- **Caret round trip is lossless.** In edit mode with a collapsed caret (no
  selection), toggling to preview and straight back restores the caret at
  the exact same offset and the editor viewport at the same top source
  line. The same holds for a non-collapsed selection (already carried by
  SPEC25 — must not regress).
- **Scroll position survives the toggle in both directions.** After
  toggling either way, the destination pane opens with the same top
  visible source line the origin pane showed (the SPEC16 §3.2 top-line
  carry in `toggleMode`). If the user scrolled the preview before toggling
  back, the editor opens at the scrolled-to position — a restored
  off-screen caret must not yank the viewport away from it.
- **No cross-document leakage.** A carried caret is consumed once and never
  applied to a different document than the one it was captured in (same
  rule SPEC25 applies to selections via `pendingEditorSelRef`).
- **Existing behavior is unregressed:** the SPEC25 selection-carry e2e
  tests (E85 in tests/e2e/split-view.spec.ts, E153 in
  tests/e2e/comments.spec.ts) and the SPEC16 scroll-carry behavior still
  pass unchanged.
- **New tests exist and pass:** unit coverage (tests/unit/, `U<n>`
  numbering) for any new caret-to-source mapping logic in `src/lib/`, and
  at least one e2e test (tests/e2e/, `E<n>` numbering) driving the
  preview-click → toggle → caret-position path and the caret round trip.
- **New behavior carries citation comments** (`// SPEC<n> §x.y:` or
  `// Issue #178:` per .sandcastle/CODING_STANDARDS.md) and `npm run map`
  output is committed if the spec→code table changed.
- Iterate with `npm run typecheck` and `npm run test:unit` (plus targeted
  `npx playwright test -g '<title>'` for the affected e2e tests) after each
  change; run `npm run validate:quick` ONCE, right before declaring the
  goal met — not after every small change and not as a starting baseline.
  It passes, printing `QUICK VALIDATION: ALL PASSED`, in the implementer's
  session.
- A summary comment from the implementer exists on issue #178.

## Context

The issue asks for a seamless read ↔ edit toggle: cursor, scroll, and
selection all preserved. Most of the machinery exists — this issue closes
the collapsed-caret gap. `toggleMode` (src/App.tsx:3530) is the single
switch point: it already carries non-collapsed selections both ways
(SPEC25, via `pendingEditorSelRef` / `pendingPreviewSelRef`) and the top
visible source line (SPEC16 §3.2, `pendingScrollLineRef`). The Editor's
parked-history mechanism (SPEC7 §6, `historyRef`) already revives doc +
undo + selection on remount, and `pendingSelectionRef`
(src/components/Editor.tsx:288, consumed at mount ~line 1334) applies a
carried range after the parked restore. Useful mapping pieces live in
src/lib/selectionMap.ts (`mapSelectionToSource`, `visibleTextForRange`,
`findNormalized`) — a collapsed caret can be resolved by measuring the
preview text from the covering block's start to the caret. Grep `SPEC25`
and `SPEC16 §3` before opening files; specs at docs/specs/SPEC25.md,
SPEC16.md. Beware the interplay between the mount-time
`scrollIntoView(..., y: 'center')` on carried selections and the
scroll-line carry: for a caret that was merely parked (not freshly placed
in preview), scroll authority stays with the SPEC16 carry.
