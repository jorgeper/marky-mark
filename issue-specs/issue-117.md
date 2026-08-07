# Spec: Experimental settings section and the semantic zoom view: five levels on excerpts, no LLM required (#117)

## Goal

All acceptance criteria in issue-specs/issue-117.md are satisfied for issue
#117, with evidence visible in the session: Settings carries an **Experimental**
section whose features are off by default, each with a one-line description and
a plain statement that they may change or be removed; with **Semantic zoom** off
the feature is absent (no control in the DOM, no View row, no command, no
accelerator) and with it on the rendered document view zooms through all five
levels of `zoomView()` — L5 the untouched document, L1–L4 read-only views built
from `src/lib/zoomLevels.ts` + `src/lib/sectionModel.ts` with
`excerptFromBody()` text that the view labels plainly as excerpts — driven by a
docked level indicator with `+` / `−` and a draggable handle, click-a-heading to
dive one level in, a "back to full document" action at every level, and its own
`Mod+Shift+=` / `Mod+Shift+-` / `Mod+Shift+0` accelerators that leave SPEC4 §4
text zoom untouched; every document opens at L5 and the level is persisted
nowhere; no code path added here contacts an LLM; `npm run validate:quick` was
run once at the end and printed `QUICK VALIDATION: ALL PASSED`; and a summary
comment from the implementer exists on issue #117.

## Acceptance criteria

### Req 1 — an Experimental section in Settings

- Settings gains an **Experimental** section, reachable from **both** mount
  points unchanged in structure: the inline panel in `src/App.tsx` and the
  desktop aux settings window (`src/AuxWindow.tsx`). Whether it is a new
  `SettingsTab` in the `TABS` rail of `src/components/SettingsPanel.tsx` or a
  clearly-headed section inside an existing tab is the implementer's call, as
  long as it reads as *the* Experimental area and is not a lone unlabelled row.
- It is **User-scope**: it is not offered on the Workspace scope tab (the
  `USER_ONLY_TABS` / Hotkeys / LLM-providers precedent if it is a tab), and no
  key it writes is workspace-editable — the new keys appear in neither
  `WORKSPACE_ELIGIBLE_KEYS` nor `WORKSPACE_PINNABLE_KEYS`.
- Every feature listed in the section is **off by default** (its
  `DEFAULT_SETTINGS` value is `false`) and carries a **one-line description of
  what turning it on does** — the effect, not the name restated.
- The section states plainly, in its own copy, that these features may change or
  be removed. One sentence, rendered once, with a `data-testid`.
- The section is structured so a second experimental feature is a data entry,
  not a copy-paste of the row markup.
- Whether the existing `livePreview` toggle (`src/lib/settings.ts:61`, today an
  "experimental, off by default" row in the Editor tab) moves into the section
  is the implementer's call. If it moves, its settings key, scope and default
  are unchanged and no existing `data-testid` is renamed or removed —
  `tests/e2e/live-preview.spec.ts` and the settings unit tests must keep passing
  as written (update the helper's tab union rather than the test ids if the
  toggle changes tabs).
- Every new interactive control ships a `data-testid`, per
  `.sandcastle/CODING_STANDARDS.md`. If `openSettings()` in
  `tests/e2e/helpers.ts` needs a new destination, its tab union is **widened**,
  not replaced or duplicated.

### Req 2 — semantic zoom is off by default, and off means absent

- A new persisted boolean (e.g. `semanticZoom`) is added to `Settings` in
  `src/lib/settings.ts` with entries in `DEFAULT_SETTINGS` (`false`),
  `SETTINGS_SCOPES` (`U`) and `VALIDATORS`, and it is the only switch the
  feature reads.
- With the flag off, in every flavor, **none of these exist**:
  - no level control or zoomed view in the DOM — the new `data-testid`s are
    absent, not present-and-disabled;
  - no View-menu row — `buildViewItems()` (`src/lib/menuSpec.ts`) omits the
    semantic-zoom entries, so both the native menu bar and the in-app
    `buildAppMenu()` flyout omit them;
  - no working command — dispatching the new command ids is a no-op, and no
    handler for them is registered;
  - no accelerator — `Mod+Shift+=` / `Mod+Shift+-` / `Mod+Shift+0` do nothing.
- Turning it on and off again returns the app to that state within the session:
  the view snaps back to the full document and the control disappears.
- A unit test drives `buildViewItems()` with the flag both ways and asserts the
  rows appear/disappear; a desktop-shim e2e asserts the control's absence with
  the flag off and its presence with it on.
- Turning the feature off must not require a restart, and this issue owns only
  the toggle's presence/absence effect — the "stand down: remove key, delete
  cached summaries" half of Req 3 is issue #120's work.

### Req 17 — five levels, rendered from the existing model

- The zoomed view is built from the modules issue #110 already landed and
  **re-implements none of them**: `parseSections()` /`findSection()`
  (`src/lib/sectionModel.ts`), `zoomView()` / `clampZoomLevel()` /
  `ZOOM_LEVEL_FULL` (`src/lib/zoomLevels.ts`), `excerptFromBody()`
  (`src/lib/sectionExcerpt.ts`). No second parser, no second level→content
  mapping, and no deriving structure by scraping the rendered HTML (Req 24).
- **L5 is today's document, unchanged.** The existing
  `renderMarkdown(canonicalOf(buffer))` → `docRef.current.innerHTML = html`
  injection path in `src/App.tsx` and its `data-mm-line` anchors are untouched
  at L5, so scroll sync, the heading palette, comment anchoring and the split
  live-preview pane behave exactly as before. The zoomed view is an *additional*
  render path taken only at levels 1–4.
- **L4** renders every heading at its own depth with the section's body replaced
  by one short text block. **L3** renders headings to depth 2, with deeper
  sections' text folded into the nearest kept ancestor. **L2** renders top-level
  headings only, one block each. **L1** renders the document title plus a single
  block for the whole document. All four read their entries, depths, titles and
  summary slots from `ZoomView.entries` rather than recomputing them.
- Nothing is silently dropped: an entry's `folded` descendants are accounted for
  in what the level shows (their text feeds the entry's block; whether their
  titles are also listed is the implementer's call).
- A document with no headings, an empty document, and a document whose first
  heading is `###` all render something usable at every level (`zoomView()`
  already guarantees an entry; the view must not assume a depth-1 title exists —
  pass a `fallbackTitle` such as the file name).
- All rendered text is escaped or goes through the sanitizing `renderMarkdown()`
  pipeline (`src/lib/markdown.ts`) — document text is never concatenated into an
  `innerHTML` string by hand.

### Req 18 — levels 1–4 are read-only

- A pure predicate in `src/lib/` answers "is this level read-only?" (true for
  1–4, false for 5) and every gate reads it — no scattered `level < 5` literals.
- Entering a zoomed level **from edit mode is allowed** and leaves the buffer
  byte-identical: the document does not become dirty, no draft is written, and
  returning to L5 restores the same editable buffer and mode. Use the editor's
  existing `readOnly` prop (`src/components/Editor.tsx:271`, `readOnlyExt`) or
  keep the editor unmounted at levels 1–4 — but the buffer must survive
  untouched either way.
- While at levels 1–4 the document cannot be edited: typing, paste, and the
  formatting commands (Smart Edit, SPEC43) change nothing. A desktop-shim e2e
  types at a zoomed level and asserts the buffer is unchanged after returning to
  L5.

### Req 19 — click to dive in, and a way straight back

- Clicking a heading or a summary block at levels 1–4 moves **one** level toward
  L5, focused on that section; the decision (current level + clicked section id
  → next level + focus target) is a pure, unit-tested function, not inline
  component logic.
- Arriving at L5 by a dive scrolls to that section in the full document, reusing
  the existing heading/line scroll path (the `data-mm-line` anchors the heading
  palette already scrolls by) rather than a second scroll implementation.
- A direct **back to full document** action is present and works at every level
  1–4 (its own control with a `data-testid`, plus the reset command/accelerator
  of Req 23), landing at L5.
- An e2e dives from a zoomed level down to L5 and asserts the full document is
  shown, scrolled to the clicked section.

### Req 20 — the level is view state, and starts at L5

- Every document opens at `ZOOM_LEVEL_FULL`: opening a file, switching tabs back
  to a file, reopening a closed file, and app restart all land at L5.
- The level is stored **nowhere persistent**: no new key in `src/lib/settings.ts`
  for it, nothing in `src/lib/workspace.ts`, `src/lib/readingPositions.ts`,
  `src/lib/drafts.ts`, a sidecar, or any file the app writes; it is not roamed
  or synced, and it never appears in a `.marky-workspace` file or an exported
  document.
- A desktop-shim e2e zooms out, switches away and back (or reopens the file),
  and asserts the view is at L5.

### Req 21 — the level indicator control

- A control docked in the document view shows the **current level and what it
  means** (a short label per level, e.g. "Full document" … "Whole document in a
  paragraph"), and offers `+` and `−` plus a **draggable handle** across the
  five levels (a range input is acceptable as the handle). Clamping goes through
  `clampZoomLevel()`; at L5 `+` and at L1 `−` are inert or disabled rather than
  wrapping.
- The control is visible whenever the Experimental feature is on — **including
  where no LLM is available at all**, since the levels work on excerpts there
  (Req 22). It never gates on LLM availability, and it never branches on
  `platform.kind` (branch on capabilities per `.sandcastle/CODING_STANDARDS.md`
  § Architecture).
- It lives in the document view, does not overlap or replace the SPEC16
  word-count chip or the toolbar, and does not appear at the splash (no document
  open).
- The control and the keyboard/menu commands drive the **same** single level
  state — pressing `+`, dragging the handle, and invoking the command are
  interchangeable.

### Req 22 — excerpts, labelled as excerpts

- With no provider configured, all five levels still work: each entry's block is
  `excerptFromBody()` text derived from that entry's `sources` (its opening
  sentences/first lines, truncated), and `EXCERPT_PLACEHOLDER` covers a section
  with nothing quotable.
- The view **states plainly that these are excerpts, not summaries** — one piece
  of copy in the zoomed view, with a `data-testid`, not a per-block repetition —
  and offers a way to reach the LLM providers settings area (issue #116's tab)
  where configuring one is possible. Where no LLM path exists at all (the static
  web build, `llmAreaState()` → the no-platform state in
  `src/lib/llmSettings.ts`), the copy says so instead of offering a control that
  cannot work (Req 9).
- **This issue makes no LLM request of any kind.** Nothing it adds calls
  `runLlmRequest()`, `platform.llm`, `platform.llmTransport`, or the summary
  cache stores; every level renders excerpts even when a provider is configured.
  Swapping excerpts for real summaries is issue #118's work, and the view is
  shaped so that swap is a change of what fills the block, not a rewrite of the
  level rendering.
- `src/` gains no `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` or
  `EventSource` call site, and `FETCH_ALLOWLIST` in `scripts/validate.mjs` stays
  at **6**.

### Req 23 — a distinct feature from text zoom

- New command ids in `src/lib/commands.ts` (e.g. `semanticZoomIn`,
  `semanticZoomOut`, `semanticZoomReset`) — the existing `zoomIn` / `zoomOut` /
  `zoomReset` ids, their handlers in `src/App.tsx`, the `settings.zoom`
  multiplier and the `Mod+=` / `Mod+-` / `Mod+0` accelerators are **untouched**,
  and a unit test proves text zoom's rows and combos are unchanged.
- Its own View-menu entries, added to `buildViewItems()` and gated on a new
  `ViewMenuState` field, labelled so the two zooms are not confusable (e.g.
  "Zoom Out Semantically" / "Full Document"), carrying the accelerators
  `Mod+Shift+=`, `Mod+Shift+-`, `Mod+Shift+0` exactly.
- Those three combos actually fire the commands where the app matches keys
  (`eventMatches()` from `src/lib/hotkeys.ts`, as the existing in-app key
  handling does), and do nothing when the feature is off. A unit test asserts
  none of the three collides with any `DEFAULT_HOTKEYS` binding via
  `combosConflict()`.
- Whether the three become user-rebindable `HotkeyMap` entries is the
  implementer's call; if they do, the Hotkeys settings tab and its conflict
  check must keep working and the defaults are the combos above.

### Tests

- New pure modules under `src/lib/` are unit-tested one file per module with the
  matching kebab-case name; existing suites (`settings.test.ts`,
  `settings-scope.test.ts`, `menu-spec` / hotkeys tests) take the criteria that
  belong to them.
- Every new test title starts with the next unused stable id — unit ids continue
  from **U580**, desktop e2e from **E229** — and no existing test is renumbered,
  weakened, deleted or skipped. `describe` blocks name the contract (e.g.
  `describe('PRD 011 Req 21 semantic zoom control')`).
- Desktop-shim e2e coverage lands, at minimum: the Experimental toggle's
  presence/absence effect (Req 2), zooming through all five levels on excerpts
  with no provider configured (Reqs 17/21/22), the read-only guarantee at a
  zoomed level (Req 18), click-to-dive back to the full document (Req 19), and
  the reset to L5 on reopen (Req 20). The full availability-per-flavor matrix
  stays issue #121's work.
- No test contacts a real provider (PRD 011 Req 35); this issue's tests need no
  provider at all.
- The gate's `E2E_TEST_FLOOR` (226) is not lowered or edited — added tests keep
  the collected count at or above it.
- Every new module, exported type, settings key and command id carries a
  `PRD 011 Req <n>` citation comment naming the requirement it implements, per
  `docs/COMMENT-FORMAT.md`.

### Scope fence

- This issue ships the Experimental section and the excerpt-backed zoom view,
  and nothing downstream: no summarization or pending/failure/retry states
  (#118), no pricing or measured-usage display (#119), no cache
  inspection/clearing or key-removal stand-down (#120), no enumerated
  availability e2e matrix (#121). It changes nothing in the LLM providers tab
  (#116), `src/lib/llmSeam.ts`, `src/lib/llmProviders.ts`, or the SPEC11
  amendment and gate counters (#114) beyond reading `llmAreaState()` for the
  Req 22 copy.
- The feature is complete on its own: with the Experimental toggle on, a reader
  can zoom a document through five levels and back, offline, with no provider.

### Verification

- The inner loop is `npm run typecheck` plus `npm run test:unit` (or tests
  targeted at the changed code — `npx vitest run tests/unit/<file>`,
  `npx playwright test -g '<title>'`). The e2e suite is not run after every small
  change, and the gate is **not** run as a baseline at the start.
- `npm run validate:quick` has been run **once**, at the end, right before
  declaring the goal met, and printed `QUICK VALIDATION: ALL PASSED`. The full
  `npm run validate` is release evidence and is not run here.
- If any `SPEC<n>` citation is added or removed, `npm run map` has been run and
  the regenerated `docs/MAP.md` is committed (the gate diffs it). `PRD 011 Req
  <n>` comments do not affect the map.
- A summary comment from the implementer exists on issue #117, naming the
  decisions taken and the files touched.

## Context

Everything the levels need already exists as pure, unit-tested logic from issue
#110 — read `src/lib/zoomLevels.ts` first: `zoomView(doc, level, opts)` returns
`{ level, verbatim, title, entries }` where each `ZoomEntry` carries `id`,
`depth`, `title`, `headingLine`/`startLine`/`endLine`, the `sources`
(`SectionNode[]`) feeding its block, and the `folded` descendants. `verbatim` is
true only at L5, which is the signal to take today's render path instead.
`parseSections(source)` (`src/lib/sectionModel.ts`) builds the tree from the
same mdast the renderer parses; `excerptFromBody(body, maxLength)`
(`src/lib/sectionExcerpt.ts`) returns `{ kind: 'excerpt', text, truncated,
placeholder }`.

The rendered document lives in `src/App.tsx`: `renderMarkdown()` output is held
in the `html` state (`src/App.tsx:308`) and injected imperatively at
`src/App.tsx:4374` (preview pane) and `src/App.tsx:4525` (split live-preview
pane). Citation-grep rather than reading the file whole. `src/lib/commands.ts`
is the command registry (text zoom is `zoomIn`/`zoomOut`/`zoomReset`, handled
at `src/App.tsx:3688`); `src/lib/menuSpec.ts:190` `buildViewItems()` is the one
place View rows are declared for both the native menu and
`src/lib/appMenu.ts`'s in-app flyout; `src/lib/hotkeys.ts` holds `parseCombo`,
`eventMatches`, `combosConflict` and `DEFAULT_HOTKEYS` (no existing binding uses
`Mod+Shift+=`, `Mod+Shift+-` or `Mod+Shift+0`).

Settings: `src/lib/settings.ts` holds `Settings`, `DEFAULT_SETTINGS`,
`SETTINGS_SCOPES`, `VALIDATORS` and `WORKSPACE_ELIGIBLE_KEYS`;
`src/components/SettingsPanel.tsx` holds the tab rail, `USER_ONLY_TABS`, and the
existing experimental `livePreview` row; it is mounted inline from `src/App.tsx`
and in the desktop aux window from `src/AuxWindow.tsx` (a deliberately dumb view
that talks to the main window only through `src/lib/auxProtocol.ts`).
`src/lib/llmSettings.ts` already answers availability — `llmAreaState()`,
`NO_LLM_PLATFORM_MESSAGE` — which is all this issue needs from the LLM side.

Read `prd/011-semantic-zoom-and-llm-providers.md` §§ Reqs 1–2 and 17–24, and
grep `PRD 011 Req` across `src/` before opening anything.
