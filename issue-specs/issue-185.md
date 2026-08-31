# Spec: Deduplicate test IDs (32 E, 148 U) and gate ID uniqueness in validate.mjs (#185)

## Goal

All acceptance criteria in issue-specs/issue-185.md are satisfied for issue #185, with evidence visible in the session: no `U`/`E`/`W` test ID appears more than once across `tests/`, `scripts/validate.mjs` fails the quick tier on any duplicate ID naming the offending IDs and files, `npm run validate:quick` passes in the implementer's session, and a summary comment from the implementer exists on issue #185.

## Acceptance criteria

- **Uniqueness gate.** `scripts/validate.mjs` contains a spawn-free check that scans test titles under `tests/` for `U<n>`/`E<n>`/`W<n>` IDs and fails — naming each duplicated ID and the files it appears in — when any ID occurs more than once. The check runs in the quick tier (it sits with the existing spawn-free file checks ahead of the `steps` array, like the symlink check near `scripts/validate.mjs:174`), so it executes under `npm run validate:quick`.
- **No duplicates remain.** Both repro commands from the issue produce empty output:
  `grep -rhoE "test\(['\"]E[0-9]+:" tests/e2e | grep -oE 'E[0-9]+' | sort | uniq -d` and
  `grep -rhoE "(it|test)\(['\"]U[0-9]+:" tests/unit | grep -oE 'U[0-9]+' | sort | uniq -d`
  (as of 2026-08-31 they report 32 and 148 duplicated IDs; W has none).
- **Older occurrence kept its number.** For every duplicate, the *later* occurrence (decided by `git log -S` on the test title) has been renumbered to a fresh ID above the prefix's maximum at the time of the change (E325 / U804 when the issue was filed), and the older occurrence is unchanged — so existing references in `prd/`, `issue-specs/` and `docs/` stay correct. Renumbering touched test titles only; no test bodies changed and no test was weakened or removed.
- **MAP regenerated.** `npm run map` has been run after the renumbering and `docs/MAP.md` is committed if it changed (the validation gate diffs it against the generator's output).
- **Standards updated.** The test-ID rule in `.sandcastle/CODING_STANDARDS.md` (around line 28) carries one added sentence: the quick gate enforces ID uniqueness, and a collision after a parallel merge is fixed by bumping the newer test to the next unused number.
- **Test economy.** The implementer iterated with `npm run typecheck` and `npm run test:unit` (or tests targeted at the changed code — e.g. `npx playwright test -g '<title>'` for a single renamed e2e test); the full quick gate ran ONCE, right before declaring the goal met — not after every small change and not as a starting baseline.
- `npm run validate:quick` has been run in the implementer's session and passed, printing `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #185.

## Context

The duplicate IDs come from parallel implementers each taking "next unused" simultaneously; nothing gated uniqueness so it accumulated. The gate belongs in `scripts/validate.mjs` with the other spawn-free pre-step checks (see `SPEC33 §1.1` citations there for the quick-tier structure); scan `tests/` recursively but note only `tests/e2e` and `tests/unit` currently carry IDs (`tests/frozen` has none). `E2E_TEST_FLOOR` counts tests, not IDs, and is unaffected. Renumbering ~180 tests consumes the next ~32 E and ~148 U numbers — this issue is sequenced before PRD 017 (#181) decomposition for that reason. `docs/MAP.md` cites E numbers per spec, which is why the older occurrence keeps its number and why the map must be regenerated. Keep the gate's file-touch cost low: read test files once, no process spawns.
