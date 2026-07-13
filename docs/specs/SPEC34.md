# SPEC34: Marky Mark v34 — the folder sidebar

Delta spec on top of SPEC.md–SPEC33.md as implemented (SPEC31 remains
spec-only — its provisional test numbers renumber when it is
implemented; SPEC28 withdrawn). This file wins on conflict; nothing may
regress. §8 is the goal condition.

**What ships:** a VS Code-style **folder sidebar** on the left —
expand/collapse folders, markdown files marked with a `#` glyph and
clickable, everything else grayed and inert. Resizable, closeable,
toggled from **View → Folders** and a rebindable hotkey (**⌘⇧E**).
Expanded state and the chosen root persist. Opening a file **reveals it
in the tree by default**, and a **sync button** re-reveals on demand.
**File → Open Folder…** opens a folder as the tree root without opening
any file.

Out of scope: the web build (it defines neither seam method below, so
the entire feature is unreachable there — no hamburger change, E13
stands), file operations from the tree (rename/delete/create/drag),
multi-root workspaces, dotfiles (hidden), file-system watching of the
tree (refresh happens on the events in §3.5), icons beyond the `#`
glyph and a folder chevron.

---

## 1. Platform seam (FR-SEAM)

Two OPTIONAL `Platform` methods (absent ⇒ the feature never renders):
- `readDirEntries?(dir): Promise<Array<{ name: string; isDir: boolean }>>`
  — direct children, names only. Desktop: plugin-fs `readDir` (the
  existing broad fs scope; **no capability change**). Shim: derived
  from the virtual fs's path prefixes. Web: undefined.
- `openFolderDialog?(): Promise<string | null>` — native directory
  picker (the existing `dialog:default` permission, `directory: true`).
  Shim: `window.__mmfs.nextFolderPath` test hook, prompt fallback.
  Web: undefined.

## 2. State & persistence (FR-STATE)

1. Pure module `src/lib/folderTree.ts`:
   - `isMarkdownFile(name)` (`.md`/`.markdown`, case-insensitive);
   - `compareEntries` — folders first, then case-insensitive alpha;
   - `visibleEntries(entries)` — dotfiles/dot-dirs filtered;
   - `ancestorsOf(root, path, dirname)` — the chain of directories to
     expand to reveal `path` (empty when `path` is outside `root`);
   - `parseFolderState`/`serializeFolderState` for
     `<configDir>/foldertree.json`: `{ version: 1, root: string | null,
     expanded: string[] }`, corruption-tolerant, expanded capped at 200.
2. Settings gain **`showFolders: boolean` (default `false`)** and
   **`folderWidth: number`** (px, clamped 160–480, default 240) — house
   parse rules. `HotkeyMap` gains **`toggleFolders`, default
   `Mod+Shift+E`** (Settings → Hotkeys row "Show / hide folders").
3. Root + expanded set persist to `foldertree.json` (write-through,
   best-effort, same pattern as recents); width/visibility ride
   settings.

## 3. The sidebar (FR-TREE)

1. Renders left of the workspace in every mode (preview, full edit,
   split edit) when: the platform defines §1's methods AND
   `showFolders` is on. Test ids: `folder-panel`, `folder-header`,
   `folder-sync`, `folder-close`, `folder-divider`, per-row
   `folder-item` (with `data-path`), `folder-open-btn` (empty state).
2. **Rows:** directories show a chevron (▸/▾) and toggle expansion on
   click; children load lazily per directory via `readDirEntries` on
   first expansion (and re-list on every expansion — cheap, keeps the
   tree honest without watchers). Markdown files show the `#` glyph,
   are clickable (`openDocGuarded` — the unsaved-changes guard applies)
   and the open document's row carries a `selected` class. All other
   files render grayed (`folder-item-dim`) and inert. Sorting and
   filtering per §2.1.
3. **Header:** the root's basename, a **sync** button (§5), and an **×**
   that closes the panel (same as the View toggle off).
4. **Empty state** (no root chosen): a centered "Open Folder…" button
   invoking the same command as the menu item.
5. **Refresh:** a directory re-lists whenever it is (re)expanded; the
   root re-lists when the panel opens, when the root changes, and after
   a Save As / untitled-save lands a new file (the existing openDoc
   hand-off makes this free: reveal (§5) re-lists the ancestor chain).
6. **Resizable:** the divider drags width within the clamp, live via a
   CSS variable (the split-divider pattern), persisting `folderWidth`
   on release. **Closeable:** the ×, the View checkbox, and the hotkey
   all flip the same persisted `showFolders`.

## 4. Commands & menu (FR-CMD)

1. **`toggleFolders`** — View checkbox ("Folders", accelerator from the
   hotkey, checked = `showFolders`), first item in View (above Edit
   Mode: layout chrome before mode toggles). Silent no-op on platforms
   without the seam (web).
2. **`openFolder`** — File → **Open Folder…** directly after Open
   Recent (before the separator), no default accelerator. Flow: pick a
   directory → it becomes the persisted root (expanded set reset to
   just the root), the panel opens (`showFolders` persisted on), **no
   file opens**. Cancel ⇒ no-op.
3. Both commands join the registry/dispatch exactly like their
   siblings. The web hamburger is untouched.

## 5. Reveal & sync (FR-REVEAL)

1. **On open** (every successful `openDoc` of a real path, any source —
   dialog, recents, association, tree click): if the panel is visible,
   the tree expands `ancestorsOf(root, path)` and scrolls the file's
   row into view, selected. If the file lies **outside the current
   root** (or there is no root), the root retargets to the file's
   directory first (persisted). A hidden panel stays hidden — opening
   files never forces the sidebar open.
2. **The sync button** does the same reveal on demand for the current
   document (disabled with no document).
3. Untitled buffers: no reveal (nothing on disk); the selection class
   clears.

## 6. Tests (added: U60–U61, E93–E95)

1. **U60** — `folderTree`: markdown detection, folder-first sort,
   dotfile filtering, `ancestorsOf` (nested, at-root, outside-root ⇒
   empty), state round-trip/corruption/cap.
2. **U61** — menu/hotkeys/settings: View starts with the Folders
   checkbox (accelerator `Mod+Shift+E`, tracks `showFolders`); File
   carries Open Folder… after the Open Recent submenu; both layouts;
   `showFolders` default false, `folderWidth` clamps 160–480 (default
   240), hotkey merges into old settings files.
3. **E93** — tree basics (shim, seeded virtual folders): open panel via
   hotkey → empty state → Open Folder…, (hook-armed) → root lists,
   folders sort first, dotfiles absent; expand/collapse persists across
   reload (`foldertree.json`); a `.md` row opens the doc (guard
   included — dirty buffer prompts); a non-md row is dim and click-inert.
4. **E94** — chrome: divider drag changes width and persists
   (`folderWidth`); × closes and the View checkbox (nativeMenu spec)
   unchecks; hotkey reopens; setting round-trips reload.
5. **E95** — reveal: opening a nested file (recents/hash) with the
   panel open expands its ancestors and selects its row; opening a file
   outside the root retargets the root to the file's directory;
   collapsing everything then pressing `folder-sync` re-reveals;
   opening with the panel hidden does NOT show the panel; an untitled
   buffer clears the selection.
6. No existing test may be modified, weakened, skipped, or deleted;
   E42–E44 stay reserved. (The panel defaults closed, so existing
   layout assertions are unaffected.)

## 7. Docs

README: a Folders bullet. ARCHITECTURE.md: seam additions, the
persistence file, the reveal/root-retarget rule. DEVELOPING.md
unchanged.

## 8. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U61, E1–E41 +
   E45–E95, W1–W11 — and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` empty (the existing fs scope and
   `dialog:default` cover both seam methods); no dependency or
   version-file changes; no `.skip/.only/.todo`; reserved-name scan
   prints nothing.
3. README + ARCHITECTURE.md updated per §7.
