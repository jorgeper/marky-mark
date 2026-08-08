# Spec: Real summaries in the zoom view: on-demand generation, pending and cancellation, per-section failure and retry (#118)

## Goal

All acceptance criteria in issue-specs/issue-118.md are satisfied for issue
#118, with evidence visible in the session: where a provider is available,
entering a zoomed level (L1–L4) fills each block with a real summary generated
through the existing seam — only for the slots that level shows, and only for
keys the `platform.summaryCache` store misses, while typing, saving and opening
a document make no LLM call at all; each block shows its structure with a
pending state until its result lands, and leaving the level, closing or
switching the document, editing the buffer or turning the feature off abandons
outstanding work so a late result is never rendered into a changed document; a
failed section renders the seam's own reason (rate limited, bad key,
unreachable host, …) with a per-section retry that re-requests only that
section while every summarized block stays displayed; with no provider
available the view keeps #117's excerpts and its excerpt notice exactly as they
are; `npm run validate:quick` was run once at the end and printed
`QUICK VALIDATION: ALL PASSED`; and a summary comment from the implementer
exists on issue #118.

## Acceptance criteria

### Req 25 — on demand, this level only, cache misses only

- Summaries are requested **only** when the reader enters a zoomed level
  (L1–L4) or clicks a per-section retry. No request is made on app start, on
  document open, on a settings change, on a module import, on a component
  mount, or on any timer — PRD 011 Req 16, and every request the feature builds
  carries `trigger: 'summarize'` (`LlmRequest` in `src/lib/llmSeam.ts`).
- Only the slots the **current** level shows are requested: the request set is
  derived from `zoomView()`'s entries for that level via
  `summaryKeyForEntry()` (`src/lib/summaryCache.ts`), not from every section in
  the document. Moving from L4 to L2 does not re-request what L4 already
  filled if the keys coincide.
- Every slot is looked up in `platform.summaryCache` (the
  `SummaryCacheStore` capability from #115) **before** any request is built; a
  hit fills the block with no call. A hit is a hit across zoom cycles, document
  reopens and app restarts — the store already guarantees persistence, so this
  issue must not add a second in-memory keying scheme that defeats it (a
  session-level memo of the same keys is fine, and must not answer for a key
  the store missed).
- Every generated summary is written back through `store.put()` with the
  entry shape #115 defined: key, summary text, `providerId`, `modelId`,
  `promptVersion` (`SUMMARY_PROMPT_VERSION`), and the provider-returned usage
  when `LlmUsage.known` is true — mapped onto the store's optional
  `usage: { promptTokens, completionTokens }` field, and **omitted** (never
  zeroed) when the provider reported none.
- A window with no store capability (`platform.summaryCache` undefined) still
  summarizes — the cache is an optimisation, not a precondition — and a store
  whose get or put throws or answers a miss degrades to "summarize again",
  never to a broken view.
- **Typing, saving and opening a document trigger no LLM call.** A unit test
  over the pure planning layer and a desktop-shim e2e both prove it: typing at
  L5 with a provider configured leaves the fake's call log empty.
- Which `SummaryKeyContext` applies right now — `level`, `providerId`,
  `modelId` — is answered by one pure function, from the resolved desktop
  config (`llmAreaState()` → `state: 'ready'`) or from the hosted
  `LlmAvailability` (`state: 'hosted'`), never assembled inline at two call
  sites. Changing provider or model changes the key, so summaries from a
  different model are never served as this one's.

### Req 26 — pending, filling in, and cancellable

- Every block a level shows renders immediately with its heading, depth and
  folded-in list (#117's structure) plus a **pending state** while its summary
  is in flight: a distinct, testable state with its own `data-testid`, not an
  empty block and not a silent excerpt masquerading as a summary.
- Blocks fill in **independently, as results arrive** — the view never waits
  for the whole level before showing anything, and a slow section does not hold
  up a fast one.
- The number of requests in flight at once is **bounded** by a named constant
  with a comment saying why, and requests are issued in document order so the
  behaviour is deterministic enough to test.
- **Cancellation.** Leaving the level (including returning to L5), closing the
  document, switching to another document or tab, editing the buffer, and
  turning the Experimental feature off all abandon outstanding work: no further
  request is issued for the abandoned run, and any result still in flight is
  **never rendered**. Whether an already-issued request is also aborted at the
  transport is the implementer's call (the seam takes no abort signal today);
  what is not optional is that its result reaches no view state.
- **No stale result reaches a changed document.** The guard is a pure,
  unit-tested rule over a run identity (document identity + content/level +
  key context), not an ad-hoc `if (mounted)` scattered through a component: a
  result whose run identity no longer matches the current one is dropped. A
  test drives the sequence "request issued → buffer edited → result resolves"
  and asserts the view shows the new document's state, never the old summary.
- A dropped result **may** still be written to the cache (the key is
  content-addressed, so it is correct for the content it summarized); whichever
  way the implementer decides, a citation comment says which and why.
- Re-entering a level after cancellation re-plans from the cache: work that
  completed and was stored is a hit, and only what is still missing is
  requested.

### Req 27 — per-section failure, legible and retryable

- A failed section renders the seam's own `LlmFailure` message
  (`src/lib/llmSeam.ts` — `bad-key`, `unknown-model`, `unreachable-host`,
  `rate-limited`, `invalid-config`, `unexpected`), with the `retryAfterSeconds`
  hint appended where the provider sent one. The wording comes from the seam,
  reusing `testFailureMessage()` (`src/lib/llmSettings.ts`) or a shared helper
  factored out of it — this issue writes **no** second sentence per failure
  kind, and nothing it renders can carry key material (the seam already
  redacts; do not defeat it by rendering raw provider text from elsewhere).
- The failed block still shows its heading, depth and folded-in list: a failure
  costs the summary, not the structure.
- Each failed block carries its **own retry control** with a `data-testid`.
  Clicking it re-requests **only that section** — a unit test on the pure layer
  asserts the retry plan holds exactly one key, and the e2e asserts the fake's
  call count grows by one.
- **Successfully summarized sections stay displayed** across a sibling's
  failure and across a retry: a retry re-renders the failed block only, and no
  other block reverts to pending or to an excerpt.
- **One failure never empties the view.** A level where every section fails
  still renders every heading and every failure reason, with the document title
  and the "back to full document" action intact.
- A retry that fails again shows the new failure and stays retryable —
  retrying is not one-shot, nothing auto-retries on a timer, and nothing
  retries without a click (Req 16).

### Req 22 preserved — excerpts where there is no provider

- With no LLM available — no `llmTransport` and no `llm` capability (static
  web), a hosted deployment whose operator configured nothing, or a desktop
  window whose `llmAreaState()` is `unconfigured` — every level still renders
  #117's `excerptFromBody()` blocks with the existing `EXCERPT_NOTICE`,
  `EXCERPT_CONFIGURE_HINT` / no-path copy, and the existing
  `semantic-zoom-excerpt-note` / `semantic-zoom-configure` /
  `semantic-zoom-no-llm` test ids **unrenamed**. `tests/e2e/semantic-zoom.spec.ts`
  (E229–E234) and `tests/unit/static-web-no-llm.test.ts` keep passing as
  written.
- Conversely, the view **stops claiming a block is an excerpt when it is a
  summary**: the excerpt notice is rendered only where the blocks really are
  excerpts, and a level showing model-generated summaries says so instead (its
  own copy, its own `data-testid`, stated once for the view, never per block).
  A block that is a summary, a pending slot, a failure and an excerpt are four
  distinguishable rendered states.
- Where a provider is available but an individual section falls back to an
  excerpt (implementer's call whether a failed block also shows its excerpt),
  the block says which it is — a failure reason is never dressed as a summary.
- The decision "what does this block show right now?" is a pure function over
  (cache hit | in flight | failed | no provider), unit-tested without a DOM.
  `src/components/SemanticZoomView.tsx` keeps holding no rules.

### How the request is made — capability, not flavor

- The runner is chosen by **capability**, exactly as `runLlmTest` in
  `src/App.tsx` already does: a hosted `platform.llm` client runs the request
  server-side, a desktop `platform.llmTransport` runs it through
  `runLlmRequest(transport, config, request)`. Nothing branches on
  `platform.kind` (`.sandcastle/CODING_STANDARDS.md` § Architecture). The
  runner selection is written **once** — factor the existing one out rather
  than adding a second copy beside it.
- The summarization prompt is the **app's**, not user-editable: one pure module
  builds the system + user prompt from the level and the entry's source text,
  asking for the shape PRD 011 Req 17 promises (a short 2–3 sentence summary
  per section; one paragraph for the whole document at L1). It bounds
  `maxOutputTokens` (the `SUMMARY_OUTPUT_TOKENS` allowance in
  `src/lib/llmCost.ts` is the existing number) and it truncates or bounds the
  input it sends so a very long section cannot build an unbounded request —
  the bound is a named constant with a comment.
- If the prompt's shape means an already-cached summary would answer a
  different question, `SUMMARY_PROMPT_VERSION` is bumped; if the prompt is
  simply being authored for the first time, it stays `p1` and a comment says
  so.
- **No new network call site.** `src/` gains no `fetch(`, `XMLHttpRequest`,
  `WebSocket`, `sendBeacon` or `EventSource`; `FETCH_ALLOWLIST` in
  `scripts/validate.mjs` stays at **6** and `E2E_TEST_FLOOR` stays at **226**.
  No `console.*` lands in `src/`.
- New pure modules live flat in `src/lib/` with `PRD 011 Req <n>` citation
  comments, import no `react`, no `@tauri-apps/*`, nothing from
  `src/components/` or `src/platform/`, and touch no DOM. Adding them to the
  `MODULES` list in `tests/unit/zoom-purity.test.ts` is encouraged where they
  qualify; a module that legitimately holds orchestration (promises, the
  platform capability) is not smuggled into that list.

### Scope fence

- This issue ships generation, pending/cancellation and per-section
  failure/retry, and nothing downstream: **no** cost estimate, price table,
  measured-usage display or pre-summarization confirmation (#119 owns Req
  33 — summaries in this issue start on entering the level, and nothing here
  forecloses a confirmation step being added in front of it); **no** cache
  inspection, clearing, key removal or stand-down UI (#120); **no** enumerated
  availability/e2e matrix (#121).
- It changes no contract it consumes: `src/lib/llmSeam.ts`,
  `src/lib/llmProviders.ts`, `src/lib/llmFake.ts`'s scripting surface,
  `src/lib/summaryCache.ts`'s keys, `src/lib/summaryCacheStore.ts`'s entry
  shape, `src/lib/zoomLevels.ts`, `src/lib/sectionModel.ts` and the LLM
  providers settings tab need no behavioural change. Extending
  `ZoomBlock.body` from #117's `Excerpt` to the four-state union is expected
  and is a `src/lib/semanticZoom.ts` change, not a re-implementation of the
  level mapping.
- The static web build gains nothing: it has no transport, no client and no
  store, so it renders exactly what it renders today.
- No existing unit or e2e test is weakened, skipped, renumbered or deleted.

### Tests

- New unit tests live in `tests/unit/`, one file per new `src/lib/` module with
  the matching kebab-case name. Every new test title starts with the next
  unused stable id — unit ids continue from **U597**, desktop e2e from
  **E235** — and `describe` blocks name the contract (e.g.
  `describe('PRD 011 Req 26 — pending summaries and cancellation')`). Tests do
  not depend on per-file isolation (`isolate: false`).
- Unit coverage lands, at minimum: the plan for a level requests only that
  level's uncached keys; a cache hit produces no request; the four block
  states; the stale-result guard drops a result whose run identity changed; a
  retry plan holds exactly the one failed key; the prompt is built per level
  and bounds its input; usage is carried when known and omitted when not.
- **No test contacts a real provider** (PRD 011 Req 35). Unit tests drive
  `createFakeLlm()` (`src/lib/llmFake.ts`) through the real seam; the
  desktop-shim e2e drives the fake the shim already installs as its
  `llmTransport` (`src/platform/browser.ts:531`).
- Desktop-shim e2e coverage lands, at minimum: with a provider configured
  through the LLM providers tab, a zoomed level fills its blocks with the
  fake's summaries (pending observed or, if racy, asserted through a scripted
  slow reply); a scripted per-section failure shows the reason, retries on
  click and leaves its siblings' summaries displayed; and re-entering the same
  level makes no second call (the cache). If scripting an outcome needs a
  handle on the shim's fake, exposing one is allowed — dev/e2e shim only
  (`src/platform/browser.ts`), never in `tauri.ts`, `hosted.ts` or `web.ts`,
  and it does not change `createFakeLlm`'s surface.
- Every new interactive control ships a `data-testid` and is driven by it;
  existing ids are not renamed. New e2e setup reuses
  `tests/e2e/helpers.ts` / `fixtures.ts` rather than re-implementing it.
- Every new module, exported type and rendered state carries a `PRD 011 Req
  <n>: <what and why>` citation comment per `docs/COMMENT-FORMAT.md`.

### Verification

- The inner loop is `npm run typecheck` plus `npm run test:unit` (or tests
  targeted at the changed code — `npx vitest run tests/unit/<file>.test.ts`,
  `npx playwright test -g '<title>'`). The e2e suite is **not** run after every
  small change, and the full gate is **not** run as a baseline at the start of
  an attempt — any baseline uses the quick tier only.
- `npm run validate:quick` has been run **once**, at the end, immediately
  before declaring the goal met, and printed `QUICK VALIDATION: ALL PASSED`.
  The full `npm run validate` is release evidence and is not run here.
- If any `SPEC<n>` citation is added or removed, `npm run map` has been run and
  the regenerated `docs/MAP.md` is committed (the gate diffs it). `PRD 011 Req
  <n>` comments do not affect the map.
- A summary comment from the implementer exists on issue #118, naming the
  modules added, the pending/cancellation rule taken, how failures and retry
  render, the `U<n>` / `E<n>` ids covering on-demand generation, cancellation,
  failure+retry and the cache hit, and the gate result.

## Context

The contract is `prd/011-semantic-zoom-and-llm-providers.md` Reqs 25–27 (with
22, 28 and 16 as the constraints around them); the parent is #108. Everything
this issue needs already exists — it is wiring, not new machinery:

- **The view** (#117): `src/lib/semanticZoom.ts` builds `ZoomDocument` /
  `ZoomBlock` from `zoomView()`, and `src/components/SemanticZoomView.tsx`
  renders it holding no rules. `src/App.tsx` mounts it at `:5389`, computes
  `zoomActive` / `zoomSections` / `zoomDoc` at `:3859–3866`, and resets the
  level on document change at `:3870`. `ZoomBlock.body` is today an `Excerpt`;
  it becomes the four-state union.
- **The seam** (#111–#113): `runLlmRequest(transport, config, request)` in
  `src/lib/llmSeam.ts` is the one entry point, `LlmResponse` is
  success-or-typed-failure and never throws, and `src/lib/llmFake.ts`
  (`createFakeLlm`) scripts outcomes with `queue()` / `respondWith()` and logs
  `calls`. `src/App.tsx:4108` (`runLlmTest`) is the existing capability-based
  runner selection to factor out.
- **Availability** (#116): `llmAreaState(capabilities, settings)` in
  `src/lib/llmSettings.ts` answers `no-path` / `operator-unconfigured` /
  `hosted` / `unconfigured` / `ready`; only `ready` and `hosted` can send.
  `testFailureMessage()` is the existing failure wording.
- **The cache** (#115): `platform.summaryCache` (`src/platform/types.ts:294`)
  presents `get` / `put` / `size` / `clear` on both flavors —
  `src/platform/summaryCacheFiles.ts` on desktop and the shim,
  `src/platform/hostedSummaryCache.ts` on hosted. Keys come from
  `summaryKeyForEntry()` / `summaryKeyForSection()` in
  `src/lib/summaryCache.ts`; `reconcileSummaryKeys()` is there for the
  edited-document case.
- **Cost math** (#110): `src/lib/llmCost.ts` already holds
  `SUMMARY_OUTPUT_TOKENS` and the estimate arithmetic — read it for the output
  allowance, but its *display* is #119's.

Read `.sandcastle/CODING_STANDARDS.md` before writing code, and grep
`PRD 011 Req` across `src/` rather than reading `src/App.tsx` whole. Costs, per
CLAUDE.md: `npm run typecheck` + `npm run test:unit` are the seconds-long inner
loop; `npm run validate:quick` adds the minutes-long, machine-serialized
Playwright suite — run it once, at the end.
