# Spec: scroll bar changes (#167)

## Goal

All acceptance criteria in issue-specs/issue-167.md are satisfied for issue
#167, with evidence visible in the session: the app's scrollbars fade out after
a short idle delay and come back on scroll or hover behind a persisted
`autoHideScrollbars` setting (default on) that a Settings checkbox turns off to
restore always-visible bars, a scroll-sync toggle button sits in the top-right
corner cluster beside the edit/preview switch under a persisted
`showSyncScrollButton` setting and flips a persisted `syncScroll` state that
lets the split panes scroll independently when off and realigns them the moment
it goes back on, `npm run validate:quick` passes in the implementer's session,
and a summary comment from the implementer exists on issue #167.

## Acceptance criteria

### Auto-hiding scrollbars

- Three new persisted keys exist in `src/lib/settings.ts` — `autoHideScrollbars:
  boolean` (default `true`, scope `'U'`), `syncScroll: boolean` (default `true`,
  scope `'M'`, beside its layout neighbours `splitEdit`/`splitRatio`) and
  `showSyncScrollButton: boolean` (default `true`, scope `'U'`, the
  `showWordCount` precedent) — each declared in `Settings`, `DEFAULT_SETTINGS`,
  `SETTINGS_SCOPES` and the `VALIDATORS` map, so the scope-coverage assertion in
  `tests/unit/settings-resolver.test.ts` (`SETTINGS_SCOPES` keys must equal
  `DEFAULT_SETTINGS` keys) still passes, and all three survive a save/reload.
- With `autoHideScrollbars` on, a scrollable surface shows its scrollbar while
  it is being scrolled (wheel, drag, keyboard, or programmatic) and while the
  pointer is over it, and the bar fades away again after one named idle delay
  constant (~1.5s) declared in exactly one place — not copied per surface.
- The visible/hidden state is observable from a test: the scroll surface carries
  an attribute (e.g. `data-scrollbars="active" | "idle"`) that a Playwright test
  can assert on, and it flips per surface — scrolling the editor does not
  un-hide an idle preview's bar.
- The bar never disappears out from under an interaction in progress: while the
  thumb is being dragged, or while the pointer rests over the bar, it stays
  visible and the idle timer restarts when the interaction ends.
- Hiding causes no reflow. The scroll container's `clientWidth` and the wrapped
  content's layout are identical in the shown and hidden states (the bar's
  gutter is not removed — the thumb/track go transparent), so text does not jump
  sideways every time a bar fades.
- The mechanism is app-drawn and platform-consistent (styled scrollbars in
  `src/styles.css` driven by existing `--mm-*` tokens with literal fallbacks):
  no theme file under `themes/` needs editing, and the behaviour is the same in
  the desktop shell and the web build rather than deferring to the OS's own
  overlay-scrollbar behaviour.
- Coverage is at least the document scroll surfaces — the full-preview
  `.workspace`, the split `.split-preview`, and the editor's `.cm-scroller` —
  through one shared helper rather than three copies; the sidebar/search scroll
  boxes ride the same helper where they scroll. Surfaces that are deliberately
  barless today (`.file-tab-rail`, SPEC/PRD 013 Req 9) stay barless and keep
  their arrow affordances.
- With `autoHideScrollbars` off, scrollbars are always visible — today's
  behaviour, no fade, no timer running.
- A Settings checkbox flips `autoHideScrollbars` — a row with a `data-testid` in
  the house style (e.g. `settings-autohide-scrollbars`), placed next to the
  existing `settings-autohide` (auto-hide toolbar) row in the Appearance tab of
  `src/components/SettingsPanel.tsx` — and the change takes effect live, without
  a reload.

### The scroll-sync toggle

- A scroll-sync toggle button renders in the workspace's top-right corner
  cluster (`rightCluster` in `src/App.tsx`, ~line 6598), immediately beside the
  `ModeSwitchButton`/`PreviewToggleButton` pair, in the same edge-tab style and
  from the same module as its two neighbours
  (`src/components/FolderPanel.tsx`). It carries a stable `data-testid` (e.g.
  `sync-scroll-toggle`), a `data-state`/`aria-pressed` reflecting on vs off, and
  a title/aria-label naming the move it makes.
- The button exists only where synchronized scrolling can mean anything: edit
  mode with the split preview open (`mode === 'edit' && settings.splitEdit`) and
  `showSyncScrollButton` on. It is absent in full preview, on the splash, with
  the split collapsed, and when the setting hides it.
- Clicking it dispatches one new registered `CommandId` (e.g. `toggleSyncScroll`
  in `src/lib/commands.ts`) through the existing `dispatchCommand` path its two
  neighbours use — the button holds no toggle logic of its own.
- With `syncScroll` off, the panes scroll independently: scrolling the editor
  leaves `.split-preview`'s `scrollTop` unchanged and scrolling the preview
  leaves the editor's unchanged. The SPEC15/SPEC45 sync effect in `src/App.tsx`
  (~line 5766) does not run, and nothing else regresses — the SPEC44 caret cue,
  preview↔editor selection mirroring (SPEC23), comment anchoring, and the
  mode-switch reading-position carry-over (E59) all still behave.
- Turning `syncScroll` back on re-synchronizes immediately, without waiting for
  a new scroll event: the preview realigns to the editor's current top
  line/cue through the existing `editorLeads()` path, so both panes show the
  same content again the instant the toggle flips.
- `syncScroll` defaults on and persists across a reload; the button's visual
  state agrees with the persisted value on load.
- A View ▸ checkbox row (`src/lib/menuSpec.ts` `buildViewItems`, near the
  `Split Edit` row) dispatches the same command and shows the same checked
  state, so the state stays reachable when `showSyncScrollButton` hides the
  button. Both surfaces agree; the unit expectations in
  `tests/unit/menu-spec.test.ts` / `tests/unit/app-menu.test.ts` are updated
  rather than worked around.
- A Settings checkbox flips `showSyncScrollButton` (Appearance tab, house-style
  `data-testid`), and hiding the button changes only the button's presence — the
  `syncScroll` state and the sync behaviour itself are untouched.

### Verification and hygiene

- Unit coverage exists for whatever pure logic this adds (the new settings keys'
  defaults/validation/scopes, the View row's label and gating in
  `tests/unit/menu-spec.test.ts`, and the idle/active state machine if it is
  factored into a `src/lib/` module).
- Two new Playwright tests exist (next free numbers: `E314`, `E315`): one in
  `tests/e2e/settings-and-themes.spec.ts` (or the closest existing home) for the
  auto-hide behaviour — visible while scrolling, idle after the delay, no
  content reflow, always-visible with the setting off, persisted across reload —
  and one in `tests/e2e/split-view.spec.ts` alongside `E247` for the toggle:
  placement beside the mode switch, independent scrolling when off, immediate
  realignment when back on, hidden by `showSyncScrollButton`, persisted.
- New behaviour carries citation comments in the repo's format
  (`docs/COMMENT-FORMAT.md`, `.sandcastle/CODING_STANDARDS.md`) citing issue
  #167 alongside the SPEC15/SPEC45 sites it modifies; if any `SPEC<n>` citations
  are added or moved, `docs/MAP.md` is regenerated with `npm run map` and
  committed (validate:quick diffs it).
- Iteration used `npm run typecheck` and `npm run test:unit` (or a single
  targeted e2e via `npx playwright test -g '<title>'`); the full gate was run
  ONCE, right before declaring the goal met — not after every change and not as
  a start-of-attempt baseline (baseline with the quick tier only).
- `npm run validate:quick` has been run in the implementer's session and printed
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #167.

## Context

The issue has no PRD and no parent; the body is the whole brief. Nothing in the
repo styles scrollbars today — `src/styles.css` sets `overflow` on the scroll
surfaces and lets the platform draw the bar (the only `::-webkit-scrollbar`
rule is `.file-tab-rail`'s deliberate hide at ~line 2391), so the auto-hide
behaviour is new UI, not a tweak of an existing one.

Split scroll sync is SPEC15 plus SPEC45's cue anchoring: one `useEffect` in
`src/App.tsx` (~lines 5766–5860) that subscribes to both panes, with
`editorLeads()`/`previewLeads()` and a `quiet` suppression window; the pure line
↔ offset math lives in `src/lib/scrollSync.ts` (unit-tested in
`tests/unit/scroll-sync.test.ts`). Gating that effect on `syncScroll` is the
"off" half; re-running `editorLeads()` when it flips back on is the
"re-synchronize" half.

The corner cluster the new button joins is built in `src/App.tsx` (~line 6581,
`leftCluster`/`rightCluster`); with the file tab strip up it rides the strip's
trailing slot (`src/components/FileTabStrip.tsx`), otherwise it overlays the
workspace corner (`.edge-cluster` in `src/styles.css`). `ModeSwitchButton` and
`PreviewToggleButton` in `src/components/FolderPanel.tsx` (~lines 268–318) are
the two buttons to copy — style, testid/aria shape, and the
"dispatch the command, own no state" split. `E247` in
`tests/e2e/split-view.spec.ts` is the placement test to model the new one on.

Settings wiring is the well-worn path: `src/lib/settings.ts` (interface,
defaults, `SETTINGS_SCOPES`, `VALIDATORS`) → `src/components/SettingsPanel.tsx`
(the Appearance tab holds `settings-autohide`; the Editor/General tab holds
`set-split-edit`) → `src/lib/menuSpec.ts` for the View row. Follow issue #157's
`codeBlockView` or PRD 013's `fileTabs` end to end for a recent example.

Do not read `src/App.tsx` end-to-end — citation-grep into it (`rg 'SPEC15'
src`). Coding rules are in `.sandcastle/CODING_STANDARDS.md`; the spec→code
table is `docs/MAP.md`.
