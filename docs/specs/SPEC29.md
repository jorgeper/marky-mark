# SPEC29: Marky Mark v29 — File → Open Recent

Delta spec on top of SPEC.md–SPEC27.md as implemented (all green: U1–U55,
E1–E41 + E45–E87, W1–W10; SPEC8 still pending, E42–E44 reserved; SPEC28
was withdrawn unimplemented — its number stays retired). This file wins
on conflict; nothing may regress. §6 is the goal condition.

**What ships:** the classic. The app remembers the last **10** documents
opened; **File → Open Recent** (native menu) lists them most-recent-first
with a **Clear Menu** item. Selecting one reopens it through the normal
unsaved-changes guard; a vanished file gets a notice and drops off the
list. Persisted in `recent.json` next to `positions.json`.

Out of scope: the macOS system-level recents (NSDocumentController /
Dock menu), recents in the web build's hamburger (web documents are
handle-scoped and generally not reopenable by path), recents on the
splash (a possible follow-up), pinning, per-entry icons.

---

## 1. The store (FR-STORE)

Pure module `src/lib/recentFiles.ts`, mirroring `readingPositions.ts`:
`RecentStore { version: 1, entries: [{ path, at }] }`, `RECENT_CAP = 10`,
`parseRecent` (corruption-tolerant) / `serializeRecent` (pretty, trailing
newline), `rememberRecent` (MRU-first, dedupe by path, cap),
`removeRecent`, `clearRecent`, and `recentMenuEntries(store, basename,
dirname)` → `[{ path, label }]` — label is the basename; entries whose
basename collides with another entry's get ` — <parent folder>` appended.

## 2. Recording & persistence (FR-REC)

1. Every successful `openDoc` of a real path records it (untitled buffers
   never; failed opens never) and best-effort writes
   `<configDir>/recent.json`. Save As / first-save-of-untitled record via
   their existing `openDoc` hand-off for free.
2. Boot loads `recent.json` beside the positions load, tolerant of
   corruption/absence.

## 3. Menu & commands (FR-MENU)

1. The menu spec grows real nesting: item kinds **`submenu`**
   (`{ title, items }`) and **`recent`** (`{ path, label }`).
   `MenuState` gains `recentFiles: Array<{ path, label }>`.
2. **File → Open Recent** sits directly after Open… on both OS layouts:
   the recent items (MRU order), a separator, and **Clear Menu**
   (command `clearRecent`, a no-op when already empty; with no recents
   the submenu holds just Clear Menu, macOS-style).
3. `tauri.ts` builds nested `Submenu`s; recent items dispatch through a
   new registry channel (`registerRecentHandler`/`dispatchRecent(path)`
   in `commands.ts` — paths aren't `CommandId`s). The shim records the
   spec as ever; `__mmMenu.click` now finds commands inside nested
   submenus, and a new `__mmMenu.clickRecent(path)` drives recent items.
4. Selecting a recent: `exists(path)` → the normal guarded open;
   missing → notice "<name> is no longer there" + the entry is removed
   and persisted. `clearRecent` empties the list and persists.
5. The web hamburger is untouched (E13's count stands); the web build
   simply never installs a native menu, so nothing shows there.

## 4. Tests (added: U56–U57, E88)

1. **U56** — `recentFiles`: (SPEC28's withdrawn slot, reused) MRU insert/dedupe/cap at 10; remove; clear;
   label disambiguation (same basename ⇒ parent-folder suffix, distinct
   basenames stay bare); serialize→parse round-trip; malformed/absent
   JSON ⇒ empty store.
2. **U57** — menu spec: both layouts carry the Open Recent submenu
   directly after Open… with the given entries in order, then separator
   + Clear Menu; empty list ⇒ submenu with Clear Menu only; File's
   top-level command list is unchanged (U19/U20 fixtures untouched
   except the compile-level `recentFiles: []` field).
3. **E88** — (SPEC28's withdrawn slot, reused; nativeMenu shim) open two docs → the spec lists both,
   MRU-first, and survives a reload via `recent.json`;
   `clickRecent` reopens the older doc (and bumps it to front); deleting
   a listed file then clicking it shows the notice and drops the entry;
   `clearRecent` empties the submenu.
4. No existing test may be modified, weakened, skipped, or deleted
   (menu-spec fixture gains the required field, compile-level only);
   E42–E44 stay reserved.

## 5. Docs

ARCHITECTURE.md: a short paragraph next to reading positions (store,
menu nesting, the recent dispatch channel). README: one line under
Creature comforts.

## 6. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U57, E1–E41 +
   E45–E88, W1–W10 — and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` empty; no dependency or version-file changes;
   no `.skip/.only/.todo`; reserved-name scan prints nothing.
