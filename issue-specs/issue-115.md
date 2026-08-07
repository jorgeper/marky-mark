# Spec: Summary cache store: content-hash keyed, size-capped on desktop, workspace-scoped on hosted (#115)

## Goal

All acceptance criteria in issue-specs/issue-115.md are satisfied for issue
#115, with evidence visible in the session: summaries keyed by #110's
`summaryCacheKey` survive across zoom cycles, document reopens and process
restarts through a persistent store that exists on both flavors — on desktop a
byte-capped, oldest-out-evicting store under `configDir()`, on hosted a
server-side store scoped to the workspace under `workspaces/<id>/` in the
deployment-default store (outside `files/`, so it never lands in the user's
repository or beside the document) and shared by every member — reached from
the browser through the existing same-origin `api(...)` wrapper with
`FETCH_ALLOWLIST` still 4 and no consumer wired up yet;
`npm run validate:quick` has been run once at the end and printed
`QUICK VALIDATION: ALL PASSED`; and a summary comment from the implementer
exists on issue #115.

## Acceptance criteria

### Req 28 — content-hash keyed, and it actually persists

- The store's keys are #110's, unchanged: `summaryCacheKey` /
  `summaryKeyForSection` / `summaryKeyForEntry` from `src/lib/summaryCache.ts`.
  This issue adds **no second keying scheme** and does not re-hash content; it
  is the storage layer under the existing keys.
- A stored entry carries at least: the key, the summary text, the provider and
  model it came from, the prompt version (`SUMMARY_PROMPT_VERSION`), and a
  timestamp used for eviction ordering. Whatever usage data #119 will want
  (token counts) is either carried or explicitly out of scope in a comment —
  not silently dropped by a shape that cannot hold it.
- **Persistence is proven, not assumed.** A test writes entries through one
  store instance, discards it, builds a second instance over the same backing
  bytes/blobs, and reads the same summaries back — the "app restart" and
  "document reopen" halves of Req 28.
- **Editing a section invalidates only that section.** A test drives
  `reconcileSummaryKeys` against the store: after one section's content
  changes, that section reads as a miss while every other section still hits,
  and a section that merely moved elsewhere in the document still hits.
- A get for an unknown key is a **miss, not an error**, and a get whose stored
  entry is malformed (truncated JSON, wrong shape, wrong version) is also a
  miss — corruption-tolerant in the style of `parsePositions`
  (`src/lib/readingPositions.ts`) and `parseDraft` (`src/lib/drafts.ts`),
  never a throw into the caller.
- Time is **injected**, not ambient: eviction ordering and entry timestamps
  come from a clock parameter (the `src/lib/time.ts` precedent), so tests pin
  eviction order deterministically and the pure layer keeps its no-`Date.now`
  property.

### Req 29 — desktop: app config directory, size-capped, oldest-out

- The desktop store lives under the app config directory reached through the
  `Platform` seam (`platform.configDir()`, `join`, `readTextFile`,
  `writeTextFile`, `mkdirp`, `exists`, `remove`) — the same place
  `positions.json`, `draft.json` and `themes/` already live. It never writes
  to the document's directory, a workspace folder, or any path derived from a
  document path; a test asserts every path the store touches is under the
  config directory it was handed.
- The cap is expressed in **bytes** (a named constant with a comment saying
  why that number), and the store enforces it: after a write that would exceed
  the cap, entries are dropped **oldest-out** until the store is back under
  it. Which "oldest" — least recently written or least recently used — is the
  implementer's call, stated in a citation comment and pinned by a test that
  fixes the eviction order for a known sequence of writes and reads.
- Edge cases are pinned: an entry larger than the cap on its own does not
  wedge the store (it is refused or it evicts everything else — either, but
  documented and tested); eviction never removes the entry just written while
  a strictly older one remains; and an empty or missing store file reads as an
  empty cache, not a failure.
- No new dependency, no `console.*` in `src/`, and no I/O in `src/lib/`:
  pure store logic (parse, serialize, size accounting, eviction) lives in
  `src/lib/` and takes its file access as an argument, following the
  drafts/positions split where the pure layer is in `src/lib/` and the I/O is
  at the call site. `src/lib/summaryCache.ts` (#110's pure keying) keeps
  passing `tests/unit/zoom-purity.test.ts` — if the purity guard scans a
  module list, the new I/O-bearing module is not smuggled into it.

### Req 29 — hosted: server-side and scoped to the workspace

- The server gains a cache surface under `/api/workspaces/<id>/…` (exact
  sub-path the implementer's call), inside `server/workspaces.ts`'s existing
  auth and membership handling: read a key, write a key, and — for #120 and
  Req 30 — report roughly how much the workspace's cache holds and delete it
  outright. Unauthenticated requests get the same `401` every other `/api/`
  route gives; a non-member gets `403` from `requirePermission` with an
  **existing** verb from the fourteen in `src/lib/hostedWorkspace.ts` (PRD 007
  Req 13 fixes that catalog — `doc.read` for reads is the natural fit; do not
  add a fifteenth verb).
- **The cache is workspace-scoped, and two workspaces cannot see each other's
  entries.** A test writes the same key under workspace A and reads it under
  workspace B and gets a miss; a second member of workspace A reading that key
  gets a **hit** — that reuse between members is the point of Req 29.
- **It is never in the user's repository or workspace files.** Cache blobs
  live in the **deployment default** store under `workspaces/<id>/…` and
  **outside** `files/` — the `backendRecordPath` precedent in
  `server/backends.ts`. Tests pin all three consequences: for a workspace
  whose backend is a BYO repo, writing a cache entry produces **no** write to
  that repo-backed provider; `GET /api/workspaces/<id>/files` never lists a
  cache blob; and the cache path is unreachable through the `/api/files/`
  scaffold (already covered by `RESERVED_PREFIXES` in `server/app.ts` — assert
  it, do not assume it).
- The hosted browser side is an **optional `Platform` capability** declared in
  `src/platform/types.ts` next to `llm?` and implemented only by
  `src/platform/hosted.ts`, per `.sandcastle/CODING_STANDARDS.md` §
  Architecture: get, put, size and clear. App code will mount on the
  capability's presence, never on `platform.kind`.
- **No new client-side network call site.** Every hosted request goes through
  the existing same-origin, bearer-authenticated `api(...)` wrapper
  (`src/platform/hosted.ts`), exactly as `createHostedLlm` does;
  `FETCH_ALLOWLIST` in `scripts/validate.mjs` stays at `4` and the bundle scan
  finds no new `fetch(` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` /
  `EventSource` in `src/`.
- `src/platform/web.ts` (the static single-file web build) leaves the
  capability **undefined** — that build has no server and no LLM, and #114
  owns the no-network guarantee it must not dent. The desktop shim
  (`src/platform/browser.ts`) may implement it over its virtual fs so later
  e2e work has something to drive; if it does, it uses the same shared store
  code as `tauri.ts` rather than a second implementation.
- If the hosted side gains an **operator-facing knob** (e.g. a per-workspace
  size cap in the server environment), it is named in both
  `docs/HOSTING-AZURE.md` and `docs/HOSTING-GITHUB.md` and passes the existing
  drift guard in `tests/unit/docs-hosting-llm.test.ts` (U536), which fails if
  a guide names an `MM_*` variable the loader does not read or misses one it
  does. If no knob is added, neither guide changes.

### Scope: a store, not a consumer

- **Nothing user-visible ships.** No settings UI, no menu item, no command, no
  hotkey, no zoom view, no summarization call. Nothing in the app calls the
  store yet: #118 wires generation to it, #120 renders inspect/clear (Req 30)
  on the size/clear operations this issue exposes, #117 owns the view. The
  exported shapes are chosen for those consumers.
- Both flavors present the **same store interface** (get, put, size, clear),
  so the later consumer is written once against the capability rather than
  branching per flavor.
- Every existing unit and e2e test still passes unmodified — none weakened,
  skipped, renumbered or deleted — and `npm run map` leaves `docs/MAP.md`
  unchanged (this issue's citations are `PRD 011 Req <n>`, not `SPEC<n>`); if
  a `SPEC<n>` citation is added after all, the regenerated `docs/MAP.md` is
  committed.
- Every new module, route handler and exported type carries a
  `PRD 011 Req <n>: <what and why>` citation comment per
  `docs/COMMENT-FORMAT.md` and `.sandcastle/CODING_STANDARDS.md`.

### Tests and verification

- New unit tests live in `tests/unit/`, one file per new `src/lib/` module
  with the matching kebab-case name (`summaryCacheStore.ts` →
  `summary-cache-store.test.ts`), plus route coverage in the
  `tests/unit/server-workspaces.test.ts` shape (`createApp` on a loopback port
  with the mock auth provider and an in-memory storage seam). Every test title
  starts with the next unused `U<n>` id — the suite is at **U539** today, so
  start at **U540**, never reuse or renumber — and `describe` blocks name the
  contract (e.g. `describe('PRD 011 Req 29 — the workspace-scoped summary
  cache')`). Tests must not depend on per-file isolation (`isolate: false`).
- **No test contacts a real provider or a real network host.** This issue
  makes no provider call at all; the server tests drive the in-memory storage
  seam, and the desktop store tests drive a fake/virtual file layer.
- No e2e test is required — the enumerated e2e matrix is #121's, including
  Req 35's "the cache prevents a second call for unchanged content", which
  needs #118's consumer to be observable. `E2E_TEST_FLOOR` (226) does not
  move; if an e2e test is added anyway it starts at `E226`.
- The implementer iterates with `npm run typecheck` and `npm run test:unit`
  (or a targeted `npx vitest run tests/unit/<file>.test.ts`) — seconds each.
  Any baseline taken at the start of an attempt uses the quick tier only; the
  full gate is **not** a baseline step and is not re-run after each change.
- `npm run validate:quick` is run **once**, right at the end, immediately
  before declaring the goal met, and prints `QUICK VALIDATION: ALL PASSED`.
  The full `npm run validate` is not required for this issue.
- A summary comment from the implementer exists on issue #115, naming the
  modules and routes added, the desktop cap and eviction rule, the hosted
  blob layout, the `U<n>` ids covering persistence / eviction / workspace
  scoping / repo-and-files exclusion, and the gate result.

## Context

The contract is `prd/011-semantic-zoom-and-llm-providers.md` Reqs 28 and 29
(Req 30's inspect-and-clear UI is #120's, but its two operations come from
here). Parent is #108; #110 (merged) landed the keys, #113 (merged) landed the
hosted `/api/llm` proxy and the `llm?` capability whose shape this issue
mirrors. #112 (desktop LLM transport) is still open and this issue does not
depend on it — a cache with no producer yet is exactly what the issue asks for.

Read first: `src/lib/summaryCache.ts` (keys, `reconcileSummaryKeys`,
`SUMMARY_PROMPT_VERSION`), `src/platform/hostedLlm.ts` + `src/platform/types.ts:265`
(how an optional hosted-only capability is declared and wired at
`src/platform/hosted.ts:603`), and `server/backends.ts` (`backendRecordPath` —
the established "app metadata under `workspaces/<id>/`, outside `files/`, in
the deployment default store" pattern, and the reason a BYO-repo workspace's
cache must not follow its files into the repo).

For the desktop half, `src/lib/readingPositions.ts` (capped, corruption-
tolerant JSON store) and its I/O at `src/App.tsx:1258` / `:2237` show the
split this repo uses: pure parse/serialize/cap in `src/lib/`, `configDir()`
file I/O at the edge. `server/workspaces.ts` holds `WORKSPACES_PREFIX`,
`filesPrefix`, `requirePermission` and the route dispatch;
`server/app.ts` holds `RESERVED_PREFIXES` and the bearer-auth guard.

Costs, per CLAUDE.md: `npm run typecheck` + `npm run test:unit` are the
seconds-long inner loop; `npm run validate:quick` adds the minutes-long,
machine-serialized Playwright suite — run it once, at the end.
