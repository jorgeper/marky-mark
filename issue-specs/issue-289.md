# Spec: Verification sweep: close coverage gaps for the comments/highlights split and regenerate docs/MAP.md (#289)

## Goal

All acceptance criteria in issue-specs/issue-289.md are satisfied for issue
#289, with evidence visible in the session: every clause of PRD 023 Req 21 is
audited against named U/E test ids and the thin spots are closed with new
tests (at minimum the marker/comment tint token vocabulary with its WCAG AA
contrast claim, and the two annotation hotkey defaults), `scripts/validate.mjs`
carries a re-pinned `E2E_TEST_FLOOR` matching the collected desktop-shim count,
`docs/MAP.md` is the generator's own output committed after any citation or
spec edits, `npm run validate:quick` prints `QUICK VALIDATION: ALL PASSED`, and
a summary comment from the implementer exists on issue #289.

## Acceptance criteria

- **The Req 21 audit exists and is recorded.** Each clause of PRD 023 Req 21 —
  unit coverage for the 2.0.0 format (parse/serialize/kind rules/blue
  rejection) and the menu context model; e2e coverage for pane
  open/close/persist, menu insert/delete/recolor/remove in *both* the editor
  and the preview, the two hotkeys, overlap rendering, two-way sync, and
  comment copy-link — maps to at least one named test id in the summary
  comment on #289, each marked as pre-existing or added by this issue. Clauses
  found already covered are named as covered, not re-tested.
- **"Updated, not deleted wholesale" is verified.** The audit accounts for the
  unit ids retired since the PRD 023 work began (`U323`, `U819` from the
  removed `tests/unit/comment-affordance.test.ts`, and `U946` from
  `tests/unit/pane-slide.test.ts`), naming the tests that carry their coverage
  now or stating why the behaviour no longer exists.
- **The marker/comment tint tokens are pinned by a unit test.** A unit test
  asserts, reading `src/styles.css` (and the bundled themes that override
  them): the marker vocabulary is exactly `--mm-marker-yellow`, `-green`,
  `-orange`, `-pink` with no blue marker token anywhere; the
  `--mm-comment-tint` / `--mm-comment-tint-active` pair is defined in the
  document-rendering region and is theme-overridable; and body text over each
  of the four marker colors meets WCAG AA contrast in the default light and
  dark bundled themes (PRD 022 Req 13, PRD 023 §2–§3). Today nothing in
  `tests/` computes contrast at all.
- **The annotation hotkey defaults are pinned by a unit test.** A unit test
  asserts `DEFAULT_HOTKEYS.insertComment === 'Mod+Alt+M'` and
  `DEFAULT_HOTKEYS.applyHighlight === 'Mod+Alt+H'` (PRD 023 §12), that both
  survive a `parseSettings` round-trip and a rebinding like every other
  hotkey, and that both are reachable in the Settings → Hotkeys recorder's
  label registry.
- **Any further gap the audit turns up is closed or explicitly ruled
  out.** New tests are added where a Req 21 clause has no named coverage;
  where the audit concludes coverage is adequate, the summary comment says so
  with the ids rather than adding a duplicate test.
- **New test ids are minted from next-unused** (E484+, U1162+ as of this
  branch) and the validation gate's test-ID uniqueness step passes.
- **`E2E_TEST_FLOOR` in `scripts/validate.mjs` is re-pinned** to the count
  `npx playwright test --list` collects after this issue's tests land (it
  reads 464 against 473 collected today — drift from issues #270/#272), with
  a comment line in the running changelog above it naming issue #289 and what
  it added, in the style of the existing entries.
- **Stale contract text for the retired UX is marked superseded.**
  `docs/specs/SPEC7.md` §3 (type-to-comment) — and any other shipped
  spec/doc prose that still reads as current contract for the selection popup
  or type-to-comment — carries a note naming PRD 023 §6 as its supersession,
  following the existing `superseded by` idiom in `docs/specs/SPEC10.md` /
  `SPEC42.md`.
- **`docs/MAP.md` is the generator's output.** It is produced by
  `npm run map` (never hand-edited) after every citation, test, and spec edit
  this issue makes, and committed; `git status` is clean for it at the end and
  the validation gate's map check passes.
- **Iteration stays cheap.** The inner loop is `npm run typecheck` and
  `npm run test:unit` (or a single `npx playwright test -g '<title>'` when
  debugging one e2e). The full gate is run ONCE, right before declaring the
  goal met — not after every change, and not as a baseline at the start
  (baseline with the quick tier only if needed).
- **`npm run validate:quick` passes** in the implementer's session, printing
  `QUICK VALIDATION: ALL PASSED`.
- **A summary comment from the implementer exists on issue #289**, carrying
  the Req 21 audit table, the new test ids, the floor re-pin, and the gate
  evidence.

## Context

This is the final slice of PRD 023 (`prd/023-comments-highlights-split.md`,
parent #276); the feature work landed in #283–#288 and is already merged into
this branch's history. The sweep is verification, not new behaviour — resist
reworking UX.

Where things stand today: unit coverage for the 2.0.0 format lives in
`tests/unit/comment-format.test.ts` (U1087–U1091, U1121–U1123) and the menu
context model in `tests/unit/annotation-menu.test.ts` (U1143–U1146), with
`tests/unit/comments-pane.test.ts` (U1134) and `tests/unit/mark-hit.test.ts`
(U1135–U1138) alongside. E2e for the split lives mostly in
`tests/e2e/comments.spec.ts` — pane open/close/persist E435–E438, editor menu
flows E453–E459, hotkeys E460–E461, popup absence E462, overlap E439–E441,
two-way sync E442–E445, preview button E465–E473 — plus the hosted lane in
`tests/e2e/hosted.spec.ts` (comment copy-link E449/E450–E452, hosted menu
E463). Start the audit from those lists rather than re-deriving them.

`docs/MAP.md` regenerates clean right now (`npm run map` → 45 specs), so any
diff you see is your own edits. The style/token work touches `src/styles.css`
around lines 767–820 (the document-rendering region) and `themes/` — only
`themes/gruvbox-dark.css` currently overrides the marker tokens. The hotkey
map is `editor/src/lib/hotkeys.ts` (`DEFAULT_HOTKEYS`), consumed by
`src/lib/settings.ts`; the recorder's labels are `HOTKEY_LABELS` in
`src/components/SettingsPanel.tsx`. `scripts/validate.mjs` holds both the
test-ID uniqueness scan and the `E2E_TEST_FLOOR` pin with its changelog
comment. One minor tidy if you are in the neighbourhood: the composer
`onFocus` comment in `src/App.tsx` (~line 7137) still explains itself as
type-to-comment seeding, which no longer exists.

Coding rules are in `.sandcastle/CODING_STANDARDS.md`; every new test and
behaviour site carries its `SPEC<n> §x.y` / PRD citation comment. Never read
`src/App.tsx` end to end — citation-grep into it.
