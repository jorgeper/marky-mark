# Spec: spacing between settings (#25)

## Goal

All acceptance criteria in specs/issue-25.md are satisfied for issue #25, with evidence visible in the session: the Settings dialog's User and Workspace scope tabs render their shared rows with identical vertical spacing (per-row scope/override notes no longer stretch rows in one scope but not the other), the scope information those notes carried remains discoverable, `npm run validate:quick` passes in the implementer's session, and a summary comment from the implementer exists on issue #25.

## Acceptance criteria

- Rows shared by both scope tabs of the Settings dialog have identical vertical rhythm in both scopes: for any settings row visible in both User and Workspace scope, the gap between it and its neighboring rows is the same in both scopes, in every tab (General, Appearance, Editor). Switching the scope tab no longer visibly spreads out or compresses the list. (Rows that exist in only one scope — e.g. the User-only theme-actions row and the Hotkeys tab — are exempt, but they must not change the spacing of the rows around them relative to the other scope.)
- The cause today is the `scopeNote()` paragraphs in `src/components/SettingsPanel.tsx` (`<p className="hotkey-hint scope-note">`), which render under many Workspace-scope rows ("User setting — edit it in User scope." / "Overridden by …") and under W-scoped rows in User scope, each adding ~18px of height. In the fixed state, whatever conveys this information no longer changes a row's height between scopes — acceptable forms include a zero-layout-impact presentation (tooltip/title, inline icon, absolutely positioned hint) or an element whose space is reserved identically in both scopes; implementer's choice.
- The §E19 scope/override information is still discoverable in the UI (not simply deleted): a user viewing a locked or overridden row can still find out why it is locked and where to edit it.
- The existing e2e assertion at `tests/e2e/app.spec.ts:2149` (`scope-note-imageFolder` contains "Workspace") still passes, or is updated to assert the new presentation of the same information.
- A test targeted at the fix exists (unit or Playwright e2e) that would fail on the old rendering — e.g. asserting that scope notes do not add layout height, or that a shared row's measured spacing is equal across the two scope tabs.
- Iterate with `npm run typecheck` and `npm run test:unit` (plus targeted Playwright runs such as `npx playwright test -g "<relevant test>"` when touching the dialog). Baseline an attempt with the quick tier only.
- `npm run validate:quick` has been run ONCE in the implementer's session, right before declaring the goal met — not after every small change — and passes.
- A summary comment from the implementer exists on issue #25.

## Context

The Settings dialog is `src/components/SettingsPanel.tsx`. Both scopes render the exact same row constants (`fontSizeRow`, `generalTab`, etc.); the only per-scope layout difference is `scopeNote(key)` (~line 180), driven by `settingsRowStatus` in `src/lib/settings.ts:363` — on the Workspace tab, every M/U!-scoped key and every key whose winning layer is `user` grows a note paragraph. CSS: `.modal .hotkey-hint` (`src/styles.css` ~1100, `min-height: 15px`) and `.settings-modal .scope-note` (~945, `margin: 3px 0 0`); row rhythm comes from `.modal .field` and `.modal .checkbox-row` (`margin-bottom: 12px`). Note that in `.checkbox-row` (flex, `align-items: center`) the note currently renders as an inline flex item beside the label, while in `.field` rows it stacks below — a fix should leave both forms scope-invariant. Issue #21 and §E18/§E19 (see `specs/issue-21.md`) define the scope model the notes serve; keep that behavior, just stop it from changing row spacing.
