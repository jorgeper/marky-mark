# Spec: In-app menu: left anchor, grouped item set, mode/capability gating, switcher chip removal (#93)

## Goal

All acceptance criteria in issue-specs/issue-93.md are satisfied for issue #93,
with evidence visible in the session: the in-app hamburger sits at the **left**
end of the toolbar with a left-anchored popover; its rows come from one pure
`src/lib/` module as separator-divided groups — file (New File, Open File…,
Close File), workspace (New Workspace, Open Workspace…, Close Workspace), save
(Save, Save As…), a **View ▸** submenu slot, app (Settings…, Help, About Marky
Mark) — mode- and capability-gated (New File and Close Workspace in workspace
mode only, Close File only with a file open, workspace rows only where a
workspace capability exists, Save/Save As… hidden for a non-editable file and
merely *disabled* when there is no document); the bottom-right
workspace-switcher chip and its popover are gone with the workspace name still
visible in the toolbar's document affordance and the New/Open Workspace dialogs
still reachable; the frozen item-set tests (E13, E201, W13) and every test that
drove the chip are updated in this change rather than left failing;
`npm run validate:quick` has been run in the implementer's session and passes;
and a summary comment from the implementer exists on issue #93.

## Acceptance criteria

### The item set, as data (Req 8)

- One pure module under `src/lib/` (e.g. `src/lib/appMenu.ts` — no React, no
  platform import) derives the in-app menu from state: it returns ordered
  **groups**, each group an ordered list of rows carrying a `CommandId`
  (`src/lib/commands.ts`), a label, a stable test id, and an optional
  `disabled` flag. `src/components/Toolbar.tsx` renders exactly that data and
  dispatches the row's `CommandId` — it does not decide item order, membership
  or gating inline, and it no longer takes one `onX` callback per row.
- The group order is: **file** (New File, Open File…, Close File) → **workspace**
  (New Workspace, Open Workspace…, Close Workspace) → **save** (Save, Save As…)
  → **View ▸** → **app** (Settings…, Help, About Marky Mark). Groups are
  divided by separators; a group that gates to zero rows contributes no
  separator, and the rendered menu never starts or ends with one.
- Labels are the PRD's: `New File`, `Open File…`, `Close File`,
  `New Workspace`, `Open Workspace…`, `Close Workspace`, `Save`, `Save As…`,
  `View`, `Settings…`, `Help`, `About Marky Mark`. The existing rows keep their
  existing test ids (`menu-new`, `menu-open`, `menu-save`, `menu-save-as`,
  `menu-help`, `menu-about`, `menu-settings`) so `tests/e2e/helpers.ts` and the
  suites that drive them keep working; new rows get new ids in the same family
  (e.g. `menu-close-file`, `menu-new-workspace`, `menu-open-workspace`,
  `menu-close-workspace`, `menu-view`). No existing id is renamed.
- The hotkey hints the rows already show (`displayCombo(...)`) still come from
  the live `HotkeyMap`, and **no new hotkey is introduced** (PRD Non-goals).
  Rows without a binding show no hint.
- The **View ▸** row is a submenu parent, not a command row: activating it
  dispatches nothing. Its contents are #94's work — an empty or not-yet-opening
  submenu panel is acceptable here; a row that looks like an action and does
  nothing is not.
- No **Sign out** row is added here (that is #95); the app group's ordering
  leaves it the first slot when it lands.

### Left anchor (Req 7)

- The hamburger button (`menu-btn`) is the **first** element of `.toolbar`,
  before `docname` — assertable by bounding box: its right edge is left of
  `docname`'s left edge.
- The popover opens left-anchored: its left edge aligns with the button, not
  the toolbar's right edge. Do this with a modifier on the popover
  (e.g. `.theme-menu.anchor-left { left: 0; right: auto; }`) rather than
  flipping `.theme-menu` globally — that class is shared with the folder,
  smart-edit and theme popovers, which stay right-anchored.
- Every flavor that renders the in-app menu (the non-`nativeMenu` branch in
  `src/App.tsx`) gets the new position; desktop's native menu bar is untouched.

### Mode and capability gating (Req 9)

- **New File** appears only in workspace mode. Reuse #91's existing derivation
  (`canOfferNewFile` in `src/lib/savePicker.ts`, already passed to `Toolbar` as
  `canNewFile`) — do not add a second rule.
- **Close File** appears only when at least one file is open (the same
  `docOpen` state `deriveAppMode` reads); **Close Workspace** appears only in
  workspace mode.
- The three workspace rows appear only on flavors with a workspace capability.
  That is a **capability** test, derived the way `src/lib/startActions.ts`
  already derives `newWorkspace` / `openWorkspace` for the start page and the
  native File menu — never a check of `platform.kind`. The static single-file
  web build therefore shows no workspace group at all.
- **Save** / **Save As…** stay hidden when the current file is not editable
  (the existing `canEdit === false` rule, PRD 007 Req 17).
- Items that are merely momentarily inapplicable are **disabled (greyed), not
  hidden** — concretely Save and Save As… with no document open (initial page,
  or workspace mode with no file). A disabled row renders as a real
  `disabled` button (so `toBeDisabled()` sees it), is visibly greyed, and
  dispatches nothing when clicked.
- The initial page (`splash`) shows the menu with the surviving rows only:
  no New File, no Close File, no Close Workspace.

### Start-page shortcuts (Req 10)

- The initial-page buttons (Open File…, New Workspace…, Open Workspace…, plus
  Open Folder… where the capability exists) are unchanged in derivation and
  still dispatch the same `CommandId`s the menu rows dispatch — the two
  surfaces read the same capability list, so they cannot drift.

### Switcher chip removal (Req 11)

- `WorkspaceSwitcher` (the chip and its popover in
  `src/components/WorkspaceSwitcher.tsx`) is gone: the component is removed,
  its mount in `src/App.tsx` (~line 5309) is removed, and its CSS
  (`.workspace-switcher*` in `src/styles.css`) is removed. `NewWorkspaceDialog`
  and `OpenWorkspaceDialog` stay — they are already driven by the
  `newWorkspace` / `openWorkspace` commands through `managedWsDialog`, which is
  now the only route in.
- No replacement chip is introduced. With a workspace open, its **name is
  visible in the toolbar's existing document affordance** (`docname`) on the
  flavors that render the toolbar; outside workspace mode `docname` is exactly
  what it is today (so E14 and the filename/tooltip tests keep passing).
- The hosted e2e that used the chip is rewired, not deleted: the `openSwitcher`
  helper and its callers (`tests/e2e/hosted.spec.ts` ~lines 607–810) drive the
  menu rows instead, and the assertions that read the chip's label
  (E201, E202, E203, …) assert the workspace name — or its absence — on the
  affordance that now carries it. No test is weakened, skipped or deleted to
  get the gate green.

### Scope

- Desktop (Tauri) behaviour is unchanged: native menus, `buildMenuSpec` output
  and the desktop mode model stay as they are (PRD Non-goals). If the new
  module shares helpers with `menuSpec.ts`, the native spec's items must not
  change — U317–U319, U324, U325 and the frozen menu fixtures stay green
  untouched.
- Out of scope: the View submenu's contents (#94), Sign out (#95), the Req 18
  e2e sweep (#96), and any change to the mode model (#90) or the workspace
  New File / Save As… picker (#91).

### Code, tests, and gate

- New and changed behaviour carries `// PRD 009 Req 7:` / `Req 8:` / `Req 9:` /
  `Req 10:` / `Req 11:` citation comments per `.sandcastle/CODING_STANDARDS.md`;
  `docs/MAP.md` is regenerated with `npm run map` and committed if any citation
  moved.
- Unit coverage in `tests/unit/<kebab-case-module>.test.ts` for the new pure
  module: group order and separator placement, the empty-group case, New File /
  Close File / Close Workspace visibility per `AppMode` and `docOpen`, the
  workspace group's capability gating (present hosted/shim/desktop-capable,
  absent for the static web capability set), Save/Save As… hidden when not
  editable and disabled with no document, and that no row carries a command id
  outside `CommandId`. Test titles start at the next free `U` number — the
  suite tops out at **U335**, so start at **U336**.
- The frozen item-set tests **E13** (`tests/e2e/shell-and-menus.spec.ts`),
  **E201** (`tests/e2e/hosted.spec.ts`) and **W13** (`tests/e2e/web.spec.ts`)
  are updated in this change to the new structure — the left-anchored button,
  the grouped rows, the exact per-flavor item set — rather than left failing.
  Any other suite this breaks (`documents.spec.ts`,
  `settings-and-themes.spec.ts`, `web.spec.ts`, `helpers.ts`) is updated too.
  New e2e beyond these updates is #96's; add only what this change needs.
- Iterate with `npm run typecheck` and `npm run test:unit` (or
  `npx playwright test -g '<title>'` for a single e2e), not the full suite. Run
  `npm run validate:quick` **once**, right before declaring the goal met; it
  prints `QUICK VALIDATION: ALL PASSED`. Do not use it as a start-of-attempt
  baseline beyond a single optional quick-tier check.
- A summary comment from the implementer exists on issue #93 (what changed, the
  capability chosen for the workspace-group gating, files touched, gate
  evidence).

## Context

PRD: `prd/009-server-mode-menu.md` (Req 7–11 and the Non-goals); parent #88.
Siblings: #90 (mode model) and #91 (workspace New File / Save As…) have landed;
#94 fills the View slot, #95 adds Sign out, #96 owns the Req 18 e2e sweep —
all three are blocked on this one, so leave them clean seams.

The in-app menu is `src/components/Toolbar.tsx` (198 lines — the popover is the
`.theme-picker` div at the end, rows built by the local `item()` helper). It
renders only on the non-`nativeMenu` branch of `src/App.tsx` (~line 4776) and
is already fed `canEdit` (PRD 007 Req 17) and `canNewFile`
(`canOfferNewFile`, `src/lib/savePicker.ts`). Toolbar CSS: `.toolbar` /
`.toolbar .docname` at `src/styles.css:95`, the popover at `.theme-menu`
(`:159`, `right: 0`), the chip at `.workspace-switcher*` (`:2624`).

Every command the rows need already exists in `src/lib/commands.ts` and is
wired in `App.tsx`'s `dispatchCommand` (~line 3400+): `newFile`, `open`,
`closeFile`, `newWorkspace`, `openWorkspace`, `closeWorkspace`, `save`,
`saveAs`, `settings`, `help`, `about`. `newWorkspace` / `openWorkspace` already
run through `crossModes` and set `managedWsDialog`, so the dialogs open without
the chip. Mode comes from `deriveAppMode` (`src/lib/appMode.ts`), computed as
`appMode` in `App.tsx` (~line 3398). Capability derivation to mirror:
`startCapabilities` / `startActions` in `src/lib/startActions.ts`; the native
menu's own gating in `buildMenuSpec` (`src/lib/menuSpec.ts:175+`) is the shape
to follow for the new module.
