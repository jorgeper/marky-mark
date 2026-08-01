# Spec: File menu, workspace flows & multi-root sidebar (#16)

## Goal

All acceptance criteria in specs/issue-16.md are satisfied for issue #16, with
evidence visible in the session: the File menu contains New, Open…, Open
Folder…, Open Workspace…, Open Recent ▸, Add Folder to Workspace…, Save
Workspace As…, and Close Workspace ahead of the existing Save / Save As /
Export / Print / Close Window items, grouped with separators, and each
workspace item is wired to the #15 workspace model; Open Recent lists recent
workspaces first, then a separator, then recent files, then Clear Menu — MRU,
deduped, separately capped per section, corruption-tolerant, with
disambiguated labels; Close Workspace returns the app to the no-workspace
state (empty sidebar) leaving any open single file as-is; the folder sidebar
renders multiple independently-expandable roots when the workspace has more
than one folder, reusing the existing lazy folder-tree behavior per root;
`npm run validate:quick` passes in the implementer's session; and a summary
comment from the implementer exists on issue #16.

## Acceptance criteria

- The File menu built by `buildMenuSpec` (`src/lib/menuSpec.ts`) contains, in
  this order and grouped with separators: **New**, **Open…** (file), **Open
  Folder…**, **Open Workspace…**, **Open Recent ▸**, **Add Folder to
  Workspace…**, **Save Workspace As…**, **Close Workspace**, then the
  existing **Save / Save As… / Export… / Print…** group and **Close Window**
  (Exit / Settings on the non-mac branch stay as they are) (§D14). The new
  items are `CommandId`s registered in `src/lib/commands.ts`, appear in both
  the mac and non-mac desktop branches of the menu spec, and unit tests under
  `tests/unit/` assert the item order and grouping.
- The new menu commands are wired in `src/App.tsx` through the existing
  `updateWorkspace` seam (~line 984) and the #15 model
  (`src/lib/workspace.ts`): **Open Workspace…** shows a file-open dialog
  filtered to `.marky-workspace`, loads the file corruption-tolerantly via
  `parseWorkspaceFile`/`workspaceFromFile`, and makes it the current (named)
  workspace with its session state restored; **Add Folder to Workspace…**
  shows a folder dialog and applies `addWorkspaceFolder` (a single-folder
  untitled workspace becomes multi-root; with no workspace open it behaves
  like Open Folder, creating an untitled workspace); **Save Workspace As…**
  shows a save dialog defaulting to a `.marky-workspace` name and applies
  `saveWorkspaceAs`, writing the file and converting an untitled workspace to
  named; **Close Workspace** applies `closeWorkspace`.
- **Close Workspace** observably returns the app to the no-workspace state:
  the sidebar shows its empty (root-less) state, and any open single file
  stays open and untouched (§D16).
- **Open Recent** lists recent **workspaces** first (most-recent-first), then
  a separator, then recent **files**, then Clear Menu — Clear alone when both
  sections are empty (§D15). Recent workspaces extend the `recent.json`
  lineage (`src/lib/recentFiles.ts`): MRU on open/save of a named workspace,
  deduped by path, a separate cap per section (reuse `RECENT_CAP` = 10 for
  each), corruption-tolerant parsing in the style of `parseRecent`, and
  labels disambiguated with the parent folder's name when basenames collide
  (as `recentMenuEntries` does today). Selecting a recent workspace opens it;
  Clear Menu clears both sections. Unit tests cover the section ordering,
  caps, dedupe, and tolerant parsing.
- The folder sidebar (`src/components/FolderPanel.tsx`) renders **multiple
  roots** when the current workspace has more than one folder: each root is
  shown with its own header/title row, is independently expandable and
  collapsible, and lazily lists its directories exactly as the existing
  single-root tree does (reusing the existing `Rows`/folder-tree behavior per
  root, §D17). With zero or one root, the sidebar looks and behaves as it
  does today. Per-workspace session state (expanded dirs, open tabs) from #15
  keeps working across all roots.
- The pre-existing unit and e2e suites still pass; no behavior change on the
  web build beyond compiling (the platform boundary that hides workspace UI
  on web is sibling #18's — do not build it here).
- Iteration during implementation uses `npm run typecheck` and `npm run
  test:unit` (or tests targeted at the changed code); the full gate `npm run
  validate:quick` is run ONCE, right before declaring the goal met — not
  after every small change and not as a baseline at the start of an attempt
  (baseline with the quick tier only) — and passes in the implementer's
  session.
- A summary comment from the implementer exists on issue #16.

## Context

PRD: `prd/002-workspaces-and-layered-configuration.md` §D14–D17; parent #13.
Blocked-by #15 is merged on this branch: `src/lib/workspace.ts` provides the
pure model (`openFolderWorkspace`, `addWorkspaceFolder`, `saveWorkspaceAs`,
`closeWorkspace`, parse/serialize for `.marky-workspace` files and session
stores), and `src/App.tsx` already holds `curWorkspaceRef` plus the
`updateWorkspace` autosave seam the new menu commands should call — this
issue is mostly menu spec + dialogs + wiring + sidebar rendering, not new
model code. The menu is pure data (`buildMenuSpec`) converted to native menus
by `src/platform/tauri.ts` and recorded by the browser shim for e2e; add new
`CommandId`s in `src/lib/commands.ts` and follow the existing
`cmd(...)`/`sep` pattern. Recents: `src/lib/recentFiles.ts` and the
`recentFiles` field of `MenuState`; `RecentItemSpec` carries a path — recent
workspace entries need to be distinguishable from recent files when
dispatched. Sidebar: `FolderPanel.tsx` currently takes a single `root: string
| null`; keep its empty state and context-menu behavior intact for the
no-workspace case. Whether workspace-only items (Save Workspace As, Close
Workspace, Add Folder with no folder chosen) disable or no-op when
inapplicable is the implementer's call — match existing menu patterns.
Verify with `npm run validate:quick` (typecheck + unit + desktop e2e).
