# Spec: Workspace bugs (#81)

## Goal

All acceptance criteria in issue-specs/issue-81.md are satisfied for issue #81, with evidence visible in the session: a workspace's open-file set persists to its machine-local session store automatically (not gated on the reopen settings) and reopening that workspace shows those files as open in the folder pane again; a fresh app launch never auto-opens any workspace or file — it lands on the splash regardless of what was open at last quit; `npm run validate:quick` has been run in the implementer's session and passes; and a summary comment from the implementer exists on issue #81.

## Acceptance criteria

- **Bug 1 — open state sticks to the workspace.** While a workspace (named
  or untitled) is current, the live open-file set and active file are
  written to that workspace's machine-local session store whenever they
  change, unconditionally. Today `persistFolderState` (src/App.tsx:1208)
  substitutes the dormant boot-loaded set when the SPEC36 §8 gate
  (`restoreOpenFiles && reopenLastDoc`) is off — and `reopenLastDoc`
  defaults to false — so open files never reach the session store. Session
  state stays machine-local (PRD 002 §B6): the shareable `.marky-workspace`
  file still never carries open files.
- Reopening that workspace explicitly (Open Workspace…, recent-workspaces
  menu, or reopening the folder that revives the untitled slot) restores
  the saved open set: the files show as "open" in the folder navigation
  pane and the saved active file is restored — both when the workspace was
  closed and reopened within one run, and across an app restart. The
  existing existing-files-only pruning in `openWorkspaceFromPath` stays.
- Close Workspace continues to NOT wipe the closed workspace's saved
  session (the flip-to-'none'-first ordering in `finishCloseWorkspace`
  already protects this — it must survive the change).
- **Bug 2 — nothing auto-opens at launch.** A fresh app start never
  automatically opens any workspace or any file, regardless of settings
  and regardless of what was open at last quit: launch lands on the splash
  with no workspace current. The §C13 pointer-driven workspace boot
  restore (src/App.tsx ~1947–1984) and the reopen-on-launch document
  restore (SPEC30 §2 / SPEC36 §8.3 block, src/App.tsx ~2117–2146) no
  longer open anything at start. Explicit opens (file association, CLI,
  drag-drop, `#open`) still work.
- Settings, UI, and citations are reconciled with the new contract: the
  `reopenLastDoc` / `restoreOpenFiles` settings and their Settings-panel
  rows are removed (or demonstrably repurposed with no dead toggle
  claiming launch-restore behavior that no longer exists), affected
  citation comments are updated (cite issue #81 the way existing code
  cites "Issue #22"), and `docs/MAP.md` is regenerated with `npm run map`
  if spec↔code mappings changed.
- Unit tests in `src/lib` cover any new/changed pure logic, and e2e
  coverage exists for both bugs in `tests/e2e/tabs-and-workspace.spec.ts`
  (new tests take the next free E-numbers, E169+): (a) open files in a
  workspace → Close Workspace → reopen it → the files appear open again
  with the active file restored; (b) relaunch with a workspace and files
  open at quit → splash, no workspace, no open files. Existing tests that
  asserted launch auto-restore (e.g. E104's relaunch-restore half, E91's
  gating) are updated to the new contract, not deleted wholesale.
- Iterate with `npm run typecheck` and `npm run test:unit` (plus targeted
  `npx playwright test -g '<title>'` for the e2e behavior under work) after
  each change; do NOT run the full suite per change or as a starting
  baseline.
- `npm run validate:quick` has been run ONCE, right before declaring the
  goal met, in the implementer's session, and prints
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #81.

## Context

The workspace model is PRD 002 (`prd/`): pure logic in
`src/lib/workspace.ts` (session parse/serialize, `CURRENT_POINTER_FILE`
§C13 launch pointer), wiring in `src/App.tsx` (`persistFolderState`
~1201, boot restore ~1947, launch reopen `setTimeout` ~2115,
`openWorkspaceFromPath` ~2366, `finishCloseWorkspace` ~2472). Bug 2
deliberately reverses PRD 002 §C13 ("which workspace to reopen at
launch") and SPEC30 §2 reopen-on-launch — issue #81 is the owner's
amendment and wins; update the citations rather than preserving the old
behavior. The pointer file can keep being written or be retired —
implementer's choice — as long as launch opens nothing. Grep `SPEC36`,
`SPEC30`, `restoreOpenFiles`, and `reopenLastDoc` before editing;
`src/lib/settings.ts:66-107` holds the setting declarations and defaults.
