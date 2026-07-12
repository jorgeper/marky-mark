# SPEC21: Marky Mark v21 — New File (⌘N)

Delta spec on top of SPEC.md–SPEC20.md as implemented (all green: U1–U46,
E1–E41 + E45–E77, W1–W8; SPEC8 still pending, E42–E44 reserved). This file
wins on conflict; nothing may regress. §6 is the goal condition.

**What ships:** **File → New…** (`⌘N` / `Ctrl+N`, rebindable) creates a
markdown file. The flow is **save-dialog-first**: the OS save dialog opens
suggesting `Untitled.md`; picking a location writes an empty file and opens
it **in edit mode**. Cancel does nothing. The empty-state splash gains a
matching hint line. No untitled/in-memory-buffer state — every open
document keeps a real path, so Save, Export, Print, watcher, and sidecar
behavior are untouched.

Out of scope: untitled buffers (deliberately rejected — the whole app is
docPath-centric), templates/front-matter for new files, "New Window",
remembering the last new-file directory beyond what the OS dialog does.

---

## 1. Command & flow (FR-N)

1. `CommandId` gains **`newFile`**. Dispatch paths: native menu (§3),
   in-app hotkey listener (§2), web hamburger (§3.3). With no
   `saveFileDialog` on the platform the command is a silent no-op
   (matches the `exportDoc` gating style; today all three platforms
   implement it).
2. Handler `newViaDialog`: `saveFileDialog('Untitled.md')` (markdown
   filter). `null` (cancel) ⇒ no-op. Otherwise: `writeTextFile(path, '')`
   (no `commitFile` — on web that would download an empty file; the first
   real Save commits), then route through **the standard unsaved-changes
   guard** (`openDocGuarded`) — a dirty buffer still gets the three-way
   prompt before the new file opens. Overwrite of an existing file is the
   OS dialog's own Replace? confirmation; the write truncates it.
3. **Edit-mode entry:** the new-file path marks a pending-edit intent
   (ref) that `openDoc` consumes at the end — the freshly created document
   lands in **edit mode** instead of the default preview, including when
   it opens via the dirty prompt's Save / Don't-save buttons. Cancelling
   the prompt clears the intent (a later unrelated open must land in
   preview as always). All other `openDoc` callers are unaffected.

## 2. Hotkey (FR-K)

1. `HotkeyMap` gains **`newFile`**, default **`Mod+N`**. The settings
   sanitizer already merges by `DEFAULT_HOTKEYS` keys, so old
   `settings.json` files parse to the default; overrides round-trip.
2. Settings → Hotkeys gains the row (label **"New file"**) via
   `HOTKEY_LABELS`; conflict detection needs no new code.
3. The in-app hotkey listener dispatches `newFile` like its siblings
   (`preventDefault`, `'hotkey'` source, cross-source dedup unchanged).

## 3. Menus & splash (FR-M)

1. Both OS layouts: File submenu starts **`New…`** (accelerator
   `s.hotkeys.newFile`) then `Open…`, separator, rest unchanged.
2. **Splash:** the empty-state hint gains a third line — `— or
   <kbd>⌘N</kbd> to create one` — rendered with `displayCombo` of the
   *bound* combo, exactly like the ⌘O line above it.
3. **Web hamburger:** `New…` above `Open…` (`menu-new` test id, combo
   caption like `menu-open`). Web's `saveFileDialog` fallback creates a
   handle-less virtual doc whose first Save triggers the download —
   acceptable; no web-specific code.

## 4. Platforms

No `Platform` interface changes; no Tauri capability changes; no Rust
changes. The shim's existing `saveFileDialog` test hook drives e2e.

## 5. Tests (added: U47–U48, E78–E79, W9)

1. **U47** — menu spec: on both layouts File starts with `newFile`
   ("New…") carrying the accelerator from `state.hotkeys.newFile`,
   followed by `open`.
2. **U48** — hotkeys/settings: `DEFAULT_HOTKEYS.newFile === 'Mod+N'`;
   parsing a stored settings object *without* the key yields the default;
   a stored override (e.g. `"Mod+Shift+N"`) survives the parse.
3. **E78** — splash + create flow: splash shows the ⌘N hint; arm the shim
   save-dialog hook, press `Mod+N` → the file exists in the virtual fs
   with empty content, the window title carries its basename, and the app
   is in **edit mode**; a `null` (cancelled) dialog changes nothing.
4. **E79** — dirty guard: with unsaved edits, `Mod+N` + armed hook →
   three-way prompt; Cancel keeps the current doc (and a subsequent
   normal open lands in preview); rerun with Don't-save → the new file
   opens in edit mode.
5. **W9** — web: hamburger shows `menu-new`; invoking it creates and
   opens an empty doc in edit mode.
6. **Amended, not weakened:** U19/U20 (their exact File command arrays
   gain `newFile` in first position) and E13 (the hamburger's exact
   button count becomes seven, `menu-new` included). No other existing
   test may be modified, weakened, skipped, or deleted; E42–E44 stay
   reserved.

## 6. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U48, E1–E41 +
   E45–E79, W1–W9 — and `VALIDATION: ALL PASSED` printed.
2. Windows-reserved-name scan (standard command) prints nothing.
3. `git diff src-tauri/` is empty; `grep -rEn '\.(skip|only|todo)\('
   tests/` prints nothing.
4. README's shortcuts/features mention New File if a shortcut table
   exists; version files untouched.
