# Spec: Settings: disable Semantic zoom on web, and move LLM provider settings under the experiment as a nested settings page (#247)

## Goal

All acceptance criteria in issue-specs/issue-247.md are satisfied for issue
#247, with evidence visible in the session: the Semantic zoom checkbox on the
Experimental tab is visible-but-disabled with a short "not available in the web
version" note in the browser builds (and unchanged on desktop), `LLM providers`
is gone from the top-level tab rail and is instead a reusable **nested settings
page** reached by a `Settings…` button on the Semantic zoom row — with a
breadcrumb header, a Back affordance, in-progress edits surviving the round trip,
and the existing `initialTab: 'llm'` and stand-down routes landing on it —
`npm run validate:quick` prints `QUICK VALIDATION: ALL PASSED`, and a summary
comment from the implementer exists on issue #247.

## Acceptance criteria

### Change 1 — Semantic zoom is not enableable in the browser builds

- On the Experimental tab, the **Semantic zoom** row still renders (label,
  description, test id `experimental-semantic-zoom`) but its checkbox is
  **disabled and unchecked** in the browser builds — the hosted (cloud) build
  and the static web build. Under it sits a short note, with its own test id,
  saying the feature is not available in the web version.
- The desktop build is unchanged: the checkbox is enabled and toggles the
  experiment exactly as today, and so is the desktop dev/e2e shim
  (`src/platform/browser.ts`) that the `npm run test:e2e` suite runs against —
  the existing E229–E245 semantic-zoom tests keep passing unmodified except
  where a criterion below requires a change.
- Availability is expressed as a **capability**, not a flavor test: no new
  `isTauri()` / hosted-marker branch appears outside `src/platform/`. Follow the
  existing pattern (`summaryCache`, `llm`) — the platform declares it, `App.tsx`
  forwards it to `SettingsPanel` as a prop next to `summaryCacheAvailable` /
  `llmCapabilities`, and the panel branches on the prop.
- Nothing else about semantic zoom changes: with the experiment on (desktop),
  excerpt mode, summarization, caching and cost prompts behave as today.

### Change 2 — LLM provider settings become a nested page under the experiment

- **`LLM providers` no longer appears in the top-level tab rail** in any build or
  scope: `settings-tab-llm` renders nowhere, and the rail's remaining tabs are
  General, Appearance, Editor, (Workspace, when it applies), Hotkeys,
  Experimental.
- Under the Semantic zoom description sits a **`Settings…`** button with a stable
  test id. It is **enabled only while the experiment is checked** — so it is
  disabled when the box is unchecked, and disabled in the browser builds where
  Change 1 grays the box out.
- Clicking it opens a **second-level settings page** whose content is exactly
  what the LLM providers tab shows today (`LlmSettings`: provider, model, base
  URL, API key, remove key, test connection, hosted provider line, summary-cache
  size / clear, cost rows) — same test ids, same behavior, no regression in what
  is drawn per capability.
- The nested page carries a header naming where the reader is (e.g.
  `Experimental › Semantic zoom`) and a **Back** affordance, both with stable
  test ids, that returns to the Experimental tab of the main dialog.
- **The nesting mechanism is general, not a one-off.** It is data-driven the way
  `EXPERIMENTAL_FEATURES` already is (a page descriptor on the feature entry plus
  one piece of panel state), so a second experiment gets a nested page by adding
  data, not by copying markup. A comment states this.
- **Round-tripping loses nothing.** Moving Experimental → nested page → Back →
  nested page again preserves in-progress edits on both levels (a typed API key
  or model, and a toggled checkbox on Experimental) — the issue #246 pending-edit
  model owns them, and nothing on the nested page writes through `onEdit` before
  Save.
- **Save / Cancel still govern both levels.** The pinned footer
  (`settings-actions`) is visible and functional on the nested page; Save commits
  edits made on the nested page along with the rest, and Cancel / Esc / scrim
  raise the same discard prompt when nested edits are pending.

### The routes that must follow the move

- The zoomed view's **"configure a provider"** route (PRD 011 Req 22, today
  `initialTab: 'llm'` from `src/App.tsx`) opens the Settings dialog directly on
  the **nested LLM page**, not on a tab and not on General. E234 covers this
  route and must pass against the new destination.
- The Semantic zoom **stand-down** link (PRD 011 Req 3, today `setTab('llm')`)
  routes to the same nested page, and a reader who has *just* unchecked the
  experiment in the open dialog can still reach **Remove key** and **Clear the
  summary cache** — e.g. the link stays live until the dialog is saved/closed, or
  the two actions are surfaced in the stand-down notice itself. E239 and E240
  exercise this and must pass.

### Specs, tests and hygiene

- **No contradiction is left in the contract.** PRD 011 Req 4's "LLM providers is
  an unconditional top-level tab/page" is explicitly amended (in
  `prd/011-semantic-zoom-and-llm-providers.md`) to record that issue #247
  supersedes it, and the same for Req 22's "this is the only behavior in the
  static web build" if Change 1 makes it untrue. Every `PRD 011 Req 4` citation
  comment in `src/` and `tests/` that asserts the top-level tab is updated to
  match what the code now does (citation format per
  `.sandcastle/CODING_STANDARDS.md`).
- **The affected tests are updated, not deleted wholesale.** At minimum:
  `tests/e2e/settings-and-themes.spec.ts` (the tab-count and
  `settings-tab-llm` assertions around lines 203–208, 470–560, incl. E226/E228),
  `tests/e2e/semantic-zoom.spec.ts` (E234, E239, E240 routes),
  `tests/e2e/web.spec.ts` (W14 and W15, which today open settings on the `llm`
  tab and check the Semantic zoom box on the web build), and the `openSettings`
  helper in `tests/e2e/helpers.ts`. Coverage that is moved rather than dropped:
  what W14 proved about the no-LLM-path sentence keeps a home (nested page or a
  unit test of `llmAreaState`), and the disabled-on-web row plus its note gain an
  assertion.
- **New behavior gains tests.** The nested-page navigation (open, Back, edits
  survive the round trip, Save commits nested edits) is covered by e2e in the
  desktop-shim suite, and the disabled-on-web row + note by the web suite.
- **Styling goes through the primitives.** Any new chrome (the `Settings…`
  button, the nested header, the Back affordance, the web note) uses the PRD 018
  `Button`/dialog primitives and chrome tokens per `docs/STYLE-GUIDE.md` — no
  literal inline chrome styles, so `validate:quick`'s style-lint step passes.
- **`docs/MAP.md` matches the generator.** If the set of cited specs or files
  changed, it has been regenerated with `npm run map` and committed; the file is
  never hand-edited.

### Verification and evidence

- Iterate with `npm run typecheck` and `npm run test:unit` (or a single targeted
  e2e run — `npx playwright test -g '<title>'`) after each change. Do **not**
  run the full e2e suite after every edit, and do not run it as a baseline at the
  start — baseline with the quick tier only.
- `npm run test:e2e:web` (the web-build suite, which `validate:quick` does not
  include) has been run **once** after the web-build behavior settled, and
  passes.
- `npm run validate:quick` has been run **once**, right before declaring the goal
  met, and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #247, naming what
  changed, which PRD text was amended, and the verification output.

## Context

`src/components/SettingsPanel.tsx` holds the tab set (`SettingsTab`, `TABS`,
`USER_ONLY_TABS` around lines 230–291), the data-driven `EXPERIMENTAL_FEATURES`
table with its `standDown` route, the `experimentalTab` fragment (~line 1160),
the issue #246 pending-edit state and the pinned `footer`, and the render switch
(~line 1290) where `tab === 'llm'` mounts `llmTab`. The page content itself is
`src/components/LlmSettings.tsx` — mount it unchanged inside the nested page
rather than rewriting it. `src/App.tsx` owns `settingsInitialTab` (line ~652,
typed `'llm' | undefined`) and passes `initialTab`, `llmCapabilities`,
`summaryCacheAvailable` (~line 8295); the aux/frameless settings window
(`src/AuxWindow.tsx`) renders the same panel, so the nested page must work there
too. Capability plumbing to copy: `Platform.summaryCache` in
`src/platform/types.ts` declared by `tauri.ts`, `browser.ts` (the desktop e2e
shim) and `hosted.ts` — desktop and the shim should keep semantic zoom
enableable; `hosted.ts` and `web.ts` should not. Styles live in
`src/styles.css` (`.experimental-row`, `.settings-modal .tab-rail`,
`.settings-body`, `.tab-content`).

Grep `PRD 011` and `SPEC` citations before opening files; never read `App.tsx`
end-to-end. A reading note on scope: the issue's title and body say "web /
cloud", while its trailing build-applicability line says "hosted (cloud) build
only". This spec takes the body and title at their word — Change 1 disables the
row in **both** browser builds (hosted and static web) and leaves desktop
untouched, which is why W15's on-web excerpt walkthrough has to be reworked
(E230 already covers excerpt mode on the shim). If the owner meant hosted only,
that is a one-line change to which platform declares the capability.
