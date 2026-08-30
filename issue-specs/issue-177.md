# Spec: Hosted server won't start under plain node: extensionless imports in src/lib (#177)

## Goal

All acceptance criteria in issue-specs/issue-177.md are satisfied for issue #177, with evidence visible in the session: `MM_MODE=azure node server/index.ts` under plain Node (≥22.18) fails only on the documented config check (`MM_MODE=azure requires environment variables: …`) — never `ERR_MODULE_NOT_FOUND`; a unit test guards that outcome; the tsx-stopgap / "code gap" material for this limitation is gone from both hosting guides; and `npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- Every relative import reachable from `server/index.ts` carries its `.ts` file extension. The break is in the shared `src/lib` modules (~112 extensionless relative imports across ~48 files as of 2026-08-30; `server/*.ts` itself already uses `.ts` extensions); fix at least the subgraph the server reaches — fixing all of `src/lib` uniformly is acceptable and simpler to verify. `tsconfig.json` already sets `allowImportingTsExtensions: true`.
- `MM_MODE=azure node server/index.ts` with no other `MM_*` variables set gets past module resolution and exits with the config error from `server/config.ts` (`MM_MODE=azure requires environment variables: …`), not `ERR_MODULE_NOT_FOUND`.
- A unit test in `tests/unit/` (the vitest include is `tests/unit/**/*.test.ts`) guards this: spawn `node server/index.ts` with `MM_MODE=azure` and an otherwise-clean env and assert the config error is what comes back, never `ERR_MODULE_NOT_FOUND`. A resolver-based check over the import graph reachable from `server/index.ts` (asserting every relative specifier has an extension) is an acceptable alternative if spawning is too slow for the unit tier.
- The "code gap" material for this limitation is removed from the docs, leaving the documented start command (`MM_MODE=azure node server/index.ts`) as the only one: in `docs/HOSTING-AZURE.md`, the Known-limitations bullet (~line 485–498), the troubleshooting row for `ERR_MODULE_NOT_FOUND` (~line 525), and the intro warning (~line 308); in `docs/HOSTING-AZURE-PORTAL.md`, the Known-limitations bullet (~line 640+), §5.4 "The startup command that actually works today" (~line 416), the intro warning (~line 32), and the follow-on tsx-workaround references in step 6 (~lines 462–466) and the troubleshooting list (~line 543). The other Known limitation (Graph on-behalf-of exchange) stays.
- The Vite web build and the desktop build stay green — `npm run validate:quick` covers the web side; do not regress `src-tauri/`.
- The implementer iterated with `npm run typecheck` and `npm run test:unit` (or tests targeted at the changed code), and ran `npm run validate:quick` ONCE, right before declaring the goal met — not after every small change and not as a starting baseline (baseline with the quick tier only). It passes with `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #177.

## Context

The production entry `server/index.ts` documents starting under plain `node` (PRD 007 Req 1), but the shared `src/lib` modules it imports (via `server/app.ts` → `src/lib/llmSeam.ts`, `commentFormat`, `fuzzy`, `hostedWorkspace`, `llmProviders`, …) use extensionless relative imports, which Node's ESM loader rejects. `npm run server:local` masks this because it runs under `tsx`. A mechanical rewrite (`from './x'` → `from './x.ts'`) across `src/lib` is fine — Vite and vitest both accept `.ts` specifiers with `allowImportingTsExtensions`. Watch for any `import type` and dynamic `import()` sites too. Out of scope: the Graph on-behalf-of token exchange (the other Known limitation). Read `.sandcastle/CODING_STANDARDS.md` before writing code; check `docs/MAP.md` if unsure which spec owns a file.
