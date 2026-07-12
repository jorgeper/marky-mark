# SPEC25: Marky Mark v25 — selection across mode switches; first-class split toggle

Delta spec on top of SPEC.md–SPEC24.md as implemented (all green: U1–U52,
E1–E41 + E45–E83, W1–W10; SPEC8 still pending, E42–E44 reserved). This
file wins on conflict; nothing may regress. §5 is the goal condition.

**What ships:**
1. **Selection survives ⌘E:** toggling edit ↔ preview carries the
   current selection across, in both split and full-screen layouts —
   preview selections land as the exact source selection in the editor;
   editor selections land as a **native** selection of the rendered text
   in preview (no CodeMirror exists there to fight it).
2. **Split edit becomes a first-class toggle:** View → **Split Edit**
   (checkbox) and a rebindable hotkey (default **⌘\\ / Ctrl+\\**), not
   just the Settings checkbox.

Out of scope: preserving selection across document switches or reloads,
multi-range selections (the main selection only), scrolling changes (the
SPEC16 reading-position carry stays the only scroll authority — the
selection was on-screen at toggle time, so the carried position keeps it
near), guaranteeing exactness for selections the SPEC23/24 mappers
already fall back on (tables, cross-block, ambiguity — same fallbacks).

---

## 1. Selection carry, preview → edit (FR-P2E)

1. `toggleMode` (into edit) captures the live preview selection —
   non-collapsed, anchored in the preview doc (full preview `docRef`) —
   before clearing selection UI state: its text plus the covered
   `data-mm-line` bounds, mapped through `mapSelectionToSource`
   (SPEC23). Exact hit ⇒ those source offsets; fallback ⇒ the covering
   source line range.
2. The pending range rides a ref the **Editor consumes at mount**
   (new optional `pendingSelectionRef` prop): applied as the CM
   selection (scrolled into view) after any parked-history restore, so
   it wins over the parked selection; then cleared. No pending range ⇒
   exactly today's behavior. In split edit, applying the selection to
   the focused editor makes the SPEC24 reverse mirror light the split
   preview automatically — no new code path.

## 2. Selection carry, edit → preview (FR-E2P)

1. The app tracks the editor's latest main selection (the SPEC24
   `onEditState` reports, all platforms). `toggleMode` (into preview)
   with a non-collapsed selection parks its source offsets.
2. After the fresh preview html is injected (same freshness guard as
   the SPEC16 scroll restore), the range maps to rendered text —
   `visibleTextForRange` + `findNormalized` within the stamped block
   region (SPEC24 §1.3) — and becomes the **native DOM selection**
   (`offsetsToRange`); fallback selects the covering block region.
   Consumed once; cleared on document switch.

## 3. Split Edit toggle (FR-SPLIT)

1. New command **`toggleSplit`**: flips `settings.splitEdit` (persisted
   as ever). Live in edit mode — the workspace re-renders between split
   and full; the editor's doc/selection/undo survive the remount via
   the existing parked-state mechanism.
2. `HotkeyMap` gains **`toggleSplit`**, default **`Mod+\`** —
   rebindable (Settings → Hotkeys row "Split edit"), merged into old
   settings files by the standard sanitizer, dispatched by the in-app
   hotkey listener like its siblings.
3. **View menu**: checkbox item **"Split Edit"** (accelerator from the
   hotkey, checked = `settings.splitEdit`) right after Edit Mode, both
   OS layouts, always present. `MenuState` gains `splitEdit: boolean`.
4. The web hamburger is untouched (E13's exact-count stays).

## 4. Tests (added: U53, E84–E85)

1. **U53** — menu/hotkeys: View carries `toggleSplit` ("Split Edit")
   directly after `toggleMode` on both layouts, checkbox tracking
   `splitEdit`, accelerator following rebinds;
   `DEFAULT_HOTKEYS.toggleSplit === 'Mod+\\'`; a stored settings file
   without the key parses to the default.
2. **E84** — split toggle: `Mod+\` in edit mode flips split ↔ full live
   with buffer, selection, and undo intact; the setting persists; under
   `?nativeMenu=1` the installed spec carries the checked View item and
   `__mmMenu.click('toggleSplit')` toggles it.
3. **E85** — selection carry: (full preview) select a phrase through
   bold text → ⌘E → the editor selection is the exact source spelling;
   type-over replaces it (it is a real selection); ⌘E back → the
   preview's native selection is the rendered phrase; (split) preview
   selection → ⌘E → editor selection matches and the split preview
   shows the mirror marks; collapsed selections carry nothing.
4. No existing test may be modified, weakened, skipped, or deleted;
   E42–E44 stay reserved.

## 5. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U53, E1–E41 +
   E45–E85, W1–W10 — and `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` empty; no dependency or version-file changes;
   no `.skip/.only/.todo` in tests/; reserved-name scan prints nothing.
3. README's Edit-mode bullet mentions the split toggle hotkey;
   ARCHITECTURE.md notes the selection-carry mechanism.
