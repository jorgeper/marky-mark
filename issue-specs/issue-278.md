# Spec: Split mode: selecting text in the preview pane jolts the scroll position (#278)

## Goal

All acceptance criteria in issue-specs/issue-278.md are satisfied for issue #278, with evidence visible in the session: selecting text in the split preview pane leaves BOTH panes' scroll offsets unchanged with sync scrolling on and off, the reverse-mirror contract (SPEC23 §3) and the tests that asserted the old reveal are updated to match, a regression test in `tests/e2e/split-view.spec.ts` asserts both offsets are unchanged across a mid-document preview selection, `npm run validate:quick` passes in the implementer's session, and a summary comment from the implementer exists on issue #278.

## Acceptance criteria

- In split edit mode, a text selection made inside the preview pane (drag or
  double-click, mid-document, with the panes scrolled away from the top)
  leaves the preview scroller's `scrollTop` AND the editor's `.cm-scroller`
  `scrollTop` unchanged — no transient jolt and no settled drift — with the
  sync-scroll setting ON and with it OFF.
- The cause is diagnosed rather than papered over: the fix addresses the code
  path that moves scroll on a preview selection (start at the SPEC23 mirror —
  `src/App.tsx` ~line 6363's `selectionchange` effect calling
  `editorSelectRef`, landing in `selectRangeRef` in
  `editor/src/components/Editor.tsx` ~line 1607, which dispatches
  `EditorView.scrollIntoView(a, { y: 'center' })` — and confirm whether the
  SPEC15 sync-scroll follower in `editor/src/components/SplitView.tsx` then
  propagates that editor scroll to the preview). No masking via timers,
  scroll-position save/restore hacks, or suppressing the mirror itself: the
  mirrored editor selection must still be produced and drawn.
- The selection still mirrors: after a preview selection, the unfocused
  editor's selection covers the mapped source range (`window.__mmEdit.selText`
  as E80 asserts) and the preview's own DOM selection survives. Only the
  scroll side effect is gone.
- The written contract matches the shipped behaviour: SPEC23 §3's
  "dispatched to CodeMirror as its selection plus `scrollIntoView`" clause is
  amended in place (with a dated/issue-referencing amendment note, the
  precedent set by earlier SPEC amendments in this repo) so no spec text still
  promises the reveal. Changed behaviour carries a citation comment naming the
  contract (`// SPEC23 §3: …` / issue #278), per
  `.sandcastle/CODING_STANDARDS.md`.
- E80 in `tests/e2e/split-view.spec.ts` no longer asserts
  `.cm-scroller` `scrollTop > 0` after the mirror; it asserts the mirror's
  selection outcome and the new scroll-neutral contract instead.
- A new regression test exists in `tests/e2e/split-view.spec.ts` (next free
  E number — E432 is the current maximum across `tests/e2e/`; confirm before
  minting) that, on a document long enough to scroll: enters split mode,
  scrolls both panes mid-document, records both scrollTops, selects a phrase
  in the preview, and asserts both scrollTops are unchanged (small px slack
  only) while the mirrored editor selection is present. It covers sync
  scrolling ON and OFF.
- Behaviours that legitimately scroll are untouched and still pass: SPEC15/45
  sync scrolling driven by an actual scroll gesture in either pane (E57, E58,
  E128, E315), preview-click caret placement (E125, E373/E374), and the
  Mod+E selection carry (E85) — the mode-switch reveal via
  `pendingSelectionRef` stays.
- `docs/MAP.md` matches the generator's output (`npm run map`) if spec/test
  citations changed — the validate gate diffs it.
- Iteration used the quick tier: `npm run typecheck` + `npm run test:unit`
  (or targeted runs like `npx playwright test -g '<title>'`) after each
  change; the full gate was NOT re-run per change and NOT run as a baseline
  at the start of the attempt (baseline with the quick tier only).
- `npm run validate:quick` passes in the implementer's session, run ONCE
  right before declaring the goal met, printing `QUICK VALIDATION: ALL
  PASSED`.
- A summary comment from the implementer exists on issue #278, naming the
  diagnosed root cause, the fix, the new test's E number, and the validation
  evidence.

## Context

Applies to both builds (desktop and hosted) — the code is shared, no
platform branch needed. Grep `SPEC23`, `SPEC15`, `SPEC44`, `SPEC45` to reach
every cited site; `docs/MAP.md` maps specs to files and E-numbers.

The suspect chain: `src/App.tsx`'s SPEC23 mirror effect (a debounced
`selectionchange` handler, held until pointerup for drags — issue #138)
dispatches the mapped range through `editorSelectRef` →
`Editor.tsx`'s `selectRangeRef`, which centres the editor on it. The editor
scroll then feeds SPEC15's `onEditorScroll` → `editorLeads()` in
`SplitView.tsx`, which writes the preview's `scrollTop` — so one selection
moves both panes. With sync scrolling off the editor still jumps on its own.
`placeFromPreviewClick` (SPEC44 §4, `src/App.tsx` ~1320) shares the same
`editorSelectRef` entry point, so weigh the click path when choosing where
the reveal is dropped — E125's caret-placement assertions must keep passing.

Useful e2e helpers in `tests/e2e/helpers.ts`: `splitApp`, `selectPhraseInPane`,
`selectSpanInPane`, `dragAcrossText`, `fsWrite`. The split preview scroller is
`[data-testid="split-preview"]` and the editor's is
`[data-testid="editor"] .cm-scroller`. The e2e suite is slow and serialized —
debug single tests with `npx playwright test -g '<title>'` and let the single
`npm run validate:quick` at the end be the full-suite proof.
