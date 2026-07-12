# SPEC22: Marky Mark v22 — New File v2: the untitled buffer

Delta spec on top of SPEC.md–SPEC21.md as implemented (all green: U1–U48,
E1–E41 + E45–E79, W1–W9; SPEC8 still pending, E42–E44 reserved). This file
wins on conflict — in particular it **supersedes SPEC21 §1 (the
save-dialog-first flow)**; SPEC21's menu/hotkey/splash surface stays.
§6 is the goal condition.

**What ships:** File → **New** (`⌘N`, rebindable, unchanged binding) no
longer asks for a location up front. It opens a **blank unsaved buffer**
in edit mode — no dialog, nothing on disk. The document is **Untitled**
(window title, toolbar name); the first **Save** (⌘S or menu) runs the
Save As… dialog suggesting `Untitled.md`, writes the buffer there, and
the app switches to the real file exactly as Save As… always did.
Menu label drops the ellipsis (`New…` → **`New`**) — it no longer asks
for input (HIG).

Out of scope: autosave/recovery of untitled buffers across restarts,
multiple untitled buffers, Export/Print/images for untitled documents
(they keep their existing docPath guards and notices).

---

## 1. The untitled state (FR-U)

1. App state gains **`untitled: boolean`** (with `docPath === null`).
   Entering it (`newFile` command): reset buffer/savedText to `''`,
   comments `[]`, fresh undo history, no watcher, **edit mode**, diff
   off. Nothing is written to disk and no dialog opens.
2. **Dirty guard:** `newFile` with a dirty buffer shows the standard
   three-way prompt first (Save / Don't save / Cancel). The pending
   intent may now be *a path to open* **or** *start a new file* — same
   modal, message reads "…before starting a new file?".
3. Identity: toolbar shows **Untitled** (no path tooltip); window title
   **`Untitled — Marky Mark`** (+ ` •` when dirty). The splash renders
   only when there is neither a docPath nor an untitled buffer.
4. Preview works (⌘E toggles as usual): the buffer renders normally;
   relative image srcs stay inert (no doc dir — existing guard).
   The word-count chip works for untitled buffers.

## 2. Saving (FR-S)

1. `saveDocAs` no longer requires a docPath: with an untitled buffer it
   suggests **`Untitled.md`**; on success it opens the target (existing
   behavior) which clears `untitled`. It returns **`boolean`** — false
   on cancel/unsupported.
2. `saveDoc` returns `boolean` and **redirects untitled saves to
   `saveDocAs`** (⌘S on an untitled buffer = Save As…).
3. **Prompt integrity (no data loss):** both unsaved-changes prompts'
   Save buttons abort their pending action when the save reports false
   (user cancelled the Save As dialog): the open/new/close does NOT
   proceed; the buffer stays.
4. Autosave-on-toggle **skips untitled buffers** (a surprise dialog
   mid-toggle is wrong); the buffer just stays dirty.
5. Comment autosave keeps its docPath guard; comments made in an
   untitled buffer travel with the first Save As (existing saveDocAs
   contract).

## 3. Surface (FR-M)

1. Menu item label: **`New`** (both native layouts and the web
   hamburger `menu-new`); accelerator/hotkey/settings row unchanged
   from SPEC21.
2. Splash line unchanged ("— or ⌘N to create one" — still true).
3. SPEC21's `pendingEditModeRef` mechanism is **removed** (nothing
   creates-then-opens anymore); `openDoc` always lands in preview and
   clears `untitled`.

## 4. Platforms

No `Platform` interface changes, no Tauri/Rust changes. Web's first
Save of an untitled buffer follows the normal web Save As path
(FSAA picker, or handle-less download fallback).

## 5. Tests (revised: U47, E78–E79, W9 — all SPEC21 additions)

1. **U47** — as SPEC21, with label `New` (no ellipsis).
2. **E78** — untitled flow: splash hints; ⌘N → editor visible, name
   Untitled, **no file created, no dialog**; typing → dirty dot; ⌘S
   with a cancelled save dialog keeps the dirty untitled buffer; ⌘S
   with an armed path writes the typed content there and switches to
   the file (clean).
3. **E79** — guards: dirty doc + ⌘N → three-way prompt (Cancel keeps
   it; Don't save → fresh untitled buffer); dirty *untitled* + open →
   prompt; Save with an armed path writes the buffer to that path and
   then opens the requested document.
4. **W9** — web: `menu-new` → untitled buffer; type; Save → download
   named `Untitled.md` carrying the typed content; app switches to it.
5. **Amended:** E13's hamburger label expectation (`New`), U19/U20
   unchanged from SPEC21. No other existing test may be modified,
   weakened, skipped, or deleted; E42–E44 stay reserved.

## 6. Definition of Done

1. `npm run validate` exits 0 — U1–U48, E1–E41 + E45–E79, W1–W9 —
   `VALIDATION: ALL PASSED` printed.
2. Windows-reserved-name scan prints nothing; `git diff src-tauri/`
   empty; no `.skip/.only/.todo` in tests/.
3. README's New File sentence describes the untitled-buffer flow.
