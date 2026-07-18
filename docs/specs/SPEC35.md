# SPEC35: Marky Mark v35 — folder & file management in the sidebar

Delta spec on top of SPEC.md–SPEC34.md as implemented (SPEC31 remains
spec-only; SPEC28 withdrawn). This file wins on conflict; nothing may
regress. §10 is the goal condition.

**What ships:** a **context menu** on the folder sidebar's rows — create,
rename (in place), delete (confirmed, to the Trash), reveal in the OS
file manager, and copy path / copy relative path. Directories offer New
File / New Folder **created as children of the clicked directory**; the
panel's empty area offers the same against the root. All destructive or
name-changing operations keep the open document, the tree state, recents,
and `foldertree.json` consistent.

Out of scope: the web build (SPEC34 seams stay undefined there — the
panel itself never renders); renaming or deleting the **root** from the
sidebar (retarget or use the OS file manager); drag-and-drop moves;
copy/cut/paste of entries; multi-select; undo of file operations; a
`.md` extension guard on rename (the user may rename freely; a file that
stops being markdown simply renders dim per SPEC34); file-system
watching beyond the existing re-list events.

---

## 1. Platform seam (FR-SEAM)

Four OPTIONAL `Platform` methods (each absent ⇒ its menu items are
omitted; everything else still works):

- `renameEntry?(oldPath, newPath): Promise<void>` — plugin-fs `rename`
  (existing broad fs scope). Shim: virtual-fs key rewrite, including the
  prefix rewrite for directories.
- `trashEntry?(path): Promise<void>` — moves a file or directory
  (recursively) to the OS Trash / Recycle Bin. Desktop: one new Rust
  command backed by the `trash` crate — **the only permitted new
  dependency**, no network, no capability beyond the command itself.
  Shim: removes from the virtual fs and records the path on
  `window.__mmTrash` (array, newest last).
- `revealPath?(path): Promise<void>` — select the entry in the OS file
  manager: plugin-opener `revealItemInDir` (same plugin already shipped;
  add its permission if the capability file lacks it). Shim: records on
  `window.__mmReveals`.
- `copyText?(text): Promise<void>` — clipboard write. Desktop + shim:
  `navigator.clipboard.writeText`; the shim additionally records on
  `window.__mmClipboard` so e2e can assert without clipboard permissions.

Creation needs no new seam: `writeTextFile` + `mkdirp` + `exists` +
`readDirEntries` already cover it.

## 2. Pure logic — `src/lib/folderOps.ts` (FR-OPS)

New pure module, no DOM, no platform imports:

1. `validateEntryName(name): string | null` — returns a human error or
   null (valid). Rejects: empty / whitespace-only; `/` or `\`; `.` or
   `..`; a leading `.` (dotfiles are invisible to the tree per SPEC34 —
   creating one from the tree would vanish it); trailing `.` or space;
   length > 255; and **Windows-reserved basenames** (`aux con prn nul
   com1–com9 lpt1–lpt9`, case-insensitive, judged on the name before its
   first `.` — the repo's reserved-name CI scan must stay clean).
2. `uniqueChildName(existing: string[], base: string): string` — `base`,
   else `base` with ` 2`, ` 3`, … inserted before the extension
   (`Untitled.md`, `Untitled 2.md`; `New Folder`, `New Folder 2`),
   case-insensitive collision check.
3. `remapPath(path, oldPrefix, newPrefix): string | null` — the path
   with `oldPrefix` (an exact entry or directory prefix, separator-aware)
   rewritten to `newPrefix`; null when `path` is unaffected.
4. `relativePath(root, path): string` — `path` relative to `root`,
   preserving the platform's separator as found in the inputs; the root
   itself ⇒ `.`.
5. `folderContextMenu(kind: 'dir' | 'file' | 'root', opts: { isMac:
   boolean; canReveal: boolean; canTrash: boolean; canRename: boolean;
   canCopy: boolean }): Array<{ id, label } | 'sep'>` — the single
   source of menu truth so tests pin it:
   - `dir`: New File, New Folder, ─, Rename, Delete, ─, *reveal*, ─,
     Copy Path, Copy Relative Path.
   - `file`: *reveal*, ─, Rename, Delete, ─, Copy Path, Copy Relative
     Path.
   - `root` (empty-area): New File, New Folder, ─, *reveal*, ─, Copy
     Path.
   - *reveal* label: **"Reveal in Finder"** when `isMac`, else
     **"Reveal in File Explorer"**. Items whose capability flag is false
     are omitted (and a flanking separator collapses).

## 3. The context menu (FR-MENU)

1. `contextmenu` on any `folder-item` row (directories, markdown files,
   and dim non-markdown files alike) opens the in-app menu for that row;
   `contextmenu` on the list's empty area opens the `root` menu (only
   when a root is set). Native browser menu suppressed inside the panel.
2. In-app DOM menu styled like the existing theme/overflow menus,
   positioned at the pointer and clamped to the viewport. Dismissed by
   Esc, any outside pointer-down, scroll, resize, or invoking an item.
   Test ids: `folder-menu`, items `folder-menu-<id>` (`new-file`,
   `new-folder`, `rename`, `delete`, `reveal`, `copy-path`,
   `copy-relative-path`).
3. Menu actions never fire on left click; row click behavior (SPEC34) is
   unchanged.

## 4. Create (FR-CREATE)

1. **New File**: target directory = the clicked directory (or the root
   for the empty-area menu). Name = `uniqueChildName(listing,
   'Untitled.md')`; an empty file is written, the target directory is
   expanded and re-listed, and the new row **immediately enters in-place
   rename** (§5) with the basename-without-extension selected.
2. When that rename commits or cancels, the resulting file — if markdown
   — opens through `openDocGuarded` (the unsaved-changes guard applies,
   cancel leaves the file created but unopened).
3. **New Folder**: same flow with base `New Folder`; `mkdirp`; nothing
   opens; the new directory is left collapsed and in-place renaming.

## 5. Rename in place (FR-RENAME)

1. The row's label swaps for a text input (test id `folder-rename-input`)
   prefilled with the current name; files select the stem, directories
   select everything. Enter commits, Esc cancels, blur commits. The
   panel's other interactions are inert for the row while editing.
2. Validation on every keystroke via `validateEntryName` plus a
   case-insensitive sibling-collision check (against the live listing,
   excluding itself). Invalid ⇒ the input carries an `invalid` class and
   `title` = the error; Enter/blur with an invalid or unchanged value
   cancels instead of committing.
3. Commit: `renameEntry`, then re-list the parent. Then remap every
   piece of state that referenced the old path (entry itself or, for a
   directory, any descendant): the open `docPath` (window title follows;
   buffer text, dirty flag, undo history, and comments are untouched —
   the next save simply writes the new path), the tree selection, the
   expanded set, and the recents entry for each affected path (same MRU
   position). Persist `foldertree.json` and `recent.json` after remap.
4. Failures (fs error) leave the input open with the error in `title`.

## 6. Delete (FR-DELETE)

1. Delete opens an in-app confirm modal (test ids `folder-delete-prompt`,
   `folder-delete-confirm`, `folder-delete-cancel`) naming the entry:
   *“Move ‘NAME’ to the Trash?”* — for a directory: *“…and its
   contents?”*. When the target is (or contains) the open document with
   unsaved changes, the body appends *“It has unsaved changes.”* Esc /
   Cancel ⇒ no-op. Confirm is the default (Enter).
2. Confirm: `trashEntry` (recursive for directories), re-list the
   parent, prune deleted paths from the expanded set and recents,
   persist both stores.
3. If the open document was deleted (directly or inside a deleted
   directory): the buffer closes to the splash (SPEC4 clean start —
   no dialog beyond the already-given confirmation), the tree selection
   clears, the crash-draft for it is discarded, and its
   reading-position entry is left to the existing pruning rules.

## 7. Copy path (FR-COPY)

`copy-path` puts the row's absolute path on the clipboard verbatim;
`copy-relative-path` uses `relativePath(root, path)`. The empty-area
menu copies the root's absolute path.

## 8. Menus, hotkeys, settings

No menubar changes, no new hotkeys, no new settings in this SPEC. (The
menu is pointer-only; keyboard file management can be a later delta.)

## 9. Tests (added: U63, E96–E99)

1. **U63** — `folderOps`: name validation (valid names; each rejection
   class incl. every Windows-reserved stem and case variants);
   `uniqueChildName` numbering with extensions and case-insensitive
   collisions; `remapPath` (exact, descendant, unaffected, separator
   edge at prefix boundaries — `/a/bc` untouched by `/a/b` → `/a/x`);
   `relativePath` (nested, root itself, Windows separators);
   `folderContextMenu` — exact item sets and order for all three kinds,
   both reveal labels, capability-flag omission with separator collapse.
2. **E96** — menu basics (shim): right-click a directory / a markdown
   file / a dim file / the empty area ⇒ correct items (ids per §2.5);
   Esc and outside-click dismiss; left click never opens it; Copy Path
   and Copy Relative Path land the exact strings on `__mmClipboard`;
   `reveal` records on `__mmReveals`.
3. **E97** — create: New File under a nested expanded directory creates
   `Untitled.md` there (numbered on the second run), enters inline
   rename with the stem selected, Enter commits and the file opens;
   Esc keeps `Untitled.md` and it opens; New Folder creates, renames in
   place, opens nothing; empty-area New File targets the root.
4. **E98** — rename: rename the open (dirty) file ⇒ path, title, recents
   remap, dirty flag and buffer intact, next ⌘S writes the new path and
   the old path stays gone; rename a directory above the open file ⇒
   docPath/expanded/selection remap and `foldertree.json` reflects it;
   collision and reserved-name inputs show `invalid` and refuse to
   commit; Esc restores the label.
5. **E99** — delete: Cancel is a no-op; deleting a dim file removes its
   row and trashes on `__mmTrash`; deleting the open dirty file shows
   the unsaved-changes sentence, confirms to the splash, prunes recents
   and the draft; deleting an expanded directory containing the open doc
   does all of the above plus prunes the expanded set.
6. No existing test may be modified, weakened, skipped, or deleted;
   E42–E44 stay reserved. The only permitted test additions are U63 and
   E96–E99.

## 10. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U63, E1–E41 +
   E45–E99, W1–W11 — and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` limited to: the `trash`-crate dependency +
   its Rust command + registration, and (only if missing) the opener
   `revealItemInDir` and fs `rename` permissions. No version-file
   changes (0.4.0-alpha.1); no other dependencies; no `.skip/.only/
   .todo`; the Windows-reserved-name scan prints nothing.
3. README: file-management bullet under Folders. ARCHITECTURE.md: the
   four seam methods and the remap-on-rename/delete rules.
