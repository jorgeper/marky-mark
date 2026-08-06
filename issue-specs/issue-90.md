# Spec: Server mode: exclusive workspace/single-file mode model and mode exits (#90)

## Goal

All acceptance criteria in issue-specs/issue-90.md are satisfied for issue #90,
with evidence visible in the session: on non-desktop flavors the two modes are
exclusive (a crossing action closes the current mode through its dirty prompts —
cancel aborts — then enters the target mode directly), closing the last file or
the workspace lands back on the initial page (hosted also clearing the
`?workspace=<id>` binding), the in-workspace local-file behavior and its E209
test are retired with desktop behavior unchanged, `npm run validate:quick`
passes in the implementer's session, and a summary comment from the implementer
exists on issue #90.

## Acceptance criteria

Scope: this issue is the command/state layer of PRD 009 Reqs 1–6 only. No menu
restructuring, no new menu items — the behavior is reached through the entry
points that exist today (native/shim menu, `window.__mmDispatch`, the
initial-page buttons, the in-app `menu-open` item, window drag-and-drop).

**Mode model (Req 1–2)**

- `deriveAppMode` (`src/lib/appMode.ts`) remains the single source of truth for
  mode gating on non-desktop flavors: the three UI states (initial page /
  single-file / workspace) are derived from it, and no new gate keys off a
  flavor check (`kind === 'hosted'`, etc.) where the mode already answers.
- With no workspace open, opening a second local file keeps the first in the
  open set (`src/lib/openFiles.ts`) rather than evicting it, and both remain
  reachable through the existing open-file cycling (`cycleFile` /
  `Ctrl+Tab`) — "single file" means "no workspace", not "one document".
- The folder sidebar and its collapsed reveal affordance never render in
  single-file mode (the `folderSeam` condition in `src/App.tsx` already carries
  `appMode === 'workspace'`); this is asserted by a test rather than assumed.

**Mode exits (Req 3)**

- Closing the last open file in single-file mode returns to the initial page,
  and closing the workspace in workspace mode returns to the initial page —
  both on non-desktop flavors, not only on desktop.
- Both exits run the existing dirty-file handling unchanged: the three-way
  Save / Don't Save / Cancel prompt for a dirty document, and the multi-file
  dirty walk (plus the changed-untitled-workspace guard) for a workspace close.
  Cancel anywhere aborts the exit and leaves the mode, the open set and the
  active document exactly as they were.

**Exclusive modes (Req 4–5)**

- Invoking Open File… or dropping a local file on the window while a workspace
  is open closes the workspace first (running the workspace's dirty prompts),
  then opens the file in single-file mode. The initial page is never left as
  the resting state of a completed switch.
- Invoking Open Workspace… or New Workspace while in single-file mode closes
  the open file(s) first (running their dirty prompts), then enters workspace
  mode.
- Cancelling any prompt during a crossing action aborts the whole switch: the
  original mode is still open, nothing new was opened, and no state was
  discarded.
- A local file opened or dropped while a workspace is open no longer opens
  *inside* the workspace. `E209` is deleted from `tests/e2e/hosted.spec.ts`
  (not skipped, not left failing), and the code comments that documented the
  in-workspace local-file variant (PRD 007 Req 21 sites in `src/App.tsx` /
  `src/platform/hosted.ts`) no longer describe behavior the app has stopped
  having.

**Hosted URL binding (Req 6)**

- In hosted mode, closing the workspace clears the `?workspace=<id>` binding
  (the `workspaces.navigateTo(null)` equivalent), so a reload after closing
  lands on the initial page rather than back in the workspace.
- The clearing does not destroy an in-flight mode switch: after Open File… /
  a drop from workspace mode, the app is in single-file mode with that file
  open and the URL no longer bound to a workspace. (`navigateTo` today is a
  `window.location.assign` — a full navigation would discard the file being
  opened, so the switch path needs a non-navigating way to clear the binding,
  e.g. `history.replaceState`.)

**Desktop unchanged**

- Tauri behavior is untouched (PRD 009 Non-goals): the native menu, the
  desktop splash/file/workspace flow, and the existing desktop-shim e2e
  coverage in `tests/e2e/tabs-and-workspace.spec.ts` and
  `tests/e2e/shell-and-menus.spec.ts` still pass unmodified, except where a
  test asserted the retired in-workspace local-file behavior.

**Verification and repo conventions**

- New or changed behavior carries a citation comment naming the contract
  (`PRD 009 Req <n>: <what and why>`) per `.sandcastle/CODING_STANDARDS.md`,
  and new unit-test `describe` blocks name it the same way.
- New pure logic added for the mode-switch decision lives in `src/lib/` with
  unit tests (`npm run test:unit`); e2e coverage for the exclusive-mode
  behavior uses the seams that exist today (the shim's `__mmDispatch` /
  `?nativeMenu=1` menu, the hosted `menu-btn` → `menu-open` item, window
  drop). The broader Req 18 e2e sweep belongs to #96 — this issue only needs
  the coverage that proves Reqs 3–6.
- `docs/MAP.md` is regenerated with `npm run map` and committed if the
  committed file differs from what the generator derives (the gate diffs it).
- Removing E209 does not drop Playwright's collected desktop-shim count below
  `E2E_TEST_FLOOR` in `scripts/validate.mjs`; if that constant has to move, its
  comment block carries the justification the file requires.
- Iterate with `npm run typecheck` and `npm run test:unit` (or tests targeted
  at the changed code) after each change. Run the full gate
  `npm run validate:quick` **once**, right before declaring the goal met — not
  after every change and not as a starting baseline — and it prints
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #90 describing what
  changed and the gate evidence.

**Out of scope** (sibling issues): the left-anchored menu, its grouped item set
and the switcher-chip removal (#93), the View submenu (#94), workspace New File
/ Save As… (#91), single-file File System Access saving (#92), Sign out (#95),
and the Req 18 e2e sweep (#96).

## Context

- `src/lib/appMode.ts` — `deriveAppMode(docOpen, workspaceKind)`; consumed by
  `src/lib/menuSpec.ts` gating and by `folderSeam` in `src/App.tsx:4479`.
- `src/App.tsx` — the command registry (~line 3160+) wires `closeFile`,
  `closeWorkspace`, `open`, `newWorkspace`, `openWorkspace`;
  `closeWorkspaceCmd` (~2646) runs `guardWorkspaceDiscard` → dirty walk →
  `finishCloseWorkspace` (~2624) → `closeToSplash` (~1845). `openViaDialog`
  (~2832) and the `onFileDrop` registration (~2200) are the two local-file
  entry points that must become crossing actions. Note `closeWorkspaceCmd`
  gates on `platform.readDirEntries` — hosted defines it, the single-file web
  build does not.
- `src/platform/hosted.ts` — local-file mode (`createLocalDocs('local')`,
  `openFileDialog`, `onFileDrop`, `fileGrants` exempting local docs).
  `src/platform/hostedWorkspaces.ts:197` — `navigateTo(id | null)`.
- Grep the citations rather than reading `App.tsx` whole:
  `rg 'PRD 007 Req 21' src tests`, `rg 'SPEC36' src` (open-set/tabs),
  `rg 'Issue #22' src` (the three-mode model and its dirty guards).
- Verification commands and their costs are in `CLAUDE.md`; `E209` lives at
  `tests/e2e/hosted.spec.ts:1748`.
