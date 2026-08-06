# PRD 009: Server-mode menu and exclusive modes

**Status:** Draft
**Date:** 2026-08-06

## Problem

In server mode (the hosted build, and by extension every non-desktop
flavor that uses the in-app hamburger menu), the app has no coherent mode
model or menu. The desktop client has a clean three-state model
(splash / file / workspace, issue #22) with a full native menu; server
mode instead has:

- A top-right hamburger with only seven app-level items (New, Open…,
  Save, Save As…, Help, About, Settings…) — no workspace actions, no
  Close File, no Close Workspace, no View items.
- A *second* menu — the bottom-right workspace-switcher chip — holding
  New Workspace… and Open Workspace….
- No way to leave a workspace or a file and return to the initial page:
  the `closeFile` / `closeWorkspace` commands exist with full dirty-file
  handling but are only reachable from the *native* desktop menu.
- Two dead ends: hosted has no save dialog, so "New" creates an untitled
  buffer that can never be saved, and "Save As…" on a workspace file
  silently fails.
- A blurred mode boundary: a local file can be opened inside an open
  workspace (PRD 007 Req 21), which contradicts the mental model of two
  distinct modes.
- No sign-out affordance anywhere in the hosted shell.

The owner wants server mode to mirror the client's model: two distinct
working modes (workspace, single-file) entered from the initial page,
one menu — on the left — that is the single source of truth for actions,
with the initial-page buttons acting as shortcuts to those same actions.

## Goals

- Server/web mode has exactly two working modes — **workspace** and
  **single-file** — plus the initial page, matching the desktop client's
  splash/file/workspace model.
- One in-app menu, anchored on the **left** side of the toolbar, is the
  single home for every action; the initial-page buttons are shortcuts
  to a subset of the same commands.
- Every mode is exitable: Close File and Close Workspace are reachable
  from the menu and return to the initial page after the existing
  dirty-file prompts.
- Single-file mode is a genuinely useful local editor on the web: open
  local files, edit, and save locally (in place where the browser allows
  it, download otherwise).
- The two hosted dead ends (unsaveable New, dead Save As…) are gone.
- The View functionality available on desktop is available in server
  mode through a View submenu.
- Hosted users can sign out.

## Non-goals

- **Desktop (Tauri) behavior changes.** The native menus and desktop
  mode model already work as intended and stay untouched, except where a
  shared command's semantics change identically everywhere (New File in
  workspace mode is scoped to non-desktop flavors; desktop keeps its
  current untitled-buffer flow because it has a save dialog).
- **Mixing local files into a workspace.** The "local file inside a
  workspace" behavior (PRD 007 Req 21's in-workspace variant, e2e E209)
  is deliberately retired, not preserved behind a flag.
- **New hotkeys.** Existing hotkeys keep working; this PRD adds none.
- **Multi-workspace or workspace switching UI.** The switcher chip is
  removed; switching is Close Workspace → Open Workspace (or the
  implicit switch via Open Workspace…). No quick-switch replacement.
- **Server-side changes beyond what New File / Save As need.** The
  workspace file API (PRD 007) already supports file creation; no new
  endpoints beyond what Req 9 requires.
- **Sign-in flow changes.** Sign-out is added; the sign-in experience
  (PRD 007 Req 4–6) is unchanged.
- **Static-web deployment work.** The static web build inherits the new
  menu capability-gated, but no dedicated deployment or feature work is
  done for it — the hosted build is the deployment target.

## Requirements

### Mode model

1. Non-desktop flavors (hosted, static web, browser shim) expose exactly
   three UI states: **initial page** (no document, no workspace),
   **single-file mode** (one or more local-file tabs open, no
   workspace), and **workspace mode** (a workspace open). The existing
   `AppMode` (splash/file/workspace) is the single source of truth for
   gating.
2. Single-file mode supports multiple open local files as tabs ("single
   file" means "no workspace", not "one document"). The folder sidebar
   is unavailable in single-file mode.
3. Closing the last file in single-file mode, or closing the workspace
   in workspace mode, returns to the initial page. Both paths run the
   existing dirty-file prompts (save / discard / cancel; the multi-file
   walk for workspaces).
4. Modes are exclusive. Invoking a crossing action — Open File… /
   drag-and-drop of a local file while in workspace mode, or Open
   Workspace… / New Workspace while in single-file mode — first closes
   the current mode (running its dirty-file prompts, aborting the switch
   on cancel), then enters the target mode directly, without passing
   through the initial page.
5. Opening or dropping a local file while a workspace is open no longer
   opens it inside the workspace; it triggers the mode switch of Req 4.
   The in-workspace local-file behavior and its e2e coverage (E209) are
   retired.
6. In hosted mode, Close Workspace clears the `?workspace=<id>` URL
   binding (equivalent of `workspaces.navigateTo(null)`), so a reload
   after closing lands on the initial page, not back in the workspace.

### Menu

7. The hamburger menu button moves to the **left** end of the toolbar
   (before the document name); the popover opens left-anchored. All
   flavors that render the in-app menu are affected.
8. The menu is a single flat list in separator-divided groups, in this
   order: file actions (New File, Open File…, Close File), workspace
   actions (New Workspace, Open Workspace…, Close Workspace), save
   actions (Save, Save As…), **View ▸** submenu, app actions (Sign out
   — hosted only, Settings…, Help, About Marky Mark).
9. Item visibility is mode- and capability-gated:
   - **New File** appears only in workspace mode.
   - **Close File** appears only when at least one file is open;
     **Close Workspace** only in workspace mode.
   - Workspace actions appear only on flavors with a workspace
     capability (hosted, shim, desktop) — never on static web.
   - Save / Save As… are hidden when the current file is not editable
     (existing PRD 007 Req 17 gating preserved).
   - Items that are merely momentarily inapplicable (e.g. Save with no
     document) are disabled (greyed), not hidden.
10. The initial-page buttons (Open File…, New Workspace…, Open
    Workspace…, plus Open Folder… where the capability exists) remain
    shortcuts that dispatch the same commands as the menu items, derived
    from capabilities as today (PRD 007 Req 21/22).
11. The bottom-right workspace-switcher chip and its popover are
    removed. The current workspace name remains visible in the existing
    title/document affordance; no replacement chip is introduced.

### View submenu

12. The View submenu mirrors the desktop View menu items, driven by the
    same definitions (`menuSpec` View entries), with identical
    mode/capability gating: Folders (workspace mode only), Only Open
    Files, Next/Previous Open File, Edit Mode, Split Edit, Comments and
    comment navigation (when comments are enabled), Changes Since Save
    (edit mode), Go to Heading…, Word Count, Front Matter, Line
    Numbers, and Zoom In / Zoom Out / Actual Size. Items a flavor
    cannot honor are omitted, matching desktop's gating rules.

### Files: create and save

13. In workspace mode, **New File** prompts for a name (and target
    folder within the workspace), creates the file through the
    workspace file API, and opens it as the current document. It no
    longer creates a floating untitled buffer on non-desktop flavors.
14. In workspace mode, **Save As…** prompts for a name/folder within
    the workspace and saves a copy there through the same picker as
    Req 13, then switches the current document to the new file.
15. In single-file mode, opening a file uses the File System Access API
    where the browser offers it: Save writes in place through the
    retained handle after the browser's permission grant. Where the API
    is unavailable (or the file arrived without a handle, e.g. some
    drag-and-drop paths), Save falls back to downloading the file — the
    existing `commitFile` path.
16. Single-file mode has no New File action (Req 9); creating files is
    a workspace-mode capability only on non-desktop flavors.

### Sign out

17. Hosted mode shows a **Sign out** menu item. Activating it runs the
    dirty-file prompts for open work, clears the stored bearer token,
    and returns to the sign-in screen. It never appears on flavors
    without hosted auth.

### Verification

18. E2e coverage updates: the frozen hamburger item-set tests (E13,
    E201, W13) are updated to the new structure; new tests cover Close
    File → initial page, Close Workspace → initial page (including the
    URL clearing of Req 6), the implicit mode switch with dirty prompt
    (Req 4), workspace New File / Save As… (Req 13–14), and Sign out
    (Req 17). E209 is retired per Req 5.

## Open questions

- None.
