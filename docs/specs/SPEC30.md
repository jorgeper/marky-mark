# SPEC30: Marky Mark v30 — Find, reopen-on-launch, crash-safe drafts

Delta spec on top of SPEC.md–SPEC29.md as implemented (all green: U1–U57,
E1–E41 + E45–E88, W1–W10; SPEC8 still pending, E42–E44 reserved; SPEC28
withdrawn). This file wins on conflict; nothing may regress. §7 is the
goal condition.

**What ships — three MVP pillars:**
1. **Find (⌘F):** one find bar for both modes — live highlighted matches
   with a count in preview; find **and replace** in the editor.
2. **Reopen on launch:** the app starts where you left off — the most
   recent document reopens at boot (setting, default on).
3. **Crash-safe drafts:** dirty buffers shadow-save to the config dir;
   after a crash the next launch offers to restore them.

Out of scope: regex/whole-word/case-sensitive find options (literal,
case-insensitive only), find across files, replace in preview (read-only
surface), multiple drafts (one, the most recent dirty buffer), draft
encryption, session restore beyond the single last document.

---

## 1. Find (FR-FIND)

1. New command **`find`**; `HotkeyMap` gains **`find`**, default
   **`Mod+F`** (rebindable; Settings → Hotkeys row "Find"). **Edit →
   Find…** on both OS layouts, first app command after the predefined
   block (before Insert Image…). The web hamburger is untouched (E13).
2. **The bar** (component `FindBar`, test ids `find-bar`, `find-input`,
   `find-count`, `find-prev`, `find-next`, `find-close`): floats top-
   right of the workspace in preview and edit alike; opens focused,
   prefilled from the current selection when one exists (≤ 200 chars);
   Enter = next, Shift+Enter = previous, Esc closes. Matching is
   **literal and case-insensitive**, live (debounced ≤ 200 ms). Count
   reads "3 of 17" ("No matches" when none, empty query shows neither).
3. **Preview:** matches are computed over the rendered doc text
   (`getDocText` space) and wrapped via the existing `highlightRange`
   machinery restyled as `mm-find` marks (`mm-find-active` on the
   current one; never `hl`/`data-cid` — the comment machinery must not
   see them; unwrap + normalize on close/re-query, document text
   unchanged). Next/prev cycles (wraps around) and centers the active
   match. Comment highlights coexist (nesting is fine).
4. **Edit mode:** the same bar drives CodeMirror through
   **`@codemirror/search`** (the **only** permitted new dependency):
   `search()` extension for match decorations, `setSearchQuery` +
   `findNext`/`findPrevious` — CM's own panel/keymap are never enabled
   (one bar, both modes). Edit mode adds a **replace row**
   (`find-replace-input`, `find-replace-one`, `find-replace-all`):
   replace-one advances to the next match; replace-all reports the
   count via the existing notice. Replaces ride the normal dirty/undo
   path. In split edit the bar drives the editor (source of truth).
5. Switching documents closes the bar and clears highlights; toggling
   modes keeps the query and re-applies in the new surface.

## 2. Reopen on launch (FR-REOPEN)

1. New setting **`reopenLastDoc: boolean`, default `true`** (house
   parse rules; Settings → General checkbox `settings-reopen`, label
   "Reopen last document on launch").
2. Boot order: **explicit opens always win** — a file-association/CLI
   open, an `#open=` hash, or a review-bundle boot suppresses reopen.
   Otherwise, with the setting on and the recents list (SPEC29)
   non-empty, the most recent entry opens through the normal `openDoc`
   (not guarded — the boot buffer is clean). A missing file skips
   silently (the entry stays; SPEC29's click-time cleanup still owns
   removal).
3. Web: the code path is identical, but web document content does not
   survive a reload (memory/handle-scoped), so the attempt fails
   silently into the splash — W1 keeps passing as-is, documented here.

## 3. Crash-safe drafts (FR-DRAFT)

1. Pure module `src/lib/drafts.ts`: `Draft { version: 1, docPath:
   string | null, content: string, at: ISO }` (`docPath: null` =
   untitled), `parseDraft`/`serializeDraft` (corruption ⇒ null), and
   `isStaleDraft(draft, diskContent)` — true when the draft matches the
   disk content (nothing to restore).
2. While the buffer is dirty, a **debounced (≈2 s idle) shadow write**
   lands the draft at `<configDir>/draft.json`. The draft is **deleted**
   when the buffer turns clean (save), when the user explicitly
   discards (the open/new/close prompts' "Don't save"), and after a
   restore decision. Best-effort I/O throughout.
3. Boot (after §2 resolves): a present, parseable, non-stale draft
   raises a modal (`restore-prompt`, buttons `restore-yes` /
   `restore-no`): "Restore unsaved changes to <name>?" — Restore opens
   the draft's document (untitled ⇒ a fresh untitled buffer), installs
   the draft content as the dirty buffer; Discard deletes the file.
   Both paths remove `draft.json`.

## 4. Tests (added: U58–U59, E89–E92, W11; amended: U19, E25, E49, E60)

1. **Amended, not weakened:** U19's Edit-menu command array gains
   `find` before `insertImage`; E25 and E49 asserted the splash after a
   relaunch merely as an idle proxy — they now assert the reopened
   welcome document; E60's manual `#open` after restart becomes the
   assertion that the document reopened **by itself** (the feature
   strengthens the test). No other existing test may be modified,
   weakened, skipped, or deleted; E42–E44 stay reserved.
2. **U58** — drafts: round-trip, corruption ⇒ null, `isStaleDraft`
   true/false cases, untitled (`docPath: null`) round-trip.
3. **U59** — menu/hotkeys/settings: Edit carries Find… on both layouts
   with the rebindable accelerator; `DEFAULT_HOTKEYS.find === 'Mod+F'`;
   `reopenLastDoc` defaults true, explicit false honored, malformed
   falls back, round-trips.
4. **E89** — find in preview: open bar (⌘F and Edit → Find…), live
   count, `mm-find` marks (no `hl`, no `data-cid`), next/prev wraps and
   moves `mm-find-active`, Esc unwraps everything (doc text identical),
   selection prefill, no matches state.
5. **E90** — find/replace in edit + split: same bar, CM decorations
   present, replace-one advances, replace-all reports and rewrites
   (undo restores in one step), query survives a mode toggle, split
   edit drives the editor.
6. **E91** — reopen: open a doc, plain reload ⇒ it reopens (position
   restored per SPEC16); `#open=` hash beats reopen; setting off ⇒
   splash; missing file ⇒ splash, entry retained.
7. **E92** — drafts: dirty a real doc, wait past the debounce, reload ⇒
   restore prompt; Restore ⇒ same doc, dirty, draft content, file gone;
   Discard ⇒ clean doc from disk, file gone; save ⇒ no prompt on next
   boot (stale/removed); dirty untitled buffer round-trips the same
   way.
8. **W11** — web: the find bar works on the welcome doc (count,
   next/prev, marks); a reload still lands on the splash (reopen
   documented-inert on web).

## 5. Docs

README: Find + reopen + drafts join the feature list (Creature comforts
and Edit-mode bullets). ARCHITECTURE.md: a section on the find bar's two
engines (doc-text marks vs @codemirror/search), the boot-order rule
(explicit opens → reopen → draft prompt), and the draft lifecycle.

## 6. Platforms

No Platform interface or Tauri/Rust changes. `@codemirror/search` is the
only dependency change.

## 7. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U59, E1–E41 +
   E45–E92, W1–W11 — and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` empty; the only `package.json` dependency
   change is `@codemirror/search`; no version-file changes; no
   `.skip/.only/.todo`; reserved-name scan prints nothing.
