# Spec: Create root archive/ and move docs/goals/, docs/superpowers/plans/ and docs/archive/ into it (#33)

## Goal

All acceptance criteria in issue-specs/issue-33.md are satisfied for issue #33, with
evidence visible in the session: a root `archive/` holds all 45 files moved
unchanged from `docs/goals/`, `docs/superpowers/plans/` and `docs/archive/`;
every surviving reference to those old paths (`CONTRIBUTING.md`, the three
`control-panel/` files, `docs/specs/SPEC18.md`) points at the new location and
the control panel still lists and serves the archived article; `archive/README.md`
explains the directory; and `npm run validate:quick` passes.

## Acceptance criteria

- A root `archive/` directory exists, tracked in git, holding the material
  agents are not expected to read (PRD 005 requirement 18).
- The 45 files below have moved into `archive/`, content unchanged, and no
  longer exist at their old paths (requirement 19):
  - `docs/goals/` → `archive/goals/` (35 files)
  - `docs/superpowers/plans/` → `archive/superpowers/plans/` (8 files); with
    `plans/` gone, `docs/superpowers/` no longer exists
  - `docs/archive/` → `archive/articles/` (2 files:
    `how-marky-mark-is-built.html` and `.md`)
- The moves are recorded as renames in git — `git diff -M --summary main...HEAD`
  (or `git show --stat -M HEAD`) reports the 45 files as renames, not as
  delete+add pairs, and no moved file's bytes changed.
- `specs/`, `prd/` and `docs/specs/` have **not** moved and are untouched by
  this change apart from the single `docs/specs/SPEC18.md` edit below
  (requirement 20).
- `CONTRIBUTING.md` (the `docs/goals/` link around line 51) points at
  `archive/goals/`, and the surrounding sentence still reads correctly given the
  directory is now archived (requirement 21).
- `control-panel/` serves the article from the new location (requirement 22):
  `control-panel/server.js` (`DOCS_DIR` and the two comments near lines 437–446
  and 543), `control-panel/public/app.js` (comment and empty-state string near
  lines 265–270) and `control-panel/README.md` (lines 31–34, including the
  relative link) all name the new path. No other `control-panel/` behaviour
  changes.
- The panel is demonstrated working after the move: with the server started
  against this checkout (e.g.
  `MARKY_REPO=$PWD PORT=8099 node control-panel/server.js`), `GET /api/docs`
  lists `how-marky-mark-is-built.html` with its `<title>`, and
  `GET /docs/how-marky-mark-is-built.html` returns 200 with the article body.
  The command output is visible in the session.
- `docs/specs/SPEC18.md:106` — the prose reference to `GOAL18` — carries a
  pointer to the file's new location (`archive/goals/GOAL18.md`) so the
  reference does not dangle (requirement 23). No other `docs/specs/` file is
  edited; `rg -o 'GOAL[0-9]+' src tests` still returns nothing.
- `archive/README.md` exists and states: what the directory is, that its
  contents are excluded from agent context, how to consult it deliberately when
  you actually want it, and that nothing in it has been deleted or left
  unversioned (requirement 24). It does **not** need the
  "guardrail, not a security boundary" statement — PRD requirement 27 lands in
  the `AGENTS.md` sub-issue so it is written once against both files.
- No stale references remain: `rg -n 'docs/goals|docs/superpowers|docs/archive'`
  over the working tree, excluding `node_modules/`, `prd/` and `specs/`, returns
  no hits. (`prd/005-agent-context-hygiene.md` describes the pre-move state and
  is not edited; the issue body is owned by the owner and is never edited.)
- Nothing is deleted: every one of the 45 files is still present in the
  repository and reachable in git history.
- While iterating, use `npm run typecheck` and `npm run test:unit` (plus the
  targeted control-panel curl check above). Do **not** run the full gate after
  every change and do not run it as a baseline — baseline with the quick tier
  only.
- `npm run validate:quick` has been run once in the implementer's session, right
  before declaring the goal met, and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #33 describing what
  moved, which references were updated, and the verification evidence.

## Context

Everything here is a file move plus five reference updates; there is no `src/`
change, so unit tests and typecheck are unaffected but should still be run.

- Current reference sites (verified 2026-08-03): `CONTRIBUTING.md:51`;
  `control-panel/server.js:437,446,543` (`DOCS_DIR = path.join(REPO, 'docs',
  'archive')`); `control-panel/public/app.js:265,270`;
  `control-panel/README.md:31,34`; `docs/specs/SPEC18.md:106`. Nothing else in
  the tree mentions the three directories.
- `docs/superpowers/` contains only `plans/`, so the whole directory moves.
- `control-panel/server.js` `listDocs()` filters to `.html`, so putting
  `archive/README.md` at the archive root is harmless — but `archive/articles/`
  keeps the Docs tab scoped to actual articles.
- The control panel is zero-dependency plain Node; `MARKY_REPO` defaults to
  walking up from `control-panel/`, and `PORT` defaults to 8080. Pick a free
  port and kill the server after the check.
- `npm run validate:quick` (`node scripts/validate.mjs --quick`) runs version
  lock-step, typecheck, unit tests and the Playwright desktop-shim e2e suite;
  it is the repo's quick gate per `.sandcastle/config.mts:57`. The full
  `npm run validate` is not required by this issue.
- PRD: `prd/005-agent-context-hygiene.md`, section C (requirements 18–24).
  Parent issue: #23. Sections D (`.claude/settings.json` deny rule) and A
  (`AGENTS.md`) are separate sub-issues — do not implement them here.
