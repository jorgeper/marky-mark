# SPEC7: Marky Mark v7 — comment controls, split view, undo/redo

Delta spec on top of SPEC.md–SPEC6.md (all green: U1–U14, E1–E34, W1–W4). This file
wins on conflict; nothing else may regress. §9 is the goal condition. Explicitly out
of scope (author's call): scroll sync between split panes, a fully fledged editor
(find/replace, multi-cursor, etc.), remappable undo/redo hotkeys — do NOT build them.

---

## 1. Fixed-size settings dialog (FR-S)

1. The settings modal must render at **the same fixed size on every tab**:
   `width: min(560px, 94vw)`, `height: min(480px, 85vh)`. Switching tabs must not
   change the dialog's box in any dimension.
2. Content taller than the dialog scrolls inside `.tab-content` (already
   `overflow-y: auto`); the rail and dialog chrome stay put.
3. **E35** asserts: open Settings, record the dialog's `boundingBox()` on each of the
   three tabs — all three identical (±1 px).

## 2. Comments master switch (FR-C)

1. New setting **`commentsEnabled: boolean`, default `true`**, in General → Comments
   (`data-testid="set-comments-enabled"`), listed above the other comment settings.
2. When OFF: no comment highlights in preview, no comments panel, no selection →
   floating 💬 button, no type-to-comment (§3), and the toolbar's comment-panel
   toggle is hidden. The document renders as if the file had no comments.
3. Disabling is **non-destructive**: stored comments (sidecar or embedded) are never
   read-modified or deleted by the switch; re-enabling restores everything exactly.
   While OFF, saving an edited document must still preserve existing embedded
   trailers/sidecars untouched (orphan re-anchoring may simply be deferred until
   comments are re-enabled).
4. **E36** asserts: doc with comments → disable → highlights, panel, and toolbar
   toggle gone; select text → no floating button; re-enable → all back, comment
   count unchanged.

## 3. Type-to-comment (FR-T)

1. New setting **`typeToComment: boolean`, default `true`** (General → Comments,
   `data-testid="set-type-to-comment"`).
2. When ON, with a non-collapsed selection in preview mode (the state where the
   floating 💬 button shows): typing a **printable character** (no Cmd/Ctrl/Alt
   modifier; Shift allowed) opens the comment composer exactly as clicking the
   button would, **seeded with that character** and the caret after it.
3. Non-printable keys keep their existing meaning: Escape clears the selection,
   app hotkeys (⌘E, ⌘S, …) and vim-nav keys still work — vim-nav only ever fires
   without a selection, so there is no conflict; if focus is already in an input,
   textarea, or the composer, do nothing.
4. When OFF (or `commentsEnabled` OFF, or not in preview mode), typing changes
   nothing — today's behavior.
5. **E37** asserts: select text, press `x` → composer open containing `x`; submit →
   comment created with the typed prefix. Turn the setting OFF → select, type →
   no composer.

## 4. Show resolved: a settings toggle, fainter ghosts (FR-R)

1. The "Show resolved" toggle **moves from the comments-panel header to Settings**
   (General → Comments, keep `data-testid="show-resolved"`). The panel-header
   toggle is removed. Same persisted key `showResolved`, but the **default flips to
   `true`**.
2. Behavior of both states is unchanged from SPEC6 §3 (ON: ghosted in place; OFF:
   collapsed "Resolved (N)" section) — only the switch's home and default change.
3. Ghosts get **slightly** fainter — this is a nudge, not a redesign:
   `.card.resolved-ghost` opacity 0.55 → **0.40** (hover/active stays 0.85);
   `mark.hl.ghost` tint mix 40% → **25%**.
4. **E38** asserts: resolve a comment with default settings → ghost card visible in
   the flow with computed opacity 0.4 (±0.02) and no toggle in the panel header;
   turning the setting off in Settings collapses it into "Resolved (N)".

## 5. Side-by-side edit (FR-V)

The bigger feature. Full-screen swap stays the default; this adds an opt-in split.

1. New setting **`splitEdit: boolean`, default `false`** (General → Editor,
   `data-testid="set-split-edit"`), plus persisted **`splitRatio: number`, default
   `0.5`** (editor pane's fraction, clamped to **0.2–0.8**; not shown in the dialog).
2. When ON, entering edit mode (⌘E or toolbar) shows **editor left, live preview
   right** instead of the full-screen editor; ⌘E toggles between reading preview
   and this split. When OFF, nothing changes anywhere (all existing E-tests run
   with it off).
3. The right pane renders through the existing sanitized markdown pipeline,
   re-rendered **live as the buffer changes, debounced ≤ 300 ms**. It is a plain
   reading pane: no comment highlights, panel, selection button, or type-to-comment
   there — reading preview remains the comments surface.
4. A **draggable divider** (`data-testid="split-divider"`, ~5 px hit area, col-resize
   cursor) sits between the panes. Dragging resizes both panes live, clamps to
   0.2–0.8, and persists `splitRatio` on release. Double-click resets to 0.5.
5. Save (⌘S), dirty tracking, the close guard, and undo/redo (§6) behave exactly as
   in full-screen edit. The editor keeps its SPEC6 §1 column geometry inside its
   pane (E31 continues to test the full-screen layout only).
6. **E39** asserts: enable split, ⌘E → both panes plus divider visible; type in the
   editor → right pane updates within 1 s; ⌘E returns to reading preview.
   **E40** asserts: drag the divider → pane fraction changes accordingly (±0.05);
   reopen edit mode → ratio persisted; double-click → back to 0.5.

## 6. Undo/redo for edits (FR-U)

1. CodeMirror's `history()`/`historyKeymap` already handle in-session undo (⌘Z /
   Ctrl+Z) and redo (⇧⌘Z / Ctrl+Y / Ctrl+Shift+Z) inside the editor — keep them.
   The actual gap: the editor is unmounted on every mode toggle, destroying
   history. **Edit history must survive preview↔edit toggles** (keep the
   `EditorState` alive across the swap) for as long as the same document stays
   open; opening another file or Start Over resets it.
2. Undo depth: whatever CodeMirror's defaults give — no custom history config, no
   toolbar buttons, no undo of comment actions. Simple is the requirement.
3. **E41** asserts: edit mode → type a word → ⌘Z removes it → ⇧⌘Z restores it;
   then type, toggle to preview, toggle back → ⌘Z still undoes the pre-toggle
   edit.

## 7. Sanctioned test changes

Only:
- New **E35–E41**, **U15** (new unit: `commentsEnabled`, `typeToComment`,
  `splitEdit`, `splitRatio` parse + defaults; malformed values fall back).
- **U13's** `showResolved` default assertion flips to `true` (assertion inverted,
  nothing else).
- **E9** and any test relying on resolved-by-default-collapsed may add an explicit
  `showResolved: false` setup step; their assertions stay unchanged.
- **E33** re-drives its toggle through Settings instead of the removed panel-header
  switch; its ghost/reopen assertions stay unchanged (opacity value per §4.3).

Everything else stays untouched.

## 8. Notes

- New settings parse defensively like every existing field (`parseSettings`
  fallbacks); `splitRatio` must clamp non-finite/out-of-range values to 0.5.
- The divider drag should use pointer capture and update a CSS variable or flex
  basis — no re-render per mousemove of the markdown pane.
- Keeping `EditorState` across toggles must not leak per-document state into the
  next opened file (E41's reset case is implied by "opening another file resets").
- Settings dialog height change must not break E-tests that click controls near
  the bottom of a tab — they scroll within `.tab-content`.

## 9. Definition of Done (the /goal condition verifies exactly this)

1. `npm run validate` exits 0 with complete output — **U1–U15, E1–E41, W1–W4**, the
   single-file check, `VALIDATION: ALL PASSED` — printed in the transcript.
2. macOS build exits 0 with `Marky Mark.app` path + size (< 25 MB) printed; Windows
   NSIS cross-build exits 0 with installer path + size (or BLOCKERS.md documents an
   honest new failure).
3. `ls dist-web/` shows exactly `index.html`, size printed.
4. `grep -rn "\.skip\|\.only\|\.todo" tests/` prints nothing; `git diff --stat
   SPEC*.md` empty.
5. `ARCHITECTURE.md` documents the fixed settings dialog, the comments master
   switch, type-to-comment, the settings-home + new default for resolved ghosts,
   the split-edit layout (divider mechanics, ratio persistence, live render), and
   how editor history survives mode toggles.
