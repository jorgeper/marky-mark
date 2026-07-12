# SPEC31: Marky Mark v31 — New Window (multi-window)

Delta spec on top of SPEC.md–SPEC30.md as implemented. This file wins on
conflict; nothing may regress. §7 is the goal condition. **Implement
after SPEC30** — it assumes SPEC30's boot-order rules exist.

**What ships:** real multi-window. **File → New Window (⌘⇧N)** opens
another independent main window (splash, own document, own buffer/undo/
mode). File-association and CLI opens route sensibly across windows.
Quit guards every dirty window. macOS-native feel over tabs (explicitly
chosen: windows, not tabs).

Out of scope: tabs, dragging documents between windows, per-window
settings (settings stay global), window-state restoration (positions/
sizes) beyond what the OS gives, the web build (one page = one window;
the command is desktop + shim only).

---

## 1. Command & menu (FR-NW)

1. New command **`newWindow`**; `HotkeyMap` gains **`newWindow`**,
   default **`Mod+Shift+N`** (rebindable; Settings → Hotkeys "New
   window"). **File → New Window** directly after New, both OS layouts.
   Platforms without the capability (web) render the menu item never
   (web has no native menu) and the command is a silent no-op.
2. `Platform` gains **`openMainWindow?(): Promise<void>`** — desktop
   creates a real second main window; the dev shim opens a same-origin
   popup (the aux-window pattern) so e2e can drive two mains; web
   leaves it undefined.

## 2. Window identity & routing (FR-ROUTE)

1. Main windows get labels `main`, `main-2`, `main-3`, … —
   `src/lib/windowRole.ts` grows a `mainLabel(n)` helper and the
   role router treats every `main*` label as a main window.
   `src-tauri` capabilities widen from the literal `main` to the
   `main*` pattern — **this is the only permitted src-tauri change**,
   reviewed against SPEC11's isolation posture (same permission set,
   more window instances; aux capability untouched).
2. **Open routing (association/CLI/drop):** a path opens in — (a) a
   window already showing that document (focus it), else (b) a docless
   main window (reuse), else (c) a NEW main window. The Rust open-drain
   emits to a coordinator (the oldest live main) which applies (a)–(c)
   over the SPEC13 event bus. Drag-drop stays window-local (you dropped
   it there).
3. SPEC30's reopen-on-launch applies to the FIRST window only; a ⌘⇧N
   window always starts at the splash.

## 3. Shared state across mains (FR-SHARED)

1. **Settings:** any main may write `settings.json`; every write also
   broadcasts `mm://settings-changed` (the existing SPEC13 event, now
   consumed by main windows too) — last writer wins, all windows
   converge, panel-open edge cases follow the SPEC13 merge rules.
2. **Recents & reading positions:** same pattern — write-through plus a
   changed-event rebroadcast; last writer wins (documented trade-off:
   no merge, the files are tiny and MRU-shaped).
3. **Drafts (SPEC30):** the draft file becomes per-window-label
   (`draft-<label>.json`); boot restore scans all of them, offers the
   newest, deletes what it consumes.
4. **Aux windows (Settings/About):** stay singletons app-wide; the
   window that opened one owns its protocol pairing; `mm://settings-
   changed` broadcasts keep every main in sync regardless of owner.
5. **Updater/Export/Print:** per-window, unchanged.

## 4. Lifecycle (FR-LIFE)

1. Per-window close (⌘W / close button) keeps its existing guard.
2. **Quit** (⌘Q / app menu) walks every window with a dirty buffer:
   each prompts in turn (focus follows); any Cancel aborts the quit;
   the last window closing exits the app (standard Tauri behavior,
   Windows) while macOS keeps the app alive per platform convention —
   whichever the current Rust host already does, unchanged.
3. The file watcher, comment autosave, and recents recording are
   already per-window-instance state; no cross-window locks (last
   writer wins on the tiny JSON stores, per §3).

## 5. Tests (added: U60, E93–E95)

1. **U60** — windowRole: `main`, `main-2`, `main-7` all route to the
   main app; aux labels unchanged; `mainLabel(n)` formatting;
   menu spec: File carries New Window after New on both layouts with
   the rebindable accelerator (fixture gains nothing — hotkey only).
2. **E93** — (shim) ⌘⇧N opens a second main window at the splash;
   each window opens a different document and they stay independent
   (buffer, mode, dirty state); closing the dirty one prompts, Cancel
   keeps it alive.
3. **E94** — routing: with doc A open in window 1 and window 2 empty,
   an association-style open of A focuses window 1; an open of B lands
   in the empty window 2; with both occupied, an open of C creates
   window 3 (shim: popup count).
4. **E95** — shared state: changing the theme in window 1 applies in
   window 2 (settings broadcast); opening a doc in window 2 shows in
   window 1's Open Recent submenu after the changed-event.
5. No existing test may be modified, weakened, skipped, or deleted;
   E42–E44 stay reserved.

## 6. Docs

ARCHITECTURE.md: multi-window section (labels, routing rules, shared-
state LWW model, quit walk). README: New Window joins the desktop-
citizen bullet.

## 7. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U60, E1–E41 +
   E45–E95, W1–W11 — and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` shows ONLY the main-capability label-pattern
   widening (no new permissions — diff reviewed line by line in the
   transcript); no dependency or version-file changes; no
   `.skip/.only/.todo`; reserved-name scan prints nothing.
3. Manual (goal notes, not automatable): two real desktop windows,
   file-association routing per §2.2, quit-walk with two dirty windows.
