# Spec: open files (#83)

## Goal

All acceptance criteria in issue-specs/issue-83.md are satisfied for issue #83, with evidence visible in the session: an open file is visibly marked open in the folder navigation pane whether its tab is foreground or background; reopening a file (from a background tab, after closing it, or after a workspace close/reopen or app restart) returns to its remembered scroll position; the open-file set and active file come back when a workspace is reopened; `npm run validate:quick` has been run in the implementer's session and passes; and a summary comment from the implementer exists on issue #83.

## Acceptance criteria

- **Open files are visible in the folder pane.** Every file in the open
  set shows as "open" in the folder navigation pane — the active
  (foreground) file visually distinguished from open-but-background files —
  and closing a file's tab removes its open marking. This is SPEC36
  behavior that already exists; it must still hold in the integrated flow
  below, not be re-implemented.
- **Scroll position is remembered per file.** After scrolling within a
  document, each of these reopen routes returns the document to (within a
  line or two of) that scroll position: (a) switching to another open file
  and clicking back; (b) closing the file's tab and reopening it from the
  folder pane; (c) closing the workspace, reopening it, and activating the
  file; (d) quitting/relaunching the app and explicitly reopening the
  workspace or file. SPEC16 §3 (positions.json) and the SPEC36 §2 park map
  provide most of this — the deliverable is that all four routes
  observably work, with any gap (e.g. a position not recorded at workspace
  close or app quit, or not restored on session-driven reopen) fixed.
- **Open files persist with the workspace.** With a workspace current,
  the open set and active file are saved to the workspace's machine-local
  session automatically; explicitly reopening that workspace (within a
  run or after a restart) shows the same files open with the active file
  restored. This is issue #81 behavior already on main — it must remain
  intact, and launch must still never auto-open any workspace or file.
- **E2e evidence for the integrated flow.** `tests/e2e/tabs-and-workspace.spec.ts`
  (or `reading-and-export.spec.ts` where it fits better) contains e2e
  coverage, using the next free E-numbers (E175+), proving at minimum:
  scroll position survives a background-tab switch and return, and scroll
  position survives Close Workspace → reopen (and a relaunch + explicit
  reopen) for a file restored from the workspace session. Existing tests
  (E60, E169, E170, SPEC36 suites) are not duplicated or weakened.
- Any new/changed pure logic in `src/lib` has unit tests; changed behavior
  carries citation comments per `docs/COMMENT-FORMAT.md` (cite issue #83
  alongside the SPEC16/SPEC36 sections it amends), and `docs/MAP.md` is
  regenerated with `npm run map` if spec↔code mappings changed.
- Iterate with `npm run typecheck` and `npm run test:unit` (plus targeted
  `npx playwright test -g '<title>'` for the e2e behavior under work); do
  NOT run the full suite after every change or as a starting baseline.
- `npm run validate:quick` has been run ONCE, right before declaring the
  goal met, in the implementer's session, and prints
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #83.

## Context

Issue #83 restates the "open file" contract and is mostly an integration
check over work already on main: SPEC36 (open-file set + folder-pane tabs;
`src/lib/openFiles.ts`, grep `SPEC36`), SPEC16 §3 (reading positions;
`src/lib/readingPositions.ts`, wired via `recordPosition`/`positionFor` in
`src/App.tsx`), and issue #81 (workspace session persists
openFiles/activeFile; `restoreSessionOpenFiles` at src/App.tsx:2220, which
routes the restored active file through `openDoc` — so its scroll restore
should already engage). Likely gap area: whether the active document's
position is recorded at Close Workspace / app quit so route (c)/(d) above
actually land on the remembered line. Start by writing the E175+ tests;
if they pass unchanged, the implementation work is only the tests and
citations. Sessions live under the config dir's session store (see
`sessionKeyForWorkspaceFile` / `parseWorkspaceSession` in
`src/lib/workspace.ts`). Never read `App.tsx` whole — citation-grep.
