# Spec: Settings UI: User | Workspace tabs with override indicators (#17)

## Goal

All acceptance criteria in specs/issue-17.md are satisfied for issue #17, with
evidence visible in the session: the Settings window has a User | Workspace
scope selector where the User tab shows all settings and writes only the User
layer (`settings.json`) and the Workspace tab — enabled only while a workspace
is open, desktop-only — shows only workspace-eligible settings (W keys plus a
curated pinnable cosmetic subset) and writes only the workspace layer (the
`.marky-workspace` file or the untitled session store); every row reflects the
effective resolved value with an indicator naming the winning layer whenever a
higher-precedence layer overrides the tab's own layer, W settings on the User
tab are marked workspace-controlled and not user-editable, and Global/Team
layers have no editing controls anywhere while still contributing to effective
values; `npm run validate:quick` passes in the implementer's session; and a
summary comment from the implementer exists on issue #17.

## Acceptance criteria

- The Settings UI (`src/components/SettingsPanel.tsx`) has a **User |
  Workspace** scope selector (§E18). The **User** tab shows all settings the
  panel shows today. The **Workspace** tab is enabled only when a workspace is
  current (`Workspace.kind !== 'none'`); with no workspace it is visibly
  disabled (or annotated) rather than hidden. Per §H25 the Workspace tab is
  desktop-only: the web build shows no Workspace tab or selector affordance
  for it.
- The Workspace tab shows only **workspace-eligible** settings: the W-scoped
  keys (`commentStorage`, `imageFolder`, `imageNamePattern` per
  `SETTINGS_SCOPES` in `src/lib/settings.ts`) plus a curated subset of
  cosmetic U-scoped settings that a workspace author may pin as defaults
  (e.g. themes/fontSize/margins — the exact curation is the implementer's
  call). The curated list exists as an exported constant so tests and future
  issues can reference it, and it contains no M- or U!-scoped keys.
- **Layer-targeted writes:** an edit made on the User tab is persisted to the
  User layer (`<configDir>/settings.json`) and is never written into the
  `.marky-workspace` file or untitled session store; an edit made on the
  Workspace tab is persisted to the current workspace's settings (named
  workspace → autosaved to its `.marky-workspace` file, untitled → the
  session store slot, reusing the existing `updateWorkspace` autosave seam in
  `src/App.tsx`) and is never written into `settings.json`. After either
  edit, the app's effective settings are recomputed through
  `resolveSettings` so the UI and running app reflect the new resolution.
- **Override indicators (§E19):** each settings row shows the effective
  (resolved) value; when a higher-precedence layer overrides the value of the
  tab's own layer, the row carries an indicator naming the winning layer
  (e.g. a workspace-pinned theme viewed on the User tab reads "overridden by
  Workspace" — wording may vary but must name the layer). W-scoped settings
  shown on the User tab are indicated as workspace-controlled and their
  controls are not user-editable.
- **Global/Team read-only (§E20):** no editing controls exist anywhere in the
  UI for the Global or Team layers, but their resolved contributions are
  reflected in effective values and indicators (e.g. a value supplied only by
  `global-settings.json` shows as the effective value).
- The desktop settings window still works: on desktop, settings render in the
  aux window (`src/AuxWindow.tsx` hosts `SettingsPanel`), so whatever
  per-layer data the panel needs (user-layer values, workspace settings,
  workspace-open state) travels through the aux init/broadcast protocol
  (`src/lib/auxProtocol.ts`), and both tabs and indicators function there.
- The pure logic added for this issue — at minimum the
  which-layer-wins/override-indicator computation and the
  workspace-eligible key list — lives in `src/lib/` and is covered by unit
  tests under `tests/unit/`.
- Existing behavior is preserved where the PRD doesn't change it: the web
  build's settings panel keeps working (User scope over Global < Team <
  User, `storageLocked` still locks comment storage), and no M-scoped or
  session state is written into any shareable layer file.
- Iteration during implementation uses `npm run typecheck` and `npm run
  test:unit` (or tests targeted at the changed code); the full gate `npm run
  validate:quick` is run ONCE, right before declaring the goal met — not
  after every small change and not as a baseline at the start of an attempt
  (baseline with the quick tier only) — and passes in the implementer's
  session.
- A summary comment from the implementer exists on issue #17.

## Context

PRD: `prd/002-workspaces-and-layered-configuration.md` §E18–E20; parent #13.
Blocked-by #14 and #15 are merged on this branch: `src/lib/settings.ts` has
`resolveSettings`, `SETTINGS_SCOPES` (`Record<keyof Settings, Scope>`), and
per-key `VALIDATORS`; `src/lib/workspace.ts` has the workspace model,
`sanitizeWorkspaceSettings`, and file/session serialization; `src/App.tsx`
boots by resolving Global/Workspace/User layers (~line 1654) and autosaves
named-workspace changes (~line 1013). Beware the current write path:
`updateSettings` (App.tsx ~1912) persists the **entire effective** `Settings`
to `settings.json` — this issue must split that so each tab writes only its
own layer, which likely means App keeps the raw per-layer objects (not just
the resolved result) in state. `SettingsPanel` today receives a single
`settings: Settings` + `onChange(next)`; extending its props for layers/tab
state ripples into both hosts (`App.tsx` ~3932 web/no-aux path, and
`AuxWindow.tsx` on desktop via the aux protocol). Note the resolver already
ignores User-layer values for W keys, so until the Workspace tab exists,
`commentStorage` edits don't survive restart without a workspace — this issue
makes that coherent by locking W rows on the User tab and editing them on the
Workspace tab. Verify with `npm run validate:quick` (typecheck + unit +
desktop e2e).
