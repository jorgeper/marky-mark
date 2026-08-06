# Spec: View submenu in the in-app menu, driven by the shared menuSpec View entries (#94)

## Goal

All acceptance criteria in issue-specs/issue-94.md are satisfied for issue #94,
with evidence visible in the session: the in-app menu's **View ▸** row opens a
submenu whose rows come from the *same* `src/lib/menuSpec.ts` View definitions
the desktop native menu is built from — one exported builder, not a second copy
of the list — carrying their labels, hotkey hints, checked state and desktop
gating (Folders, Only Open Files, Next/Previous Open File, Edit Mode, Split
Edit, Comments and comment navigation when comments are enabled, Changes Since
Save in edit mode, Go to Heading…, Word Count, Front Matter, Line Numbers, and
the Zoom In / Zoom Out / Actual Size group), with entries the running flavor
cannot honour omitted and every row dispatching its existing `CommandId`
through the Toolbar's one command seam; `buildMenuSpec`'s native output is
unchanged (PRD 009 Non-goals) and the frozen item-set e2e (E13, E201, W13) stay
green; `npm run validate:quick` has been run in the implementer's session and
passes; and a summary comment from the implementer exists on issue #94.

## Acceptance criteria

### One definition, two surfaces (Req 12)

- The View items exist in exactly **one** place: the item list currently inline
  in `viewMenu` inside `buildMenuSpec` (`src/lib/menuSpec.ts:227+`) is lifted
  into an exported pure builder (e.g. `buildViewItems(s): MenuItemSpec[]`, taking
  `MenuState` or a narrower View-only slice of it), which `buildMenuSpec` then
  uses for its `View` submenu and which the in-app menu also consumes. No second
  literal list of View rows is introduced anywhere — not in `src/lib/appMenu.ts`,
  not in `src/components/Toolbar.tsx`, not in `src/App.tsx`.
- The in-app View rows are derived from that builder's output, not hand-mapped
  item by item: adding an item to the shared builder makes it appear in both
  menus with no further edit. A unit test pins this — for a given state, the
  in-app View rows' commands and labels equal the `type: 'command'` items of
  `buildMenuSpec(...).submenus.find(m => m.title === 'View')`.
- The gating stays in `src/lib/` (pure, unit-testable): `buildAppMenu`
  (`src/lib/appMenu.ts`) returns the View group's children as data —
  `Toolbar.tsx` renders what it is handed and decides nothing about
  membership, order, checked or disabled state, exactly as #93 established.

### What the submenu contains (Req 12)

- For a state where desktop shows them, the submenu carries: **Folders**,
  **Only Open Files**, **Next Open File**, **Previous Open File**, **Edit
  Mode**, **Split Edit**, **Comments** (label including the count, as desktop
  does) with **Next Comment** / **Previous Comment**, **Changes Since Save**,
  **Go to Heading…**, **Word Count**, **Front Matter**, **Line Numbers**, then
  the separator, then **Zoom In**, **Zoom Out**, **Actual Size** — in the
  desktop order, with the desktop labels.
- State-driven omission matches desktop exactly, because it comes from the same
  builder: no comment rows when `commentsEnabled` is false, no Changes Since
  Save outside edit mode.
- Entries with no in-app meaning are dropped: `type: 'predefined'` items (the
  mac-only `Fullscreen` and the separator that precedes it) never render as
  rows. Separators that *do* survive (the one before the zoom group) render as
  dividers, and the submenu never starts or ends with one.
- **Flavor-cannot-honour omission:** on a flavor with no workspace capability
  the sidebar/open-set rows are omitted rather than permanently greyed —
  concretely, when the capability list `buildAppMenu` already reads
  (`entryActions`, `src/lib/startActions.ts`) offers neither `newWorkspace` nor
  `openWorkspace` (the static single-file web build), **Folders**, **Only Open
  Files**, **Next Open File** and **Previous Open File** are absent from the
  submenu. Where the capability exists they are present, following desktop's
  state gating below.
- **Momentarily inapplicable stays disabled, not hidden** (PRD 009 Req 9): the
  `disabled` flag the shared builder already computes is carried through —
  Folders / Only Open Files greyed outside workspace mode, Next/Previous Open
  File greyed with fewer than two open files, Edit Mode greyed with no document
  or when `canEdit` is false. A disabled row renders as a real `disabled`
  button (so `toBeDisabled()` sees it), is visibly greyed, and dispatches
  nothing when clicked.
- **Checked state is visible**: rows whose spec item carries `checked` render a
  check affordance that reflects it live (e.g. `role="menuitemcheckbox"` +
  `aria-checked`, or a ✓ glyph with a stable hook) — Folders, Only Open Files,
  Edit Mode, Split Edit, Comments, Changes Since Save, Word Count, Front
  Matter and Line Numbers all show whether they are currently on.
- Hotkey hints come from the item's accelerator as the top-level rows' hints do
  (`displayCombo`, live `HotkeyMap`); rows without one show no hint. **No new
  hotkey and no new `CommandId` is introduced** (PRD Non-goals) — every row
  dispatches an id that already exists in `src/lib/commands.ts` and is already
  handled in `App.tsx`'s `dispatchCommand`.
- Test ids: the parent row keeps `menu-view`; each child gets a new stable id in
  the same family (e.g. `menu-view-toggleFolders`, `menu-view-zoomIn`), derived
  once rather than spelled out per row. No existing test id is renamed.

### Opening and dismissing

- Activating the **View ▸** row opens the submenu panel (a `data-testid`ed
  container, e.g. `app-menu-view`); the parent menu stays open behind it. The
  row is still not an action — it dispatches no command.
- Choosing a child row dispatches its command and closes the whole menu (parent
  included), matching what a top-level row does today.
- A click outside closes both panels — the panel lives inside the Toolbar's
  existing `menuRef` subtree so the current `mousedown` handler covers it.
- Opening the submenu must not break the **frozen top-level item-set
  assertions**: E13 (`tests/e2e/shell-and-menus.spec.ts`), E201
  (`tests/e2e/hosted.spec.ts`) and W13 (`tests/e2e/web.spec.ts`) read
  `page.getByTestId('app-menu').locator('button')` and compare the exact id
  list. Either render the submenu panel outside that container or update those
  three tests in this change — do not leave them failing, and do not weaken
  them.

### Wiring (App.tsx)

- The in-app menu gets the View state it needs on every flavor that renders it,
  not just where a native menu is installed: the `buildAppMenu` call
  (`src/App.tsx` ~line 3696) is fed the same values the `buildMenuSpec` call
  (~line 3750) already passes for View — `mode`, `splitEdit`, `showComments`,
  `commentsEnabled`, `commentCount`, `showDiff`, `showWordCount`,
  `showFrontmatter`, `lineNumbers`, `showFolders`, `openOnly`, `openFileCount`,
  `docOpen`, `canEdit`, `appMode`, `hotkeys` — with the `useMemo` dependency
  list extended so a toggle updates the submenu's checked/disabled state live
  (open the menu, toggle Line Numbers, reopen: the check has flipped).
- Desktop (Tauri) behaviour is unchanged: `buildMenuSpec`'s output for every
  state is identical to before the change. `tests/unit/menu-spec.test.ts` —
  including U34, U35, U317–U319, U324, U325 — and the e2e that read the
  installed spec's View submenu (E86, E94, E136) stay green **untouched**.

### Code, tests, and gate

- New and changed behaviour carries `// PRD 009 Req 12:` citation comments per
  `.sandcastle/CODING_STANDARDS.md`; `docs/MAP.md` is regenerated with
  `npm run map` and committed if any citation moved.
- Unit coverage in `tests/unit/app-menu.test.ts` (and `menu-spec.test.ts` for
  the extracted builder) starting at **U348** — the suite tops out at U347:
  the in-app View rows match the desktop spec's View command items for the same
  state; predefined items and the mac Fullscreen separator are dropped; the
  surviving separator sits before the zoom group and the list neither starts nor
  ends with one; the comment rows and Changes Since Save follow
  `commentsEnabled` / edit mode; the sidebar/open-set rows are absent without a
  workspace capability and merely disabled with one; `checked` and `disabled`
  survive the mapping; and every child row's command is a real `CommandId`.
- E2e: add focused coverage starting at **E214** (the suite tops out at E213) in
  `tests/e2e/shell-and-menus.spec.ts` — opening View ▸ lists the expected rows
  for the state, a checked item reads as checked, activating one (e.g. Line
  Numbers or Word Count) actually toggles the app and closes the menu, and a
  greyed row is disabled. The broad Req 18 sweep is #96's; add only what this
  change needs.
- Iterate with `npm run typecheck` and `npm run test:unit` (or
  `npx playwright test -g '<title>'` for a single e2e), not the full suite. Run
  `npm run validate:quick` **once**, right before declaring the goal met; it
  prints `QUICK VALIDATION: ALL PASSED`. Do not use it as a start-of-attempt
  baseline beyond a single optional quick-tier check.
- A summary comment from the implementer exists on issue #94 (what changed, how
  the two menus share the View definitions, the rule chosen for
  omit-vs-disable, files touched, gate evidence).

### Scope

- Out of scope: Sign out (#95), the Req 18 e2e sweep (#96), any change to the
  mode model (#90), the workspace New File / Save As… picker (#91), and any
  change to the desktop native menus.

## Context

PRD: `prd/009-server-mode-menu.md` (Req 12 and the Non-goals); parent #88;
blocked-by #93, which has landed.

#93 built the in-app menu as data: `src/lib/appMenu.ts` (`buildAppMenu` →
ordered groups of rows; the `view` group currently holds one submenu-parent row
`{ label: 'View', testId: 'menu-view', submenu: true }`), rendered by
`src/components/Toolbar.tsx` (the `.theme-picker` popover, rows dispatching
through `onCommand`). CSS for the popover, separators and the ▸ arrow is at
`src/styles.css:170–205` (`.theme-menu`, `.theme-menu.anchor-left`,
`.menu-sep`, `.submenu-arrow`, the `:disabled` rule).

The desktop View menu is the `viewMenu` literal inside `buildMenuSpec`
(`src/lib/menuSpec.ts:227+`); its `MenuState` fields and the `cmd()` helper's
`checked` / `disabled` arguments are the gating to preserve. `App.tsx` builds
`MenuState` in the native-menu effect (~line 3750) and `AppMenuState` in the
`appMenu` memo (~line 3696) — the two call sites to reconcile.

Commands are already registered and handled: `toggleFolders`, `toggleOpenOnly`,
`nextFile`, `prevFile`, `toggleMode`, `toggleSplit`, `toggleComments`,
`nextComment`, `prevComment`, `toggleDiff`, `headingPalette`, `toggleWordCount`,
`toggleFrontmatter`, `toggleLineNumbers`, `zoomIn`, `zoomOut`, `zoomReset`
(`src/lib/commands.ts`, `dispatchCommand` in `src/App.tsx` ~line 3400+). Zoom is
a persisted setting, so it works on every flavor.
