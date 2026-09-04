# Spec: Gate-enforce the editor package boundary and add editor/AGENTS.md directives (#239)

## Goal

All acceptance criteria in issue-specs/issue-239.md are satisfied for issue #239, with evidence visible in the session: the quick tier of `scripts/validate.mjs` fails on any static import from `editor/` into `src/`, `server/`, or `src-tauri/` and on any deep-path app import of `@marky-mark/editor/...`; `editor/AGENTS.md` exists carrying the package's agent directives with a one-line pointer to it in root `AGENTS.md`; `npm run validate:quick` passes in the implementer's session; and a summary comment from the implementer exists on issue #239.

## Acceptance criteria

- (PRD 021 Req 10) A boundary check exists in the quick tier of `scripts/validate.mjs`: it statically scans the modules under `editor/` (sources and tests) and fails validation if any of them imports from `src/`, `server/`, or `src-tauri/` — whether by relative path escaping the package (e.g. `../../src/...`) or by any alias resolving there. Spawn-free, synchronous file reads, sitting with the other file checks that run ahead of the `steps` array (the style-lint check at `scripts/validate.mjs:242` is the model).
- (PRD 021 Req 10) The same check enforces the entry-point rule in the other direction: app code (`src/`, `server/`) may import the package only as `@marky-mark/editor` (its exported entry points per `editor/package.json` `exports`) — any deep-path import such as `@marky-mark/editor/src/...` fails validation. (The current tree already complies: `rg '@marky-mark/editor/' src server` finds nothing; the check keeps it that way.)
- The check's failure output names the offending file, line, and forbidden import, so a violator can be fixed from the gate output alone. Demonstrated once in the session: a deliberate temporary violation makes `node scripts/validate.mjs --quick` (or the check's unit tests) fail, then is reverted.
- The scan logic is importable and unit-tested (the `scripts/style-lint.mjs` + `tests/unit/style-lint.test.ts` pattern): tests cover at least one caught editor→app import, one caught deep-path app import, and the clean case. Code carries a `PRD 021 Req 10 (issue #239)` citation comment in the style of the neighboring checks.
- (PRD 021 Req 11) `editor/AGENTS.md` exists — short and agent-facing — stating: what the package is, that it may never import from `src/`, `server/`, or `src-tauri/`, that new app-flavored needs become seams/props (never reverse imports), that its styles/tests/docs live in-package, and that the validate.mjs boundary check enforces all of this.
- (PRD 021 Req 11) Root `AGENTS.md` contains a one-line pointer to `editor/AGENTS.md` and remains within its documented size budget (~150 lines; it is 97 today).
- The implementer iterated with `npm run typecheck` and `npm run test:unit` (or tests targeted at the changed code), and ran `npm run validate:quick` ONCE at the end — right before declaring the goal met, not after every small change and not as a full baseline at the start — and it printed `QUICK VALIDATION: ALL PASSED` in the implementer's session.
- A summary comment from the implementer exists on issue #239.

## Context

Parent #224; PRD `prd/021-embeddable-editor.md` Reqs 10–11 (lines ~123–132). The `editor/` workspace package (`@marky-mark/editor`) was created by #237; its entry point is `editor/src/index.ts` and `editor/package.json` `exports` maps only `"."`. `scripts/validate.mjs` already runs several spawn-free file checks in the quick tier ahead of the `steps` array (symlink check ~line 178, test-ID scan ~line 213 which already walks `editor/`, style lint ~line 242) — add the boundary check alongside them, following the style-lint pattern of an importable scripts module with unit tests. Root `AGENTS.md` is the file to add the pointer line to (`CLAUDE.md` is a symlink to it — edit `AGENTS.md`, never break the link). Note there is no `npm test` script at root; unit tests are `npm run test:unit`.
