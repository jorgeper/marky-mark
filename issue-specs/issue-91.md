# Spec: Workspace mode: New File and Save As… through the workspace file API (#91)

## Goal

All acceptance criteria in issue-specs/issue-91.md are satisfied for issue
#91, with evidence visible in the session: in workspace mode on a flavor with
no local save dialog, **New File** opens a shared in-workspace name/folder
picker and creates a real file through the workspace file API (`writeTextFile`)
that becomes the current document — no unsaveable untitled buffer; **Save As…**
opens that same picker and writes a copy inside the workspace, switching the
current document to it; New File is unavailable outside workspace mode on those
flavors while desktop keeps its untitled-buffer flow and native save dialog
unchanged; no new server endpoint is added; `npm run validate:quick` has been
run in the implementer's session and passes; and a summary comment from the
implementer exists on issue #91.

## Acceptance criteria

### The shared in-workspace picker (Req 13 + 14)

- One shared picker — a single component plus a pure `src/lib/` module for its
  logic — is the naming surface for **both** New File and Save As… in
  workspace mode. Neither action has its own private naming UI.
- The picker asks for a **file name** and a **target folder within the
  workspace**. The folder choice is drawn from the workspace's own folder tree
  (the roots the sidebar already lists, via `readDirEntries`); it offers no way
  to name a path outside the workspace.
- It opens pre-filled: the folder defaults to the current document's directory
  when there is one, otherwise the workspace's first root; the name defaults to
  a free `Untitled.md` for New File and to the current document's basename for
  Save As….
- A name that `validateEntryName` (`src/lib/folderOps.ts`) rejects cannot be
  committed — the picker shows the reason and keeps the input open, exactly as
  the sidebar's rename row already does. A name with no extension gets `.md`.
- Committing a name that already exists in the target folder never silently
  destroys the existing file: either the picker blocks it with a visible
  message or the user is asked to confirm the overwrite explicitly.
- Cancelling (Escape or the cancel control) writes nothing, creates nothing,
  and leaves the current document untouched.
- The picker ships stable `data-testid`s on its container, name input, folder
  control, and confirm/cancel buttons, so the Req 18 e2e sweep (#96) can drive
  it. Existing test ids are not renamed.

### New File in workspace mode (Req 13)

- In workspace mode on a flavor without a local save dialog, invoking
  `newFile` (menu item or hotkey) opens the picker. On commit the file is
  created through the workspace file API — `platform.writeTextFile(path, '')`,
  the same seam the sidebar's New File already uses — and is then opened as
  the current document (title, open-files list, sidebar row revealed). No
  floating untitled buffer is created on that path.
- The existing unsaved-changes guard is preserved: with a dirty document,
  invoking New File still runs the current save/discard/cancel prompt before
  anything is created, and cancelling aborts the creation.
- Without the `file.create` grant (PRD 007 Req 17, `docGrants`/`folderGrants`
  from `src/lib/fileGrants.ts`), New File is not offered in workspace mode —
  matching E207's rule that a role with `doc.edit` but not `file.create` may
  overwrite an existing path and not invent a new one.

### Save As… in workspace mode (Req 14)

- In workspace mode on the same flavors, `saveAs` no longer dead-ends when the
  platform has no `saveFileDialog`: it opens the shared picker, writes the
  current buffer to the chosen in-workspace path, and switches the current
  document to that new file (title, watcher/sidecar rebind, dirty state
  cleared) — the same end state `saveDocAs` reaches today on desktop.
- The comment-store rules of the existing `saveDocAs` (`src/App.tsx` ~line
  2665) travel with the copy rather than being reimplemented: embedded-trailer
  documents keep their trailer verbatim, an unreadable store still blocks
  migration, and a sidecar is written alongside the new path where the current
  settings call for one.
- Cancelling the picker leaves `saveAs` returning false, so a caller with a
  pending action (open / new / close) still aborts, as today.

### Mode and flavor gating (Req 16 + PRD Non-goals)

- On flavors without a local save dialog, the New File action is unavailable
  outside workspace mode: in single-file mode and on the initial page the
  in-app menu row is absent and the `newFile` command/hotkey does not create a
  buffer. Creating files is a workspace-mode capability there.
- Desktop (Tauri) is unchanged: New File still opens the untitled buffer
  (SPEC22) and Save As… still uses the native `saveFileDialog`. Whichever
  derivation selects the new behaviour is a **capability** test on the
  platform (e.g. `localFolders` / a real `saveFileDialog`), not a check of
  which flavor is running — the rule `src/lib/startActions.ts` already follows
  for PRD 007 Req 2/21. State the chosen capability in a citation comment.
- No new server route or endpoint is added: `server/`'s existing workspace
  file API (PRD 007) already accepts the writes these two actions make.
- The bottom-right switcher chip, the menu's left move, its grouping, and the
  View submenu are **out of scope** — they belong to #93/#94. This issue
  changes only what New File and Save As… do (and where New File is offered).

### Code, tests, and gate

- New or changed behaviour carries `// PRD 009 Req 13:` / `Req 14:` / `Req 16:`
  citation comments per `.sandcastle/CODING_STANDARDS.md`; `docs/MAP.md` is
  regenerated with `npm run map` and committed if any citation moved.
- Unit coverage in `tests/unit/<kebab-case-module>.test.ts` for the new pure
  module: default name and folder derivation, extension defaulting, validation
  rejects, collision detection, and the folder list staying inside the
  workspace. Test titles start at the next free `U` number — the suite tops
  out at **U329**, so start at **U330**.
- E2e for Req 13/14 is owned by #96, so this issue adds none beyond what it
  needs; but the gate must be green here. Any existing test this change breaks
  — the frozen item-set tests E13/E201/W13, or the untitled-buffer New tests
  (E72) if the chosen gating reaches the shim — is updated in this change
  rather than left failing, and no existing test is weakened, skipped or
  deleted to get there.
- Iterate with `npm run typecheck` and `npm run test:unit` (or
  `npx playwright test -g '<title>'` for a single e2e), not the full suite. Run
  `npm run validate:quick` **once**, right before declaring the goal met; it
  prints `QUICK VALIDATION: ALL PASSED`. Do not use it as a start-of-attempt
  baseline beyond a single optional quick-tier check.
- A summary comment from the implementer exists on issue #91 (what changed,
  the capability chosen for the gating, files touched, gate evidence).

## Context

PRD: `prd/009-server-mode-menu.md` (Req 13, 14, 16 and the Non-goals);
parent #88. Siblings: #90 owns the mode model, #93 the menu restructure, #96
the e2e sweep — this issue lands before #93, which is blocked on it.

The two dead ends live in `src/App.tsx`: `newFile` (~line 3003) always calls
`startUntitled()`, and `saveDocAs` (~line 2665) returns `false` immediately
when `p.saveFileDialog` is absent — which is exactly the hosted flavor
(`src/platform/hosted.ts` defines no `saveFileDialog`; `tauri.ts` and
`browser.ts` do, alongside `localFolders: true`). Both are wired into
`dispatchCommand` (~line 3166/3188), the hotkey handler (~line 3583) and the
`Toolbar` props (~line 4525).

The creation machinery already exists in-workspace: `folderCreate` in
`src/App.tsx` (~line 1511) does `readDirEntries` → `uniqueChildName` →
`writeTextFile(path, '')` → `revealNewEntry` → `startFolderRename({ openOnDone
})`, and `src/lib/folderOps.ts` holds the pure pieces (`validateEntryName`,
`uniqueChildName`, `relativePath`). The sidebar's own New File row is already
`file.create`-gated through `folderContextMenu`'s `canCreate`. Reuse these
rather than writing a second creation path; the picker's new module belongs in
`src/lib/` (pure — no React, no platform imports; take the `Platform` or plain
data as arguments).

Mode comes from `deriveAppMode` (`src/lib/appMode.ts`), already computed as
`appMode` in `App.tsx` (~line 3398) and passed into the menu spec. Existing
dialog components to model the picker on: `src/components/HeadingPalette.tsx`
and `src/components/ExportDialog.tsx`. Grants: `src/lib/fileGrants.ts` +
`docGrants` / `folderGrants` state in `App.tsx`. Hosted e2e helpers for
workspaces live in `tests/e2e/hosted.spec.ts` and `tests/e2e/helpers.ts`.
