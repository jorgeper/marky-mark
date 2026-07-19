# SPEC36: Marky Mark v36 — multiple open files (sidebar tabs)

Delta spec on top of SPEC.md–SPEC35.md as implemented (SPEC31 remains
spec-only; SPEC28 withdrawn). This file wins on conflict; nothing may
regress. §11 is the goal condition.

**What ships:** the sidebar learns **multiple open files**. Mod+click
(⌘ on macOS, Ctrl elsewhere) opens a file *in addition to* the current
one; every open file renders as a tab-shaped row, and only the active
one sits on the front plane — the workspace's edge shadow "breaks" for
it alone. A new header toggle (+ hotkey + View menu item) shows **only
the open files** as a flat list, the way the # filter shows only
markdown. Ctrl+Tab / Ctrl+Shift+Tab cycle the open set. Each open file
keeps its own buffer, dirty flag, and undo history in memory (true
multi-buffer — switching never prompts), and Quit walks every dirty
file with the existing save/discard/cancel prompt. The open set, the
active file, and the toggle persist across launches behind a new
default-on setting.

Out of scope: the web build (no folder panel there — its single-file
behavior and all W tests are unchanged); drag-reordering of tabs;
pinned tabs; MRU cycle order; a close-file hotkey (the ✕ is the only
close affordance; later delta); per-file edit/preview mode (mode stays
global); per-file crash drafts (the existing single draft covers the
ACTIVE document only — a crash loses parked dirty buffers; documented
limitation); a toolbar tab strip; multi-window coordination.

---

## 1. Open-set model — `src/lib/openFiles.ts` (FR-MODEL)

New pure module, no DOM, no platform imports, `'/'`-and-`'\'`-tolerant
like `folderTree.ts`:

1. `treeOrderCompare(a, b)` — compares two absolute file paths in
   **visible tree order**: walk path components from the front; at the
   first differing component, a directory component (one with more
   components after it) sorts before a file component (the last one),
   then case-insensitive `localeCompare` — the same folders-first rule
   as `compareEntries`, so the flat open list reads in exactly the
   order the tree shows the files. Independent of expansion state.
2. `addOpen(list, path): string[]` — inserts `path` keeping the list
   tree-ordered; already present ⇒ same list. The list is ALWAYS
   maintained in tree order (display and cycling both read it as-is).
3. `closeOpen(list, path): { list, nextActive }` — removes `path`;
   `nextActive` = the entry that followed it in tree order, else the
   one before it, else null. Absent path ⇒ unchanged list, null.
4. `cycleOpen(list, active, dir: 1 | -1): string | null` — the next
   entry with wrap-around; `active` not in the list (or null) ⇒ the
   first entry; fewer than 2 entries ⇒ null (no-op).
5. `remapOpen(list, oldPrefix, newPrefix): string[]` — every entry
   rewritten through SPEC35's `remapPath`, then re-sorted into tree
   order (a rename can move a file across the order).
6. `pruneOpen(list, deletedPath): string[]` — drops the exact entry
   and any entry under `deletedPath` as a directory prefix
   (separator-aware, same boundary rules as `remapPath`).
7. `FolderState` (version stays 1) gains three OPTIONAL fields with
   defaults on parse: `openFiles: string[]` (default `[]`, persisted
   capped at `OPEN_CAP = 50`, tree order), `activeFile: string | null`
   (default null; forced null when not present in `openFiles`), and
   `openOnly: boolean` (default false). `serializeFolderState` writes
   them; old files without them parse cleanly. The in-session open set
   is uncapped — the cap applies at persistence only, like
   `EXPANDED_CAP`.

## 2. Multi-buffer parking (FR-PARK)

1. App keeps the active document on the existing single-buffer
   pipeline (buffer, savedText, html, comments, parked editor
   history) — that pipeline does not change. A volatile in-memory
   **park map** `path → { buffer, savedText, comments, editorHistory }`
   holds every open-but-inactive file. Nothing in the park map is
   persisted.
2. **Activate(path)**: record the outgoing doc's reading position
   (SPEC16 §3.2) and park its bundle; then restore the target from the
   park map, or open it from disk when unparked. Restoring runs the
   normal open pipeline from the parked buffer (render, comments,
   title, watch re-target, reading-position restore) — find bar, diff
   view, and selection state reset exactly as an open does today.
3. Freshness on activation of a parked file: if its parked buffer is
   **clean** (`buffer === savedText`) and the on-disk content differs,
   reload from disk; if **dirty**, the parked buffer wins — the same
   "never clobber local edits" rule the file watcher applies.
4. Switching between open-set members NEVER prompts. Any number of
   files may be dirty at once; the window's dirty indicator keeps
   reflecting the active file only.
5. The crash-draft mechanism (SPEC30) is unchanged and covers the
   active document only.
6. An untitled buffer (File → New) stays OUTSIDE the open set — it has
   no path to park under. It occupies the active slot as today; any
   navigation away from a dirty untitled routes through the existing
   unsaved-changes guard. A clean untitled is simply dropped.

## 3. Opening and closing (FR-OPEN)

1. **Mod+click** (⌘ click on macOS, Ctrl+click elsewhere) on a
   markdown file row: not open ⇒ `addOpen` + activate (no guard — the
   outgoing doc parks); open but inactive ⇒ activate; active ⇒ no-op.
   On macOS, plain Ctrl+click remains the SPEC35 context menu and
   never opens anything. Mod+click on directories and dim non-markdown
   rows does nothing beyond the plain-click behavior.
2. **Plain click** on a not-open markdown row keeps today's semantics:
   it REPLACES the active file — `openDocGuarded` (save/discard/cancel
   when the active doc is dirty), the replaced file leaves the open
   set, the clicked one enters it as active; the open count does not
   grow. Plain click on an open row (active or not) just activates it,
   no guard. File → Open, Open Recent, file drop, and SPEC35's
   create-then-open all follow the same replace-or-activate rule.
3. At boot, an explicit open (CLI path, `#open` hash, file
   association) joins the restored set as the active file (added if
   absent), preserving the SPEC30 explicit-open race discipline.
4. **Close affordance**: every open file's row (both views, §4–§5)
   shows a ✕ on row hover — a `span[role="button"]`, test id
   `folder-tab-close`, inside the row (NOT a nested `<button>` — the
   row is one); its pointerdown/click stop propagation so the row
   doesn't activate. Closing a clean file removes it immediately.
   Closing a dirty file first activates it, then shows the existing
   unsaved-changes modal naming the file: Save ⇒ save then close;
   Don't Save ⇒ close; Cancel ⇒ stays open and active.
5. Closing the active file activates `closeOpen(...).nextActive`;
   closing the last open file lands on the splash (SPEC4 clean start)
   with the tree selection cleared.
6. **Dirty marker**: an open row whose buffer is dirty (active or
   parked) shows a ● (span, test id `folder-dirty`) in the ✕'s slot;
   row hover swaps it for the ✕.

## 4. Sidebar visuals (FR-TABS)

1. Open-but-inactive rows carry class `open`: the tab pill shape
   (rounded left corners, the same left gap and flush-right geometry
   as `.selected`) but ON THE PANEL PLANE — a muted surface tint, no
   punch-through shadow, and the workspace's right-edge inset shadow
   continues across them. The active row keeps the existing
   `.selected` front-plane treatment unchanged — it remains the ONLY
   element that breaks the panel/workspace seam. Colors via existing
   theme variables; no new required theme keys.
2. In tree view, open rows appear only where their ancestors are
   expanded — opening or restoring files never auto-expands the tree.
   The existing reveal-on-selection scroll behavior is unchanged and
   applies to the active row only.

## 5. Only-open-files mode (FR-ONLY)

1. A new folder-header button between the title and the # filter,
   test id `folder-open-only`, SVG icon of two stacked tab/card
   shapes drawn in the header's stroke style; accent-colored
   (`filter-on` treatment) while ON; disabled when there is no root
   and no open file.
2. Toggled by the button, by a new rebindable hotkey `toggleOpenOnly`
   (default **Mod+Shift+O**), and by a new View-menu item **"Only Open
   Files"** (checked when on) inserted directly after the "Folders"
   item. The hotkey works whether or not the panel is visible; turning
   the mode on while the panel is hidden also shows the panel.
3. ON: the tree is replaced by a flat list of the open files in tree
   order — same `folder-item` rows/test ids, no chevrons, no depth
   indent, glyph + basename, full tab styling per §4 (active front,
   others behind), hover ✕ per §3.4. The # filter button is disabled
   while in this mode. With an empty open set the list area shows a
   muted "No open files" line, test id `folder-open-empty`.
4. The sync button ("Navigate to the open file") in this mode
   switches back to tree view and reveals the active file (existing
   reveal). The Open Folder…/root-less empty state is unchanged and
   takes precedence when no root is set and the mode is off.
5. `openOnly` persists in `foldertree.json` (§1.7) and restores at
   boot regardless of the §8 setting (it is view state, not the set).

## 6. Cycling and hotkeys (FR-CYCLE)

1. `src/lib/hotkeys.ts` gains a strict-Ctrl modifier: `ComboParts` gets
   `ctrl: boolean`; `parseCombo` maps `ctrl`/`control` to it (they no
   longer alias Mod — no shipped default or recorded binding ever used
   those spellings, so nothing regresses); `mod` keeps matching
   ⌘-or-Ctrl, but when a combo carries `ctrl`, `eventMatches` requires
   `ctrlKey` and the `mod` flag then matches `metaKey` alone;
   `comboFromEvent` (recording) is unchanged and still emits `Mod`;
   `displayCombo` renders it "⌃" on macOS, "Ctrl+" elsewhere.
2. `HotkeyMap` gains `nextFile` (default **Ctrl+Tab**), `prevFile`
   (default **Ctrl+Shift+Tab**), and `toggleOpenOnly` (default
   **Mod+Shift+O**); `HOTKEY_LABELS` gains "Next Open File",
   "Previous Open File", "Only Open Files" (the Settings hotkeys tab
   lists them automatically; settings migration fills defaults for
   stored maps missing them).
3. `nextFile`/`prevFile` activate `cycleOpen(list, active, ±1)` — tree
   order, wrap-around, no prompts; fewer than two open files ⇒ no-op.
   From an untitled active doc the target is the first open file and a
   dirty untitled routes through the guard (§2.6). The handler runs in
   both preview and edit mode and always `preventDefault`s when
   matched (the editor must not receive Tab).
4. Menu: View gains "Only Open Files" (§5.2, accelerator
   `toggleOpenOnly`). "Next/Previous Open File" are hotkey-only — no
   menu items. No other menu changes.

## 7. Quit walk (FR-QUIT)

1. The `close` command (⌘Q / Close Window / Exit — every path that
   runs today's guard) now walks ALL dirty documents instead of just
   the current one: each dirty open file in tree order, then a dirty
   untitled last. Each step activates the file (so it is visible
   behind the modal) and shows the existing close-prompt naming it:
   Save ⇒ write and continue; Don't Save ⇒ continue; Cancel ⇒ abort
   the entire quit, every file stays open, nothing further prompts.
2. When nothing is dirty the window closes immediately, as today. The
   walk state is transient — a quit aborted halfway leaves already-
   saved files saved and everything open.

## 8. Persistence and settings (FR-PERSIST)

1. `foldertree.json` write-through (SPEC34 §2.3) now includes
   `openFiles` (tree order, capped per §1.7), `activeFile`, and
   `openOnly` — updated on every open/close/activate/toggle.
2. `Settings` gains `restoreOpenFiles: boolean` (default **true**),
   General tab checkbox "Reopen open files at launch", test id
   `set-restore-open-files`, next to the reopen-last-document setting.
3. Boot: when `restoreOpenFiles` is on and the persisted `openFiles`
   is non-empty, the set is restored — entries whose file no longer
   exists are dropped silently — and `activeFile` (fallback: first
   entry) opens as the active document; this takes the place of the
   reopen-last-doc reopen (which would be redundant). When the setting
   is off, or the set is empty, boot behaves exactly as today
   (`reopenLastDoc` unchanged) and the persisted set is IGNORED but
   not cleared — flipping the setting back on revives it. Restored
   background files load lazily (first activation reads the disk);
   restore parks no buffers.
4. An explicit boot open (§3.3) still wins the active slot per the
   SPEC30 race rules.

## 9. SPEC35 integration (FR-FILEOPS)

1. **Rename** (file or ancestor directory): the open set, the park-map
   keys, and `activeFile` remap through `remapPath`/`remapOpen` —
   parked buffers, dirty flags, and undo histories survive untouched;
   the active doc's remap behavior (title, next save) is SPEC35 §5.3
   unchanged.
2. **Delete**: `pruneOpen` drops deleted entries (or everything under
   a deleted directory); their parked state is discarded. If the
   active document was pruned: `nextActive` per §3.5 — another open
   file activates, else the splash per SPEC35 §6.3. Recents, drafts,
   and expanded-set pruning are SPEC35 unchanged.

## 10. Tests (added: U64, E100–E104)

1. **U64** — `openFiles`: `treeOrderCompare` (siblings, different
   depths, dir-vs-file at divergence, case-insensitivity, `\`
   separators); `addOpen` order-keeping and dedupe; `closeOpen`
   neighbor rules (middle/first/last/only/absent); `cycleOpen` wrap
   both directions, absent-active, <2 no-op; `remapOpen` re-sort on
   cross-order rename; `pruneOpen` exact and prefix with boundary
   cases (`/a/bc` survives deleting `/a/b`); `FolderState`
   parse/serialize round-trip of the three new fields, defaults for
   legacy files, `activeFile`-not-in-set forced null, `OPEN_CAP`.
   Plus hotkeys: strict-Ctrl parse, `eventMatches` (Ctrl+Tab matches
   ctrlKey, not metaKey-only; Mod combos still match either),
   `displayCombo` "⌃"/"Ctrl+" forms, `comboFromEvent` unchanged.
2. **E100** — opening (shim): Mod+click opens a second file (both rows
   tab-shaped, new one active/front, `open` vs `selected` classes);
   Mod+click an open row activates without prompting though the
   outgoing file is dirty; Mod+click the active row no-ops; plain
   click on a third file replaces the active one (set size stays 2,
   guard prompt when dirty); plain click on an open row activates.
3. **E101** — only-open mode: button, Mod+Shift+O, and View menu all
   toggle it (button accented, menu checked); flat list matches tree
   order with no indent; # filter disabled in-mode; empty set shows
   `folder-open-empty`; sync flips back to tree and reveals; `openOnly`
   survives reload.
4. **E102** — cycling: three open files, Ctrl+Tab advances in tree
   order and wraps, Ctrl+Shift+Tab reverses; edits made mid-cycle are
   intact (buffer + dirty dot) on return; single open file ⇒ no-op;
   works from edit mode without inserting a Tab character.
5. **E103** — dirty lifecycle: dirty two files, switch freely with no
   prompts, each row shows ● which hover swaps for ✕; ✕ on a clean
   background row closes it silently; ✕ on a dirty row prompts
   (Cancel keeps it open+active, Don't Save closes it); closing the
   active file activates the tree-order neighbor; closing the last
   file lands on the splash.
6. **E104** — quit + restore: quit with two dirty files walks both
   prompts in order (Cancel mid-walk aborts and both stay open; Save
   on the first writes it before the second prompt); reload restores
   the set + active file and drops a since-deleted path;
   `set-restore-open-files` off ⇒ reload restores only per
   reopen-last-doc, and flipping it back on revives the persisted set.
7. No existing test may be modified, weakened, skipped, or deleted;
   E42–E44 stay reserved. The only permitted test additions are U64
   and E100–E104.

## 11. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U64, E1–E41 +
   E45–E104, W1–W11 — and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` is EMPTY (this feature is frontend-only). No
   new dependencies; no version-file changes (0.4.0-alpha.1); no
   `.skip/.only/.todo`; the Windows-reserved-name scan prints nothing.
3. README: a tabs bullet under Folders. ARCHITECTURE.md: the open-set
   model, the park map and freshness rule, the strict-Ctrl hotkey
   token, and the new `foldertree.json` fields.
