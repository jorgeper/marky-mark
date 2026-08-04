# Spec: dont open the last file by default (#53)

## Goal

All acceptance criteria in issue-specs/issue-53.md are satisfied for issue #53, with evidence visible in the session: with default settings a launch lands on the initial splash window (logo, no auto-opened document) because `reopenLastDoc` defaults to `false`, the Settings checkbox still enables reopen-on-launch when checked, and `npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- `DEFAULT_SETTINGS.reopenLastDoc` in `src/lib/settings.ts` is `false`, so a launch with default settings (fresh profile, no `#open=` hash, no CLI/association open) shows the initial splash window — the logo screen, with no document auto-opened and no open-set restored (the SPEC36 §8.3 restore is gated on `reopenLastDoc` and is therefore also off by default).
- The behavior remains opt-in, not removed: `parseSettings('{"reopenLastDoc":true}').reopenLastDoc` is `true`, the Settings → General checkbox (`data-testid="settings-reopen"`) still exists and, when checked, a relaunch reopens the last document exactly as before. Explicit opens (`#open=` hash, file association, CLI) still work regardless of the setting.
- Unit tests asserting the old default (e.g. U59 in `tests/unit/menu-spec.test.ts:338`, which expects `parseSettings('{}').reopenLastDoc` to be `true`) are updated to assert the new default `false`; a malformed value (e.g. `"nah"`) still falls back to the default.
- E2E tests that relied on reopen-by-default are updated to match the new default: E91 in `tests/e2e/documents.spec.ts` asserts the default launch lands on the splash and that checking the setting restores reopen behavior; other suites that leaned on implicit reopen (e.g. E60 in `tests/e2e/reading-and-export.spec.ts`, the SPEC30 §4.1 relaunch assertion in `tests/e2e/shell-and-menus.spec.ts`, restore-set coverage in `tests/e2e/tabs-and-workspace.spec.ts`) either enable the setting explicitly or reopen the document another way, and still pass.
- `docs/specs/SPEC30.md` carries an amendment noting the default flipped to `false` per issue #53, and citation comments touched by the change stay accurate (`docs/COMMENT-FORMAT.md` rules); `docs/MAP.md` is regenerated via `npm run map` if the citation set changed.
- Iteration was done with `npm run typecheck` and `npm run test:unit` (or tests targeted at the changed code, e.g. `npx playwright test -g 'E91'`), with the full gate run ONCE at the end — not after every small change and not as a starting baseline.
- `npm run validate:quick` passes in the implementer's session, printing `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #53.

## Context

The launch reopen logic lives in `src/App.tsx` (~line 2092, cited `SPEC30 §2 + §3`): a 250ms-deferred boot pass that, when `reopenLastDoc` is on, restores the dormant open set (`restoreOpenFiles`, SPEC36 §8.3) or opens the top entry of the recent store. The setting is declared in `src/lib/settings.ts` (interface line ~67, default line ~106) and surfaced in `src/components/SettingsPanel.tsx` (~line 624). The minimal correct change is flipping the one default — do not delete the reopen code path or the setting; the issue says "by default", and the checkbox remains the opt-in. Note the restore-open-files branch is already gated on `reopenLastDoc && restoreOpenFiles`, so no second default needs flipping. Grep `SPEC30` for the full citation map; `docs/specs/SPEC30.md` §2 documents the current default-on contract and needs the amendment note.
