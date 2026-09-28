# Spec: make "live preview" the default mode (#342)

## Goal

All acceptance criteria in issue-specs/issue-342.md are satisfied for issue #342, with evidence visible in the session: live preview defaults to enabled while persisted explicit choices remain respected, Settings labels it "Live preview" without "experimental", npm run validate:quick passes in the implementer's session, and an implementer summary comment exists on issue #342.

## Acceptance criteria

- The app's shared `livePreview` default is `true`: fresh profiles, settings without that key, and invalid values falling back through the existing settings parser/resolver all enable live preview. This default applies consistently to the desktop and web app surfaces using the shared settings.
- Explicit saved `livePreview: false` remains off, and explicit `true` remains on, including serialization and reload; the setting remains user-scoped and switchable rather than being forcibly enabled for existing users.
- Settings > Editor displays exactly "Live preview" for the existing `editor-live-preview` checkbox, with no experimental qualifier for this feature. The checkbox reflects the effective setting, and Save/Cancel and persistence retain their existing behavior. Unrelated experiments and the Experimental settings tab are unchanged.
- With no live-preview override, the editor renders existing live-preview formatting in both single-editor and split-edit layouts; disabling it restores the existing non-live-preview editor behavior. Switching the setting remains presentation-only, preserving Markdown source and undo history without remounting the editor. Startup/read/edit mode selection, the split-view default, and the read-only preview pane are not redefined by this change.
- Regression coverage proves default-on behavior without explicitly seeding `livePreview: true`, missing/invalid-value fallback, preservation and round-trip of both boolean choices, the Settings label and checked state, and a persisted opt-out after reload. Existing live-preview toggle/undo and rendering coverage remains meaningful; tests specifically exercising raw-editor behavior may explicitly opt out rather than weakening their assertions or globally hiding the new default behind fixture settings.
- Directly related documentation and comments no longer describe the current feature as experimental or default-off; any amendment to PRD 006 clearly identifies issue #342 as the promotion decision while preserving its other rendering and compatibility requirements.
- Evidence in the implementer's session shows successful iteration checks with `npm run typecheck` and `npm run test:unit` (or tests targeted at changed code), followed by one successful `npm run validate:quick` run immediately before declaring the goal met. That final gate is not used after every small change or as the initial baseline; any baseline is limited to the fast typecheck/unit-test iteration tier.
- A summary comment from the implementer exists on issue #342 describing the delivered behavior, saved-preference compatibility, and verification results.

## Context

Issue #342's body adds "and remove \"experimental\" word in settings"; there are no comments or linked PRD/parent references. The existing contract is `prd/006-live-preview.md`, whose requirement 1 and deferred promotion non-goal are superseded only as described here. `src/lib/settings.ts` owns the default, parser and user scope; `src/components/SettingsPanel.tsx` owns the label, and `src/App.tsx` passes the setting to the editor. Relevant coverage is in `tests/unit/settings.test.ts`, `tests/unit/settings-resolver.test.ts`, and `tests/e2e/live-preview.spec.ts` (especially E142's old default-off assertion); `tests/e2e/helpers.ts` seeds shared profiles without a live-preview override. Rendering lives under `editor/src/components/`; this is a settings promotion, not a renderer rewrite or an editor-package API change.
