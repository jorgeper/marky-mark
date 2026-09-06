# Spec: management dialog (#317)

## Goal

All acceptance criteria in issue-specs/issue-317.md are satisfied for issue
#317, with evidence visible in the session: the Management dialog renders at
the same size as the Settings dialog instead of near-full-window, the Settings
dialog's intrinsic size is 20% larger in both dimensions (648×552 → 778×662,
its viewport clamps unchanged), an e2e test pins the two dialogs to the same
rendered box, `npm run validate:quick` passes in the implementer's session, and
a summary comment from the implementer exists on issue #317.

## Acceptance criteria

- `.settings-modal` in `src/styles.css` sizes the Settings dialog 20% larger in
  both dimensions than today's 648×552 — `width: min(778px, 94vw)` and
  `height: min(662px, 85vh)` (777.6/662.4 rounded; ±1px is fine) — with the
  viewport caps kept exactly as they are, so a small window still clamps the
  dialog the way issue #246's comment describes.
- The Management dialog (`.dialog.management-modal`, `data-testid="management-panel"`)
  renders at the same size as the Settings dialog at every viewport: its
  near-full-window `95vw`/`95vh`, its `max-height: none`, and the
  `@media (max-width: 640px)` full-bleed override no longer apply, so both
  dialogs clamp identically on a small window rather than only matching on a
  large one.
- The two sizes come from one source in `src/styles.css` (a shared selector
  list or shared custom properties defined in that file) so they cannot drift
  apart in a later edit; the rule carries a citation comment naming issue #317
  in the repo's format (`.sandcastle/CODING_STANDARDS.md`).
- Opening Management still shows its three tabs (Workspaces, People, Settings)
  with all content reachable at the smaller size: the tab content scrolls
  vertically as before and nothing in the `.admin-table` rows is clipped
  unreachably (a horizontal scroll inside `.tab-content` is acceptable; a
  clipped, unscrollable table is not).
- An e2e test proves the sizing: at the suite's viewport the Management
  dialog's bounding box matches the Settings dialog's within 1px. The natural
  home is `tests/e2e/hosted.spec.ts`, where the admin lane already opens
  `management-panel` (see E371 near line 3505); number any new test `E<n>`
  above the highest existing number.
- The existing settings-size assertion in `tests/e2e/settings-and-themes.spec.ts`
  (E486, the `>= 640` / `>= 540` floors and its "a little bigger than the old
  560x480" comment) is updated to the enlarged size, accounting for the
  viewport clamp described in Context rather than asserting a bare 778×662.
- The stale "near full-window" claims are corrected wherever they are stated:
  the `PRD 017 Req 13` header comment at the top of
  `src/components/ManagementPanel.tsx`, the `.dialog.management-modal` comment
  in `src/styles.css`, and `prd/017-deployment-admins.md` (Req 13's **Size**
  paragraph, line ~236, and the summary line ~456) — the PRD using the repo's
  amendment convention, e.g. `> **Amended (issue #317, 2026-09-06):** …`.
- Iterate with `npm run typecheck` and `npm run test:unit`, plus tests targeted
  at what changed (`npx playwright test -g '<title>'`) — do not run the full
  gate after every change and do not run it as a baseline at the start.
- `npm run validate:quick` has been run ONCE, right before declaring the goal
  met, and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #317, describing what
  changed and carrying the verification evidence.

## Context

Both dialogs are pure CSS sizing in `src/styles.css`: `.settings-modal` at line
~1232 (`width: min(648px, 94vw); height: min(552px, 85vh)`, grown ~15% by issue
#246) and `.dialog.management-modal` at line ~3504 (`95vw`/`95vh`,
`max-height: none`, plus a ≤640px full-bleed media query). The base `.dialog`
rule (line ~408) carries `max-height: 84vh`, which `.settings-modal` does not
override — so at the e2e suite's 1280×720 Desktop Chrome viewport the enlarged
height clamps to ~605px, not 662px. Expect that when writing assertions;
measuring the two dialogs against each other, or against `84vh`, is more robust
than a hard-coded 662.

The issue asks for something PRD 017 Req 13 explicitly required against ("it
must not inherit the Settings dialog's fixed maximum width"). The owner's later
call wins; the PRD gets an amendment blockquote rather than a silent
contradiction — see `prd/020-shareable-links.md:129` and
`prd/013-tabs-on-top.md:131` for the house format.

`npm run validate:quick` runs the style lint (`scripts/style-lint.mjs`) and the
`docs/MAP.md` freshness check in its quick tier; px widths are not lint-flagged,
but any `var()` introduced must be defined in `src/styles.css`, and if MAP drifts
regenerate it with `npm run map` (never hand-edit). The e2e test-count floor in
`scripts/validate.mjs` is a floor, so adding a test does not require re-pinning
it. `src/components/ManagementPanel.tsx` needs no structural change — only its
header comment.
