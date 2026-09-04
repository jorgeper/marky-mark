# Spec: Highlights: verification sweep — full Req 15 coverage (#235)

## Goal

All acceptance criteria in issue-specs/issue-235.md are satisfied for issue #235, with evidence visible in the session: every unit and e2e item in PRD 022 Req 15's coverage list maps to a passing test (gaps filled with new tests where missing), the existing comment e2e suites pass with only mechanical updates for the new affordance, `npm run validate:quick` passes in the implementer's session, and an implementer summary comment exists on issue #235.

## Acceptance criteria

- An explicit item-by-item audit of PRD 022 Req 15's coverage list exists in
  the implementer's summary comment on issue #235, mapping each required item
  to concrete test ids (U/E numbers). Every item maps to a test that exists
  and passes; any item found uncovered has a new test filling the gap.
- Unit tests exist and pass for all four Req 15 unit areas:
  - the format 1.1.0 bump — lowest-version stamping, byte-stable round-trip
    in both containers, and note-less entries (empty body, no thread);
  - the selection-affordance gate predicate (swatch popup surface);
  - the last-used marker color setting (`U` layer resolution, invalid values
    falling through);
  - `#hl-` fragment parsing (namespace claimed before heading slugs,
    look-alike slugs not shadowing, URL construction).
- E2e tests exist and pass for all seven Req 15 e2e flows: swatch-create with
  no composer opening; the add-note flow (armed color, composer attached);
  recolor from the active card; note-less card behavior (Req 9 — no standing
  card, card only while active); copy-link + `#hl-` landing + the not-found
  notice; editor-pane painting in both plain-edit and split-edit modes; and a
  legacy colorless sidecar rendering unchanged (default tint, no rewrite,
  still 1.0.0).
- The pre-existing comment e2e suites (`tests/e2e/comments.spec.ts` E7–E158
  range and any other suite touching the selection affordance) pass, with any
  diffs against their pre-PRD-022 shape limited to mechanical updates for the
  swatch popup replacing the "Add comment" pill.
- If tests were added or renumbered, `docs/MAP.md` matches the generator's
  output (`npm run map` — the validate gate diffs it).
- Iteration used the quick tier: `npm run typecheck` + `npm run test:unit`
  (or targeted runs like `npx playwright test -g '<title>'`) after each
  change; the full gate was NOT re-run per change and NOT run as a baseline
  at the start (baseline with the quick tier only).
- `npm run validate:quick` passes in the implementer's session, run ONCE
  right before declaring the goal met, printing `QUICK VALIDATION: ALL
  PASSED`.
- A summary comment from the implementer exists on issue #235 carrying the
  audit table and the validation evidence.

## Context

This is PRD 022's closing sweep (`prd/022-highlights.md`, Req 15; parent
issue #228). The earlier sub-issues (#229–#234) already landed most of the
coverage, so the work is primarily an audit that confirms each Req 15 item is
genuinely covered, plus filling whatever the audit finds missing. Known
starting points: unit coverage sits in `tests/unit/comment-format.test.ts`
(U1087–U1091 area), `tests/unit/comment-affordance.test.ts` (U819, U323),
`tests/unit/settings-resolver.test.ts` (last-used marker color describe
block), and `tests/unit/share-links.test.ts` (U1112, U1113); e2e coverage in
`tests/e2e/comments.spec.ts` (E416–E428) and `tests/e2e/hosted.spec.ts`
(E429–E432). Grep `PRD 022` across `src/` and `tests/` to find every cited
site. The e2e suite is slow and serialized — debug single tests with
`npx playwright test -g '<title>'`, and let the one `npm run validate:quick`
at the end serve as the full-suite proof.
