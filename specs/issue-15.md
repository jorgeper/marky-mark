# Spec: Workspace model, .marky-workspace file, session state & migration (#15)

## Goal

All acceptance criteria in specs/issue-15.md are satisfied for issue #15, with
evidence visible in the session: a workspace model with three states — no
workspace, untitled workspace, named workspace, at most one current — backs a
pretty-printed, versioned `.marky-workspace` JSON file holding an ordered list
of folder references and workspace-scoped settings but no machine/session
state; per-workspace machine-local session state (folder roots plus
open-tab/expanded/active-file state) is restored when a workspace loads and
the current workspace reopens at launch; existing `settings.json` and a single
`foldertree.json` root migrate silently and non-destructively (the root is
adopted as an untitled workspace with one folder, nothing rewritten); `npm run
validate:quick` passes in the implementer's session; and a summary comment
from the implementer exists on issue #15.

## Acceptance criteria

- A workspace model module exists in `src/lib/` (e.g. `src/lib/workspace.ts`)
  defining the three workspace states — **no workspace**, **untitled
  workspace**, **named workspace** — as pure data types plus pure transition
  operations (open folder, add folder, save-as-named, close), with at most one
  current workspace representable at a time (§C7). The module performs no I/O;
  unit tests under `tests/unit/` cover each state transition.
- Opening a folder through the existing `openFolder` command path
  (`src/App.tsx` `openFolderCmd`) creates an **untitled workspace** containing
  that one folder. The model's add-folder operation turns a single-folder
  untitled workspace into a multi-root untitled workspace, preserving folder
  order and deduplicating repeats (§C8). (The Add Folder / Open Workspace /
  Save Workspace As menu items ship in sibling #16 — this issue provides the
  operations and wiring they will call, exercised here by unit tests and the
  existing open-folder entry point.)
- A `.marky-workspace` parse/serialize pair exists with round-trip unit
  tests: the file is pretty-printed **JSON** containing a schema/version
  marker, an ordered list of **folder references**, and **workspace-scoped
  settings** (the W keys plus any cosmetic defaults the author pins). It
  contains **no** M-scoped or session state (no open tabs, expanded dirs,
  active file, positions, or recents), and parsing is corruption-tolerant in
  the style of `parseFolderState`/`parseSettings` — malformed input yields a
  sane empty workspace rather than a throw (§C9).
- Folder references serialize **relative to the workspace file's directory**
  where possible and resolve to absolute paths at load; a folder whose
  resolved path is unreachable stays in the model flagged unavailable (so the
  UI can grey it) rather than being silently dropped. Unit tests cover
  relative/absolute round-trips and the unavailable flagging (§C10).
- An **untitled** workspace's state (folder list + workspace settings +
  session tabs) is autosaved to a single current-untitled slot under
  `<configDir>/session/`, overwritten when a new untitled workspace starts,
  and survives restart until the save-as-named operation converts it to a
  `.marky-workspace` file and clears the slot (§C11).
- A **named** workspace autosaves changes to folder membership and workspace
  settings back to its `.marky-workspace` file — there is no explicit Save
  Workspace command — while never writing session state into it (§C12).
- Folder root(s) and open-tab/expanded/active-file state (the content of
  today's `foldertree.json`, see `FolderState` in `src/lib/folderTree.ts`)
  are stored as **per-workspace machine-local session state** (e.g. keyed
  files under `<configDir>/session/`), so loading a workspace — via launch
  reopen now, or workspace switching when #16 lands — restores that
  workspace's own tabs and expanded tree, and one workspace's session state
  never leaks into another's or into any shareable file (§B6, §F22).
- The current workspace (named or untitled) is reopened at launch, consistent
  with today's reopen-last behavior at startup in `src/App.tsx` (~line
  1487–1544) (§C13).
- When a workspace is current, its workspace-scoped settings feed the
  `workspace` input of `resolveSettings` (`src/lib/settings.ts`), so W keys
  become workspace-authoritative exactly as the #14 resolver already
  enforces; with no workspace current, effective settings are unchanged from
  today.
- Migration is non-destructive and silent (§G23, §G24): `settings.json`
  continues to be read unchanged as the User layer (no keys moved or lost, no
  prompt), and on first launch an existing `foldertree.json` with a single
  root is adopted as an untitled workspace with that one folder — the user
  sees the same sidebar, tabs, and expanded state as before, and neither
  `settings.json` nor `foldertree.json` is rewritten or deleted by the
  migration read.
- The pre-existing unit and e2e suites still pass; a fresh install with no
  prior config files starts in the no-workspace state without errors.
- Iteration during implementation uses `npm run typecheck` and `npm run
  test:unit` (or tests targeted at the changed code); the full gate `npm run
  validate:quick` is run ONCE, right before declaring the goal met — not
  after every small change and not as a baseline at the start — and passes,
  printing `QUICK VALIDATION: ALL PASSED` in the implementer's session.
- A summary comment from the implementer exists on issue #15.

## Context

PRD: `prd/002-workspaces-and-layered-configuration.md` (§B6, §C7–C13, §F22,
§G23–G24); parent #13. Blocked-by #14 is merged: `src/lib/settings.ts` has
`resolveSettings`, `SETTINGS_SCOPES` (U/U!/W/M), and a `SettingsLayers`
interface whose `workspace` slot is currently always empty — this issue is
what feeds it. Sibling issues own the rest: #16 File menu flows + multi-root
sidebar, #17 Settings UI tabs, #18 platform boundary — do not build menus,
sidebar rendering, or settings UI here, but shape the model so they can call
it. Today's persistence: `foldertree.json` (parse/serialize in
`src/lib/folderTree.ts`, written from `src/App.tsx` ~line 911, loaded ~line
1538), `recent.json` (`src/lib/recentFiles.ts`), `positions.json`,
`settings.json` — all under `<configDir>` via the platform layer
(`src/platform/`). Follow the repo's pattern of pure parse/serialize/transition
functions in `src/lib/` with I/O confined to `App.tsx`; keep parsing tolerant
of corruption like the existing stores. Verify with `npm run validate:quick`
(typecheck + unit + desktop e2e).
