# Spec: Split tests/e2e/app.spec.ts by feature area, with a Playwright-collected test-count floor (#31)

## Goal

All acceptance criteria in issue-specs/issue-31.md are satisfied for issue #31, with
evidence visible in the session: `tests/e2e/app.spec.ts` is gone and its 136
tests live in 8–12 feature-named `tests/e2e/*.spec.ts` files with every test
body and every `E<n>` title prefix unchanged; `playwright.config.ts` matches the
new files by glob instead of hardcoding `app.spec.ts` while still leaving
`web.spec.ts` to `playwright.web.config.ts`; `scripts/validate.mjs` carries a
committed test-count floor taken from Playwright's own collection
(`playwright test --list`) that runs in the `--quick` tier and fails loudly when
the count drops or the listing cannot be parsed; deleting one split file was
demonstrated to fail `npm run validate:quick` on that floor and then reverted;
`npm run validate:quick` has been run once at the end and printed
`QUICK VALIDATION: ALL PASSED`; and a summary comment from the implementer
exists on issue #31.

## Acceptance criteria

### The split is a move, not a rewrite

- `tests/e2e/app.spec.ts` no longer exists. Its contents live in **8–12** new
  files under `tests/e2e/`, each named for a feature area (comments, editor,
  tables, folder-tree, settings, export, images, split-view, themes, updater,
  … — the exact set is the implementer's call). Names describe the feature, not
  an E-number range: no `e1-e40.spec.ts`-style file, because the numbers are
  chronological and do not cluster. (PRD req 9)
- All **136** `test()` calls land in exactly one new file each, byte-identical
  in body. No test is added, removed, renamed, merged, split, skipped or
  re-ordered *within* a file. (PRD req 10)
- The session shows a mechanical before/after comparison, not an eyeball claim:
  the sorted list of test titles collected by Playwright after the split is
  identical to the sorted list from `git show <base-sha>:tests/e2e/app.spec.ts`
  (or from the pre-split `npx playwright test --list`), with an empty diff
  printed. `<base-sha>` is whatever commit the branch started from.
- `E<n>` prefixes are preserved verbatim as test-title prefixes — nothing is
  renumbered, and no number is reused or retired. E-numbers run to E140 with
  gaps; that is expected and must stay as-is. (PRD req 11)

### Shared setup lands in helpers.ts, once

- Every helper currently defined inside `app.spec.ts` moves to
  `tests/e2e/helpers.ts` (or, where it is genuinely fixture-shaped,
  `tests/e2e/fixtures.ts`) and is imported — it is **not** duplicated per file.
  There are roughly 16 such definitions today, including `freshNativeMenuApp`
  (:1233), `menuClick` (:1246), `menuItem` (:1249), `splitApp` (:1621),
  `editorTopGutterLine` (:1646), `previewTopAnchorLines` (:1656), `pasteImage`
  (:2103), `seedFolders` (:3076), `openFolderRoot` (:3091), `openNotesRoot`
  (:3587), `dirtyActiveDoc` (:3593), `openGridDoc` (:4221), `caretInto` (:4237),
  `clickWord` (:5058), `openPath` (:6245), `menuSave` (:6253). The implementer
  confirms the list from the file rather than trusting these line numbers.
  (PRD req 12)
- The module-level constants `PHRASE` and `TOOLBAR_WAIT` (`app.spec.ts:26–28`)
  are treated the same way: one definition in `helpers.ts`, imported by the
  files that use them, with their explanatory comments carried over.
- `grep` evidence in the session shows exactly one definition site per moved
  helper across `tests/e2e/`.
- The top-level `test.beforeEach(async ({ page }) => { await freshApp(page) })`
  applies to all 136 tests today. Each new file that needs it declares it
  itself — this per-file repetition is required by Playwright's file scoping and
  does not count as duplicated helper logic — and tests that override it (the
  ones that call `freshNativeMenuApp`/`splitApp` first) behave exactly as
  before.
- No file under `tests/e2e/` exceeds **1,200** lines after the split
  (`wc -l tests/e2e/*.ts` in the session; `helpers.ts` included). (PRD req 17)

### Playwright config

- `playwright.config.ts` no longer hardcodes `testMatch: 'app.spec.ts'`. It
  matches the new desktop-shim files by glob (e.g. `testMatch: '*.spec.ts'` plus
  `testIgnore: 'web.spec.ts'`, or an equivalent pattern) so a future feature file
  is picked up without a config edit. (PRD req 13)
- `web.spec.ts` is still **excluded** from the desktop config and still owned by
  `playwright.web.config.ts`: `npx playwright test --list` shows no `W<n>` tests,
  and `npx playwright test --list --config playwright.web.config.ts` still
  collects the same web tests it does today. Both listings appear in the session.
- `npx playwright test --list` reports `Total: 136 tests in <N> files`, where
  `<N>` is the number of new split files. (PRD reqs 45)

### The count floor in scripts/validate.mjs

- `scripts/validate.mjs` enforces a **committed test-count floor** for the
  desktop-shim suite: a named constant (e.g. `E2E_TEST_FLOOR = 136`) with a
  comment in the style of `FETCH_ALLOWLIST` (`scripts/validate.mjs:113`) stating
  that any future change to the number must be justified. (PRD req 14)
- The count comes from **Playwright's own collection** — `playwright test
  --list` (parsing its `Total: N tests` line, or `--list --reporter=json`) — not
  from grepping the spec sources. This is the whole point: the number must
  reflect the real `testMatch`, so a glob that misses a file is caught.
  (PRD reqs 14, 16)
- The check fails when the collected count is **below** the constant, and the
  failure message prints both the collected count and the floor.
- It also fails — rather than passing vacuously — when the list command exits
  non-zero or its output cannot be parsed into a number. A missing/garbled
  listing must be red, never a silent zero-or-skip.
- It follows the file's existing idiom: its own `=== validate: <name> ===`
  header on stdout and `VALIDATION FAILED at step: <name>` on stderr before a
  non-zero exit.
- The floor check runs in the **`--quick` tier as well as the full gate** — i.e.
  it sits before the `if (QUICK) { … process.exit(0) }` early return at
  `scripts/validate.mjs:86`, or is added to `steps` with its name in
  `QUICK_STEPS`. Both `npm run validate:quick` and the full `npm run validate`
  path exercise it. (PRD req 15)

### Evidence

- The session shows the desktop-shim suite collecting **136** tests after the
  split and the suite itself passing (it is part of `validate:quick`). (PRD
  req 45)
- The session shows the negative case: with one split file deleted,
  `npm run validate:quick` **fails on the count floor** with a message naming
  the collected count and the floor. The deletion is then reverted and
  `git status` is shown clean (the file restored) before the final gate run.
  (PRD reqs 16, 46)

### Docs and scope

- `docs/ARCHITECTURE.md:888` (`**Playwright** (`tests/e2e/app.spec.ts`): …`) no
  longer points at a file that does not exist — it names the new layout or the
  directory. Any other *live* doc naming `app.spec.ts` is updated the same way.
- Historical material is left alone: `docs/superpowers/plans/*`, earlier
  `specs/issue-*.md`, and `docs/specs/*` are not edited.
- Scope is `tests/e2e/`, `playwright.config.ts`, `scripts/validate.mjs` and the
  one doc line. No `src/` changes, no assertion changes, no version bump, no new
  dependencies, no changes to `web.spec.ts`, `playwright.web.config.ts`,
  `tests/unit/` or `package.json` scripts.

### Gate

- The implementer iterated with fast, targeted commands — `npx playwright test
  --list` (loads every file, so it catches syntax and import errors in about a
  second), `npx playwright test tests/e2e/<file>.spec.ts` for a single area, and
  `npm run typecheck` — and ran the full gate **once**, right before declaring
  the goal met. Not after every small change, and not as a baseline at the start
  of the attempt (baseline with the quick tier only). Note that `tsconfig.json`
  includes only `src` and `tests/unit`, so `npm run typecheck` does **not** cover
  `tests/e2e/` — `--list` is the real fast check here.
- `npm run validate:quick` has been run in the implementer's session and printed
  `QUICK VALIDATION: ALL PASSED`. This is the repo's configured verify command
  (`.sandcastle/config.mts:57`); the full `npm run validate` is welcome as extra
  evidence but is not required (it needs `cargo` and a web build).
- A summary comment from the implementer exists on issue #31, naming the new
  file set with per-file test counts, the config glob chosen, where the floor
  check lives, the before/after collected counts, and the deleted-file failure
  output.

## Context

`tests/e2e/app.spec.ts` is 6,423 lines, 136 top-level `test()` calls, **zero**
`test.describe` blocks — every test is top-level, prefixed `E<n>:`, and governed
by one `test.beforeEach` at line 30. That flat shape makes the split mechanical:
each test is a self-contained block from `test('E<n>: …` to its closing `});`.
A few tests import module-scope extras (`pkg` from `package.json` at lines 1175,
1176, 2829; `readFileSync`/`fileURLToPath` at line 1198) — only the files that
need those imports should carry them.

`tests/e2e/helpers.ts` (233 lines) already exports `freshApp`, `openSettings`,
`selectPhrase`, `addComment`, `waitForSidecar`, `WELCOME`, etc.;
`tests/e2e/fixtures.ts` (22 lines) exports the console-error-guard `test`
fixture that every file must import from (`import { expect, test } from
'./fixtures'`) — importing `test` straight from `@playwright/test` would silently
drop the guard.

`scripts/validate.mjs`: `steps` is at line 57, `QUICK_STEPS` at line 70, the
quick early-exit at line 86, and the `FETCH_ALLOWLIST` pattern to copy at line
113. `npx playwright test --list` runs in ~1s and does not run the tests; its
last line today is `Total: 136 tests in 1 file`.

The desktop config is `fullyParallel: true, workers: 2`, so tests already
interleave across workers — splitting the file changes which worker runs what,
but not the concurrency model. If a test turns out to have depended on
same-file ordering, that is a real finding worth reporting rather than papering
over with `test.describe.serial`.

PRD: `prd/005-agent-context-hygiene.md` §B (requirements 9–17) and §H
(evidence 45, 46). Parent: #23. Independently landable — no dependency on the
sibling issues #32–#37.
