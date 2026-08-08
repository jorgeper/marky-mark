# Spec: Cost transparency: curated per-provider recommendation and pricing, measured usage, pre-summarization confirmation (#119)

## Goal

All acceptance criteria in issue-specs/issue-119.md are satisfied for issue #119,
with evidence visible in the session: the LLM providers settings area names a
curated recommended model per provider with its per-million input/output price
and an explicit "as of <date>, check the provider for current pricing" caveat;
the app reports measured usage from the token counts providers actually return —
tokens and cost for the most recent summarization plus a running total the user
can reset — and says plainly when a provider returned no usage rather than
showing a zero; entering a zoomed level that would summarize anything first asks
the reader to confirm, naming roughly how many sections and the estimated cost,
with proceed, cancel and a persisted, reversible "don't ask again"; nothing caps,
meters or blocks spend; `npm run validate:quick` has been run once at the end and
passed; and a summary comment from the implementer exists on issue #119.

## Acceptance criteria

### Curated recommendation and pricing (Req 31)

- A new **pure** module in `src/lib/` (suggested `llmPricing.ts`) holds the
  curated table: for each provider kind of the seam's `LlmProviderKind`, the
  recommended model id for summarization and its price as the existing
  `TokenPrice` shape from `src/lib/llmCost.ts` (`inputPerMillion` /
  `outputPerMillion`) — reused, not re-declared as a second price type. The
  record is exhaustive by construction over `LlmProviderKind`, the way
  `LLM_PROVIDERS` in `src/lib/llmSettings.ts` already is, so a sixth provider
  fails the typecheck until it is priced or explicitly declared unpriceable.
- **`custom` has no recommendation and no price**, structurally (an absent /
  null entry, not a fabricated number): the app cannot know what an endpoint the
  reader points at charges. The settings area renders that as its own sentence,
  never as a blank or zero price.
- A **single literal date constant** (e.g. `PRICES_AS_OF = '2026-08-08'`) is the
  one place the caveat's date is written, and the caveat sentence — "as of
  <date>, check the provider for current pricing" or wording that says the same
  two things — is exported from the module so the panel composes none of its
  own. The date is a literal string, never `new Date()`.
- Each of the four hosted kinds' recommended model ids **also appears in that
  provider's `LLM_PROVIDERS[kind].models` list**, pinned by a unit test, so the
  recommendation is selectable from the existing chooser and two catalogues
  cannot drift apart.
- A lookup (e.g. `priceFor(kind, modelId)`) answers a `TokenPrice` for ids the
  curated table prices and **`null` for anything else**. A free-text model id
  (PRD 011 Req 6) is unpriced, never priced by guessing a neighbour's rate.
- Anthropic model ids and prices are taken from the **`claude-api` skill**, not
  from memory — the precedent is the comment already on `LLM_PROVIDERS.anthropic`
  in `src/lib/llmSettings.ts`. Every price carries the currency it is in.
- The **LLM providers settings area** (`src/components/LlmSettings.tsx`) shows,
  for the provider currently selected — or on hosted, for the operator's
  provider from `LlmAreaState`'s `hosted` state — the recommended model, its
  input and output price per million tokens, and the caveat. It renders what the
  module answers and decides nothing itself, matching how that panel already
  treats `lib/llmSettings.ts`.
- Where **no LLM path exists** (`state: 'no-path'` — the static web build), no
  pricing block, usage block or reset control is rendered at all: absent, not
  disabled (PRD 011 Req 9).

### Measured usage (Req 32)

- **The seam's usage reaches the app.** `runSummaries` in
  `src/lib/summaryEngine.ts` currently forwards `response.usage` only to the
  cache store via `summaryUsageForStore`; it now also reports each call's
  `LlmUsage` to its caller (e.g. an `onUsage` option beside `onState`), without
  taking on any new rule of its own.
- A **pure accumulator** module (suggested `src/lib/llmUsage.ts`) folds those
  reports into exactly two answers: the **most recent summarization run**
  (tokens and cost for the run just finished, aggregated over the calls it made)
  and a **running total**. Costs come from `measuredCost()` in
  `src/lib/llmCost.ts` — no second cost formula anywhere.
- **Unknown usage is said, not invented.** A call whose provider returned no
  usage (`LlmUsage.known === false`) is counted as unmeasured; a run with no
  measured call reports "the provider returned no usage data" rather than 0
  tokens or $0, and the running total states how many calls it could not
  measure rather than silently under-reporting them.
- **A model with no curated price** reports its measured tokens with the cost
  stated as unknown — never a fabricated currency amount. (`measuredCost()`
  already answers `null` costs when no price is supplied; the UI must render
  that honestly.)
- **Cache and memo hits contribute nothing.** A level served entirely from the
  summary cache (or the session memo) makes no call, so it neither changes the
  running total nor replaces the "most recent summarization" figure with an
  empty run.
- Both figures are **visible in the LLM providers settings area**, the single
  home for LLM configuration (PRD 011 Req 4), beside the Summary cache section
  #120 added.
- The running total **survives an app restart**: it is persisted through the
  settings layer (`src/lib/settings.ts`) as one or more new keys that are
  scoped so they can never reach a workspace layer — out of
  `WORKSPACE_PINNABLE_KEYS` and `WORKSPACE_ELIGIBLE_KEYS`, with defaults, a
  scope tag and a validator entry added to the exhaustive records there.
- A **reset action** zeroes the running total in one click, and touches nothing
  else: the API key, provider, model and summary cache are all unchanged. After
  a reset the area reports an empty total rather than a stale number.
- **The desktop settings window holds no new capability.** Usage reaches it
  through the existing settings broadcast (`EV_SETTINGS_CHANGED`, handled in
  `src/AuxWindow.tsx`), and reset travels as an ordinary settings edit — the aux
  window still never reads `platform.llmTransport`, never calls
  `runLlmRequest`, and gains no new bus round trip for this.

### Pre-summarization confirmation (Req 33)

- Before the **first summarization of a document at a given level**, the reader
  is shown what it will do: roughly how many sections would be summarized and
  the estimated input/output tokens and cost, taken from `estimateJob()` in
  `src/lib/llmCost.ts` with the price from the curated table — with **Proceed**
  and **Cancel**.
- **Every number in it is labelled an estimate** (the wording says estimate, and
  an unknown price says the cost is not known rather than showing zero); nothing
  in this confirmation is presented as measured usage.
- The confirmation appears **only when the run would actually spend something**:
  with every slot already cached, at L5, or with no runner available, no
  confirmation is shown and no request is made.
- **Proceed** starts exactly the run #118 already starts — the same
  `summaryRunId` identity, the same cancellation rule (`acceptsSummaryResult`),
  the same per-section retry — and does not double-start it.
- **Cancel makes zero LLM requests.** The zoomed level stays usable, showing the
  deterministic excerpts (PRD 011 Req 22), and the reader can still get the
  summaries afterwards without reloading the app — leaving and re-entering the
  level asks again.
- The confirmation is asked **at most once per run identity**: the same
  document, content, level and provider/model does not re-ask on re-entry within
  a session. Editing the document, or changing level, provider or model, is a
  different identity and a different cost, so it asks again.
- **"Don't ask again"** is offered in the confirmation, persists across restarts
  as a settings key, and is **reversible from the LLM providers settings area**
  — a control there turns confirmations back on. No one-way door, and no knob
  that reads as live where confirmations cannot happen at all.
- The confirmation is a real dialog in the main window: it carries
  `data-testid`s, Esc cancels it the way the app's other dialogs behave, and no
  summarization starts behind it while it is open.

### Scope guards

- **Reporting only.** Nothing caps spend, meters a quota, or refuses a request
  because of a budget — no threshold anywhere blocks or degrades a request
  (PRD 011 non-goals; the issue restates this).
- **No new network call site.** The pricing and usage modules contact nothing;
  the static web build's zero-outbound property and the validation gate's
  committed fetch-allowlist counters are unchanged (PRD 011 Reqs 14+16).
- **No key material** appears in any pricing, usage, estimate or confirmation
  string (PRD 011 Req 7).
- The new pure modules are added to the `MODULES` list in
  `tests/unit/zoom-purity.test.ts`, so they are held to no DOM, no network, no
  `Date.now`/`new Date`/`Math.random`, and no React/platform/component imports
  (PRD 011 Req 34).

### Tests

- Unit tests with the next free `U<n>` ids (`U631` is the highest in
  `tests/unit/` today) cover at least: the curated table's exhaustiveness and
  its consistency with `LLM_PROVIDERS`; `custom` having no price; `priceFor`
  answering null for an unknown model id; the accumulator over measured,
  unmeasured and mixed runs, plus reset; and the decision to ask — nothing to
  summarize means no ask, suppression means no ask, and the identity keying
  means one ask per (document, content, level, provider/model).
- **No test contacts a real provider** (PRD 011 Req 35). Usage paths are driven
  through `src/lib/llmFake.ts`, whose `FakeLlmOutcome` already carries an
  optional `usage`, so scripting a reply with usage and one without covers both
  branches.
- Desktop-shim e2e coverage lands in `tests/e2e/semantic-zoom.spec.ts` (or a
  sibling suite) with the next free `E<n>` ids (`E240` is the highest today),
  reusing its existing `configureProvider`, `scriptFake` and `fakeCalls`
  helpers: with a provider configured, entering a zoomed level shows the
  confirmation naming a section count and an estimate; **Cancel** leaves the
  fake's call count unchanged and the view on excerpts; **Proceed** summarizes
  and the LLM settings page then reports that run's tokens and a non-empty
  running total; **"don't ask again"** makes a later level summarize with no
  confirmation; **Reset** empties the total while the key, model and cache
  survive; and a scripted reply with no usage reaches the "no usage data"
  sentence instead of a zero.
- Every new interactive control ships a `data-testid` and is driven by it; new
  e2e setup reuses `tests/e2e/helpers.ts` / `fixtures.ts`.
- Every new module, exported type and rendered state carries a `PRD 011 Req
  <n>: <what and why>` citation comment per `docs/COMMENT-FORMAT.md` and
  `.sandcastle/CODING_STANDARDS.md`.

### Verification

- The inner loop is `npm run typecheck` plus `npm run test:unit` (or tests
  targeted at the changed code — `npx vitest run tests/unit/<file>.test.ts`,
  `npx playwright test -g '<title>'`). The e2e suite is **not** run after every
  small change, and the full gate is **not** run as a baseline at the start of
  an attempt — any baseline uses the quick tier only.
- `npm run validate:quick` has been run **once**, at the end, immediately before
  declaring the goal met, and printed `QUICK VALIDATION: ALL PASSED`. The full
  `npm run validate` is release evidence and is not run here.
- If any `SPEC<n>` citation is added or removed, `npm run map` has been run and
  the regenerated `docs/MAP.md` is committed (the gate diffs it). `PRD 011 Req
  <n>` comments do not affect the map.
- A summary comment from the implementer exists on issue #119, naming where the
  curated table lives and where its prices came from, how usage travels from the
  seam to the settings area and to the persisted total, how the confirmation is
  keyed and suppressed, the `U<n>` / `E<n>` ids covering recommendation, usage,
  reset and confirmation, and the gate result.

## Context

The contract is `prd/011-semantic-zoom-and-llm-providers.md` Reqs 31, 32 and 33
(with 4, 7, 9, 14, 16, 22, 25 and 34 as the constraints around them); the parent
is #108, and #116, #118 and #120 are the predecessors this builds on. The
arithmetic already exists — this is mostly a curated table plus wiring:

- **The cost math** (#110): `src/lib/llmCost.ts` already has `estimateTokens`,
  `estimateJob` (`:88` — sections total / cached / to-summarize, tokens, and
  `null` costs when no price was supplied) and `measuredCost` (`:143` — a
  `known: false, reason: 'usage-missing'` answer that is deliberately not zero).
  Its header states outright that "the curated per-provider table and its
  'as of <date>' caveat belong to #119". `TokenPrice` is the price shape.
- **The usage the seam returns** (#112–#116): `LlmUsage` and `USAGE_UNKNOWN` in
  `src/lib/llmSeam.ts`; each provider maps its own field names onto it in
  `src/lib/llmProviders.ts`. `summaryUsageForStore` in `src/lib/summaryPlan.ts`
  is where usage currently stops — it omits unknown usage rather than zeroing
  it, explicitly "so #119's accounting can tell the difference".
- **The run** (#118): `src/App.tsx` computes `summaryRun` (`summaryRunId`,
  ~`:4191`), starts the only run in `startSummaryRun` (~`:4218`) and the effect
  below it, and holds `summaryMemoRef` (~`:4171`). `selectLlmRunner` /
  `summaryKeyContextFor` (`src/lib/llmRunner.ts`) answer "who sends this and as
  whom" — the same place to read provider id and model id for a price lookup.
  `zoomEntryView` is the `ZoomView` `estimateJob` takes.
- **The settings page** (#116/#120): `src/components/LlmSettings.tsx` holds no
  rules and renders what `src/lib/llmSettings.ts` answers; `SettingsPanel.tsx`
  mounts it as `llmTab` (`:887`). The Summary cache section (#120) is the shape
  to copy for a new section with a read-out plus one action.
- **The desktop settings window**: `src/AuxWindow.tsx` holds no capabilities; it
  receives `EV_AUX_INIT` once and live-updates from `EV_SETTINGS_CHANGED`
  (`src/lib/auxProtocol.ts`), and edits travel back as `EV_SETTINGS_EDIT`. That
  is why persisting usage in settings is the cheap route — no new bus message.
- **Settings plumbing**: `src/lib/settings.ts` — `Settings`, `DEFAULT_SETTINGS`,
  `SETTINGS_SCOPES` (`U` / `U!` / `W` / `M`, exhaustive by construction),
  `EXPERIMENTAL_KEYS` and the validator record. The four `llm*` keys are `U!`
  and the note there explains why.
- **Tests to read first**: `tests/unit/llm-cost.test.ts`,
  `tests/unit/summary-plan.test.ts`, `tests/unit/zoom-purity.test.ts`, and
  `tests/e2e/semantic-zoom.spec.ts` (E229–E240, and its `__mmFakeLlm` shim
  handle).

Read `.sandcastle/CODING_STANDARDS.md` before writing code, and grep
`PRD 011 Req` across `src/` rather than reading `src/App.tsx` whole. Costs, per
CLAUDE.md: `npm run typecheck` + `npm run test:unit` are the seconds-long inner
loop; `npm run validate:quick` adds the minutes-long, machine-serialized
Playwright suite — run it once, at the end.
