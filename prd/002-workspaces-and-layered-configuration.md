# PRD 002 — Workspaces & layered configuration

## Problem

Marky Mark today opens a single file or a single folder, with a flat, one-level
configuration model: every setting lives in one `settings.json` (plus
`recent.json`, `foldertree.json`, `positions.json`) in the app config dir. There
is exactly one scope — the local user — so:

- There is no way to group multiple folders and their settings into a named,
  portable project the way VS Code's *workspaces* do. A reviewer working across
  several repos/folders must reopen each one and reconfigure every time.
- Settings that are really *structural to a project* (where comments are stored,
  where pasted images land) can't be pinned so everyone reviewing that project
  stays consistent; they're per-user only, so two reviewers can silently diverge
  and split a comment set.
- There is no path to the owner's near-term goal: a cloud-hosted, multi-user
  Marky Mark where an admin sets org-wide defaults, a team shares settings, a
  workspace is shared, and each user still keeps personal preferences. The flat
  model can't express that hierarchy.

This PRD introduces (1) a **layered configuration system** with a defined
precedence and per-setting scoping, and (2) **workspaces** — the concrete
feature that consumes the workspace layer — modeled closely on VS Code so it's
immediately familiar. The cloud/team multi-user machinery is *designed for* (the
Team layer's slot and override rules are defined) but its sync/auth/server
storage is out of scope here and will be a follow-up PRD.

## Goals

- A single configuration resolver with four ordered layers —
  **Global < Team < Workspace < User** — where the user's value wins by default,
  but individual settings can be scope-tagged so structural ones stay
  workspace-authoritative.
- VS Code-style workspaces: open a file, open a folder (= untitled workspace), or
  open a `.marky-workspace` file; add folders to a workspace; save a workspace;
  reopen recent workspaces and files.
- A workspace bundles **multiple folder roots + workspace-scoped settings** in
  one portable, committable `.marky-workspace` JSON file.
- A settings inventory where every existing setting has a defined scope, so
  users and future teams know where each value can be set and which layer wins.
- A Settings UI that lets a user edit **User** vs **Workspace** values, showing
  the effective value and any overrides.
- A design that extends cleanly to the future cloud/team model with no rewrite of
  the resolver.

## Success criteria (observable)

- A user can File → Open Folder…, then File → Save Workspace As… to produce a
  `.marky-workspace` file; reopening that file restores the folder(s), workspace
  settings, and per-workspace open tabs.
- File → Add Folder to Workspace… adds a second root to the sidebar; a
  single-folder (untitled) workspace becomes a multi-root untitled workspace.
- File → Open Recent lists recent workspaces (top) and recent files (bottom).
- Setting `commentStorage` in a workspace makes that value apply for anyone who
  opens the workspace, and it is **not** overridden by a user's personal
  `commentStorage` (workspace-authoritative); setting a cosmetic value like
  `theme` at both User and Workspace makes the **User** value win.
- The Settings window shows User | Workspace tabs; the Workspace tab is enabled
  only when a workspace is open and writes to the `.marky-workspace` file.
- On the web build, no workspace UI appears, but the same resolver yields
  effective settings from Global < Team < User.

## Non-goals

- **Cloud hosting, authentication, multi-user sync, and server-side storage** —
  deferred to a follow-up PRD. This PRD only reserves the Team layer's slot and
  defines its precedence/override behavior.
- **Editable Global and Team layers in the local UI.** Global is baked defaults +
  an optional admin file; Team has no local editor. Both are read-only here (the
  resolver honors them if present).
- **A per-folder in-repo settings sidecar** (VS Code's `.vscode/settings.json`
  per folder). All workspace settings live in the one `.marky-workspace` file.
- **A YAML format or any new parser dependency** — the workspace file is JSON,
  like every existing store.
- **Workspaces on the web build** — desktop-only (web has no filesystem/folder
  access).
- **Heavyweight or prompting migration** — upgrade is non-destructive and silent
  (see Requirements §G).
- **Per-folder (multi-root) setting overrides** — settings resolve at the
  workspace level, not per individual root folder.
- **Changing the meaning, defaults, or behavior of any existing setting** beyond
  assigning it a scope.

## Requirements

### A. Configuration layers & resolution

1. The app resolves every setting through four ordered layers, lowest→highest
   precedence: **Global → Team → Workspace → User**. The highest layer that
   provides a value wins.
2. Each setting carries a **scope tag** that constrains which layers may set it:
   - **U (user-personal):** settable at any layer as a default, but the User
     value wins (default precedence).
   - **U! (user-only identity):** only meaningful at the User layer; ignored if
     present in any other layer. (`author`.)
   - **W (workspace-authoritative):** Global/Team/Workspace may set it; a User
     value is **ignored** so the workspace stays authoritative. (`commentStorage`,
     `imageFolder`, `imageNamePattern`.)
   - **M (machine/session-local):** never part of the layered merge; read/written
     directly to local per-user-per-machine state and never serialized into a
     workspace/team/global file.
3. Resolution is pure and deterministic given the four layer inputs, and is
   exercised by unit tests covering each scope tag's precedence and the W/U!
   exclusion rules.
4. Unknown/malformed keys in any layer fall back to the next layer down (and
   ultimately baked defaults), mirroring today's tolerant `parseSettings`.

### B. Settings inventory & scopes

5. Every persisted setting is assigned exactly one scope tag, per this adopted
   classification:
   - **U:** `themeLight`, `themeDark`, `useDarkTheme`, `fontSize`, `zoom`,
     `margins`, `paneMinWidth`, `lineNumbers`, `editorSyntax`, `tableGridView`,
     `inlineImages`, `showFrontmatter`, `showWordCount`, `showResolved`,
     `vimNav`, `typeToComment`, `autosaveOnToggle`, `autoHideToolbar`,
     `exportTheme`, `hotkeys`, `commentsEnabled`, `reopenLastDoc`,
     `restoreOpenFiles`.
   - **U!:** `author`.
   - **W:** `commentStorage`, `imageFolder`, `imageNamePattern`.
   - **M:** `splitEdit`, `splitRatio`, `showFolders`, `folderWidth`; plus the
     folder root(s) & open-tab/expanded state (today's `foldertree.json`),
     reading positions, and the recent list.
6. The **folder root(s) and open-tab/expanded/active-file state** become
   **per-workspace** machine-local session state: switching workspaces restores
   that workspace's own open tabs and expanded tree.

### C. Workspace model & files

7. Three workspace states exist, mirroring VS Code: **no workspace** (single file
   or nothing open), **untitled workspace** (a folder or folders opened but not
   saved to a file), and **named workspace** (a `.marky-workspace` file is open).
   At most one workspace is current at a time.
8. Opening a folder creates an **untitled workspace** with that one folder. Adding
   a folder to a single-folder untitled workspace makes it a multi-root untitled
   workspace.
9. The `.marky-workspace` file is pretty-printed **JSON** and contains: a
   schema/version marker, an ordered list of **folder references**, and the
   **workspace-scoped settings** (W settings plus any cosmetic settings the
   workspace author chose to pin as defaults). It contains **no** M-scoped/session
   state.
10. Folder references are stored relative to the workspace file where possible
    (portable across machines), resolving to absolute paths at load; unreachable
    folders are surfaced (e.g. shown as unavailable) rather than dropping
    silently.
11. An **untitled** workspace's state (its folder list + workspace settings +
    session tabs) is autosaved to `<configDir>/session/` so it survives restart
    until the user runs Save Workspace As.
12. A **named** workspace autosaves changes to folder membership and workspace
    settings back to its `.marky-workspace` file (no explicit "Save Workspace"
    command needed).
13. The current workspace (named or untitled) is reopened at launch, consistent
    with today's reopen-last behavior.

### D. File menu & flows

14. The File menu provides: **New**, **Open…** (file), **Open Folder…** (opens as
    untitled workspace), **Open Workspace…** (opens a `.marky-workspace`),
    **Open Recent ▸**, **Add Folder to Workspace…**, **Save Workspace As…**,
    **Close Workspace**, then the existing Save/Save As/Export/Print and Close
    Window items, grouped with separators as agreed in the interview.
15. **Open Recent** lists recent **workspaces** first, then a separator, then
    recent **files**, then Clear Menu — extending today's `recent.json` behavior
    (MRU, deduped, capped, corruption-tolerant, disambiguated labels).
16. **Close Workspace** returns the app to the no-workspace state (empty sidebar),
    leaving any open single file as-is.
17. The folder sidebar renders **multiple roots** when a workspace has more than
    one folder, each root independently expandable, reusing the existing lazy
    folder-tree behavior per root.

### E. Settings UI

18. The Settings window gains a **User | Workspace** scope selector. The **User**
    tab shows all settings and writes to the User layer. The **Workspace** tab is
    enabled only when a workspace is open, shows only workspace-eligible settings
    (W settings + pinnable cosmetic defaults), and writes to the
    `.marky-workspace` file (or the untitled workspace session store).
19. Each row shows the **effective value** and, when a higher-precedence layer
    overrides the tab's own layer, an indicator naming the winning layer (e.g.
    "overridden by User"). W settings shown on the User tab are indicated as
    workspace-controlled and not user-editable.
20. Global and Team layers are **read-only** in the UI (no editing controls) but
    their resolved contributions are reflected in effective values/indicators.

### F. Storage & resolution locations

21. Layer sources: **Global** = baked-in `DEFAULT_SETTINGS` plus an optional admin
    file `<configDir>/global-settings.json` (absent by default); **Team** = a
    reserved slot with no local file today (resolver honors one if present,
    forward-compat for cloud); **Workspace** = the `.marky-workspace` file (or
    untitled session store); **User** = the existing `<configDir>/settings.json`.
22. M-scoped/session state continues to live in local per-machine stores (today's
    `foldertree.json`/`positions.json`/`recent.json` lineage), keyed per-workspace
    where noted, and is never written to any shareable layer file.

### G. Migration (non-destructive, silent)

23. On upgrade, the existing `settings.json` is read unchanged as the **User**
    layer — no keys move or are lost, no prompt.
24. An existing single folder root (`foldertree.json`) is adopted as an
    **untitled workspace with one folder** on first launch, so current folder
    users keep their sidebar seamlessly. No data is rewritten on upgrade.

### H. Platform boundary

25. Workspace features (Open/Save/Add Folder/Close Workspace, the multi-root
    sidebar, the Workspace settings tab) are **desktop-only**. The web build shows
    none of them.
26. The same resolver runs everywhere; on web the effective config is
    **Global < Team < User** (no Workspace layer), so the future cloud/web-hosted
    multi-user version is an extension, not a rewrite.

### I. Forward-compatibility (team/cloud)

27. The resolver, scope tags, and layer file contract are defined so a future Team
    layer (and cloud-sourced Global/Workspace layers) plug in without changing
    precedence semantics or the workspace file format. `author` is designed to
    derive from an authenticated identity in the cloud model.

## Open questions

- **Untitled-workspace session file naming/GC:** exact location and cleanup
  policy for `<configDir>/session/` untitled state (e.g. single slot vs keyed).
  Default: single current-untitled slot, overwritten on new untitled workspace.
- **Which cosmetic settings are "pinnable" on the Workspace tab:** the W set is
  fixed; whether to expose *all* U settings as pinnable workspace defaults or a
  curated subset (e.g. theme, margins) is a UI-scope call — default to a curated
  subset, expand later.
- **Recent workspaces cap & shared cap with recent files:** reuse `RECENT_CAP`
  (10) per section, or one combined cap. Default: separate cap per section.
- **Unavailable folder presentation:** exact affordance for a workspace folder
  whose path no longer resolves (greyed root + remove action). Flag for design
  polish during implementation.
- **Global admin file discovery on desktop:** whether to also honor an OS
  machine-wide path in addition to `<configDir>/global-settings.json`. Default:
  config-dir only for now.
