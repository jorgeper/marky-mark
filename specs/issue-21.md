# Spec: some settings adjustments (#21)

## Goal

All acceptance criteria in specs/issue-21.md are satisfied for issue #21, with evidence visible in the session: the Workspace scope of the settings panel shows the same left tab rail as User scope (with Hotkeys remaining a User-only tab), the General tab is first and is the default selected tab in both scopes, both scopes expose the same set of settings rows, and `npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- The Workspace scope of the settings panel renders the same left tab rail (`data-testid="settings-tabs"`) as User scope, replacing the current flat "Workspace settings / Pinned appearance defaults" view. Workspace scope shows the tabs General, Appearance, Editor; User scope shows General, Appearance, Editor, Hotkeys. The Hotkeys tab exists only in User scope.
- The General tab is listed first (before Appearance) in both scopes, and General is the default selected tab when the settings panel opens.
- Within each shared tab, Workspace scope shows the same settings rows as User scope — the full set of settings is editable from both scopes, not just today's curated pinnable subset. Hotkeys rows remain User-only. Purely machine-local actions (the theme-folder reload/open/import buttons on Appearance) may remain User-scope-only, since they are actions on the local machine rather than settings.
- Layering semantics are preserved: a value set in Workspace scope persists to the workspace settings layer and acts as a workspace default, and a personal User-layer value still wins where one is set (existing resolver behavior in `src/lib/settings.ts`). The per-row lock/override status notes still render correctly in both scopes.
- The scope eligibility data in `src/lib/settings.ts` (`SETTINGS_SCOPES`, `WORKSPACE_ELIGIBLE_KEYS`, `WORKSPACE_PINNABLE_KEYS`) reflects the expanded workspace set, and the unit tests in `tests/unit/settings-scope.test.ts` (and any other affected unit tests) pass against the new eligibility.
- Existing e2e assertions that encode the old order/shape have been updated and pass: E26 in `tests/e2e/app.spec.ts` (asserts 4 tabs with Appearance active by default), E35 (iterates tabs), the aux-settings-window tab assertions (~`app.spec.ts:1397`), the workspace-scope tests (`app.spec.ts:341`, `:378`, `:2155`), and the web assertions in `tests/e2e/web.spec.ts`.
- Iterate during development with `npm run typecheck` and `npm run test:unit` (or Playwright tests targeted at the changed specs, e.g. `npx playwright test -g "E26"`). Run the full quick gate `npm run validate:quick` ONCE, right before declaring the goal met — not after every small change and not as a baseline at the start of the attempt.
- `npm run validate:quick` passes, run in the implementer's session.
- A summary comment from the implementer exists on issue #21.

## Context

Both scopes are rendered by one component, `src/components/SettingsPanel.tsx`: the tab rail is currently gated on `scope === 'user'` (~line 814), tab order is the `TABS` array (~line 119, Appearance first today), the default tab is hard-coded `useState('appearance')` (~line 143), and the flat workspace view is `workspaceScopeView` (~lines 758–775). The tab bodies are built from shared row constants (`fontSizeRow` … `imagePatternRow`, ~lines 235–433), so extending Workspace scope is largely reuse. Scope/eligibility data lives in `src/lib/settings.ts` (`SETTINGS_SCOPES` ~124, `WORKSPACE_PINNABLE_KEYS` ~340, `WORKSPACE_ELIGIBLE_KEYS` ~350; per-row status via `settingsRowStatus` ~365). Mount sites: `src/App.tsx` (~4090, in-window fallback) and `src/AuxWindow.tsx` (~103, native settings window; edits travel over the bus as `SettingsEdit {scope, patch}` and are applied in `applySettingsEdit`, `App.tsx` ~1997). Many e2e tests select tabs by `settings-tab-<id>` test ids — keep the ids stable and change only order/availability.
