# Spec: /scratchpad regressions: save prompt on arrival, viewport scrolls by itself (#217)

## Goal

All acceptance criteria in issue-specs/issue-217.md are satisfied for issue
#217, with evidence visible in the session: navigating to `/scratchpad` on a
hosted deployment never shows a save/unsaved-changes dialog regardless of
what was open before; after landing the buffer is empty, focused, in edit
mode, with the cursor at line 1 and a viewport that does not move without
user input; both behaviors are covered by e2e tests (arriving over a clean
doc and over a prior scratch buffer); and `npm run validate:quick` passes in
the implementer's session.

## Acceptance criteria

- **No dialog on arrival.** Navigating to `/scratchpad` never shows a
  save/unsaved-changes dialog, regardless of what was open before — a saved
  doc, a dirty doc, or a prior scratch buffer. Per PRD 019 Req 11 the
  scratch flow discards its own buffer silently (including a leftover
  scratch-buffer crash draft from a prior deliberate visit — SPEC30 §3's
  boot offer must not fire for it on a scratchpad landing). A dirty
  *regular* doc's SPEC36 protection must not be silently bypassed: if that
  is the conflicting case, landing still must not lose regular-doc content
  (the crash-draft shadow may cover it), but the scratch buffer itself
  never prompts.
- **Stable landing state.** After landing at `/scratchpad`, the buffer is
  empty, focused, in edit mode, the cursor is at line 1, and the
  cursor/viewport does not move without user input (PRD 019 Reqs 1/10 —
  no self-scroll from a restored remembered position, queued reveal, or
  session-restore racing the scratch-start hook).
- **E2E coverage for both regressions.** New e2e tests (next free `E<n>`
  numbers, currently E400+, in `tests/e2e/hosted.spec.ts` alongside
  E397–E399) arrive at `/scratchpad` with (a) a clean doc open and (b) a
  prior scratch buffer open, and assert no dialog appears and the
  cursor/viewport is at the top of the file and stays put (e.g. cursor
  still on line 1 and scroll position unchanged after a short settle wait).
- **Root causes fixed, not suppressed.** The fixes land at the source of
  each regression (the buffer transition routing around the scratch
  exemption, and whatever drives the self-scroll), carry citation comments
  per `.sandcastle/CODING_STANDARDS.md` (PRD 019 Req 10/11, SPEC36 §2.6,
  SPEC30 §3 as applicable), and existing scratch tests E397–E399 still
  pass.
- **Test economy.** The implementer iterates with `npm run typecheck` and
  `npm run test:unit` (or tests targeted at the changed code, e.g.
  `npx playwright test -g 'E39'` / the new tests) and runs the full quick
  gate ONCE, right before declaring the goal met — not after every small
  change and not as a starting baseline.
- **`npm run validate:quick` passes** in the implementer's session
  (printing `QUICK VALIDATION: ALL PASSED`), run once at the end.
- **A summary comment from the implementer exists on issue #217.**

## Context

Issue #215 (PRD 019, `prd/019-personal-scratchpad.md`) implemented the
`/scratchpad` route; the owner observed both regressions on the live Azure
deployment. The landing flow: `src/platform/hosted.ts` derives
`scratchStart` (line ~96, via the read-and-clear scratch-boot key in
`src/lib/hostedGate.ts`), and the boot effect in `src/App.tsx` (~line 2719)
calls `startUntitledRef.current()` and arms `scratchRef` — grep
`PRD 019 Req 11` in `src/App.tsx` for every exemption site. Likely suspects
for the prompt: the SPEC30 §3 boot-time draft offer (~line 2747, a prior
scratch buffer's draft survives a deliberate exit because page navigation
skips draft cleanup) and/or `restoreSessionOpenFiles`/workspace-binding
transitions racing the scratch-start arm. For the self-scroll, look at
remembered-position restore (L5/`positions`) and any queued scroll applied
after the scratch buffer replaces the previously open doc. Existing
coverage: E397–E399 in `tests/e2e/hosted.spec.ts`. Never read `App.tsx`
whole — citation-grep (`PRD 019`, `SPEC30 §3`, `SPEC36 §2.6`).
