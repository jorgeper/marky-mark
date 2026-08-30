# Spec: Hosted e2e lane: a killed test's crash-safe draft poisons every later test (no store reset) (#179)

## Goal

All acceptance criteria in issue-specs/issue-179.md are satisfied for issue #179, with evidence visible in the session: every hosted e2e test starts from a store with no crash-safe draft for its user and no leftover state from a previous test or run; a deliberately poisoned store (a draft written for the mock user before the next hosted test) no longer fails that next test; `npm run validate:quick` has been run once in the implementer's session and passed with no draft-restore cascade; and a summary comment from the implementer exists on issue #179.

## Acceptance criteria

- Every hosted e2e test starts from a store with no `draft.json` for its signed-in user and no leftover state (drafts, workspaces) from a previous test or a previous gate run. The implementer picks the mechanism — either the hosted lane's reset discards the user's draft (and any per-test state it relies on being absent) between tests, or the e2e lane runs Azurite with `--inMemoryPersistence` or a per-run temp `--location` instead of the persistent `node_modules/.cache/azurite` that `server/local.ts:46` uses today. `npm run server:local` run by hand for local development may keep persisting state.
- The poison scenario is dead: writing a draft blob for the mock user (simulating a test killed mid-edit) and then running the next hosted test no longer fails that test with the SPEC30 §3 "Restore unsaved changes?" overlay intercepting clicks. This is covered either by a test in `tests/e2e/` or by a documented manual check pasted into the implementer's issue comment.
- One `npm run validate:quick` run, executed in the implementer's session right before declaring the goal met, passes — with no cascade of hosted failures (E175–E196, E212–E220) or `tables.spec.ts` E112–E114; per the implementer rules, a flake that passes on `npm run test:e2e:failed` retry is acceptable, a repeating pattern of draft-overlay timeouts is not.
- `docs/DEVELOPING.md` (or `server/README.md` § Local development) states where the local lane's Azurite state lives and how to wipe it.
- A summary comment from the implementer exists on issue #179 describing what changed and carrying the manual-check evidence if that route was taken for the poison scenario.
- Iteration was done with `npm run typecheck` and `npm run test:unit` (or single targeted e2e tests via `npx playwright test -g '<title>'`), not repeated full gates: the full `npm run validate:quick` gate runs ONCE at the end, not after every change and not as a baseline at the start.

## Context

The failure chain: SPEC30 §3's crash-safe draft (`src/lib/drafts.ts`, applied at boot in `src/App.tsx` ~line 2655) writes `draft.json` to the config dir, which on hosted resolves to the signed-in user's roaming blob (`server/userFiles.ts`, PRD 007 Req 9, path layout in `src/lib/hostedPaths.ts`). A hosted test killed mid-edit leaves that blob behind; every later test signing in as the same mock user boots into the "Restore unsaved changes?" overlay, its clicks are intercepted, it times out, and leaves its own draft — one kill cascades through the suite, and `retries: 1` meets the same overlay.

Two gaps to close: (1) `tests/e2e/helpers.ts`'s `freshApp` reset wipes the desktop shim fs only — nothing clears hosted user state, and `tests/e2e/hosted.spec.ts` has its own `signIn`/`signInTo` helpers with no store reset; (2) `server/local.ts` starts Azurite at the persistent `node_modules/.cache/azurite`, so leftovers survive across gate runs and into every Sandcastle worktree (`node_modules` is copied in). `playwright.config.ts` launches the hosted lane via its second `webServer` entry (`npm run server:local`), so an env var set there is a clean way to make "started for e2e" behave differently from hand-run `server:local`. Issue #177's branch is blocked on this: it is complete and only needs a gate that can pass.
