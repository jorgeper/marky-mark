# SPEC4: Markimark v4 — vanishing toolbar, tabbed settings, text-only zoom, clean start

Delta spec on top of SPEC.md + SPEC2.md + SPEC3.md (all shipped: U1–U13, E1–E24,
W1–W4 green). Where this conflicts with earlier specs, this wins; nothing else may
regress. Written for autonomous `/goal` execution; read all four specs first. §9 is
the goal condition.

---

## 1. What v4 adds

1. **Auto-hiding toolbar** with a faint bottom shadow — slides up and away after
   launch; reappears when the mouse enters the top of the window, hides when it
   leaves. Clean-by-default UI.
2. **Tabbed settings**: left-side tabs — Appearance / General / Hotkeys — instead of
   one long scroll.
3. **Zoom applies to the document text only**, never the app UI.
4. **Clean start**: no auto-opened welcome file — an empty screen with a centered
   drag-a-file hint. A **Help** item in the menu opens the welcome/help document.
5. **Unsaved-changes guard when opening** another file (currently only close is
   guarded).
6. **"Super narrow" margins** preset, and all seven built-in themes default to
   narrow-margin (wide-text) columns.

## 2. Auto-hiding toolbar (FR-H)

1. On launch the toolbar is visible, then after ~2.5 s (`TOOLBAR_GRACE_MS` constant)
   it slides **upward** out of view (CSS `transform: translateY(-100%)` transition,
   ~180 ms ease). It must not reflow the document: the toolbar becomes an overlay
   (absolute, top) above the workspace, which now occupies the full window height.
2. A permanent, invisible **hot zone** (`data-testid="toolbar-hotzone"`, full-width,
   ~20 px tall, top of the window, above content) reveals the toolbar on
   `mouseenter`/`mousemove`. Moving the mouse out of the toolbar+hotzone region hides
   it again after ~400 ms (`TOOLBAR_HIDE_DELAY_MS`).
3. The toolbar stays pinned visible while: the app menu popover is open, any modal
   (settings / close / open-guard prompt) is open, or keyboard focus is inside the
   toolbar. Hiding resumes when those end.
4. **Faint bottom shadow**: the toolbar gets a subtle downward box-shadow (e.g.
   `0 2px 10px rgba(0,0,0,0.08)` — tint may adapt per theme via a `--mm-toolbar-shadow`
   variable with that default). Visible whenever the toolbar is shown.
5. The toolbar element exposes its state (`data-visible="true|false"` or a class) so
   tests can assert it deterministically.

## 3. Tabbed settings (FR-T)

1. The settings modal becomes a two-column layout: a narrow **left tab rail** with
   exactly three tabs — **Appearance**, **General**, **Hotkeys**
   (`data-testid="settings-tab-appearance|general|hotkeys"`) — and the active tab's
   content on the right. Modal height shrinks (max ~70vh) since no tab needs much
   scrolling.
2. Content mapping: **Appearance** = font size, zoom, light/dark themes +
   separate-dark checkbox, Reload/Open Theme Folder/Import theme, text margins.
   **General** = Editor (line numbers, autosave-on-toggle), Comments (author,
   storage), Navigation (vim). **Hotkeys** = the recorders + reset.
3. Appearance is the default tab. Inactive tabs' content is not interactable
   (unmounted or `display:none`).
4. All existing controls keep their `data-testid`s and behavior.

## 4. Text-only zoom (FR-Z)

1. Zoom must scale **only the document text** (preview `.doc` and the edit-mode
   buffer), not the toolbar, settings, dialogs, or the comments panel.
2. Reimplement zoom as a **font-size multiplier** instead of CSS `zoom` on the app
   root: expose `--mm-zoom` (e.g. `1.5` at 150%) on the root; the document and editor
   font sizes become `calc(<base> * var(--mm-zoom, 1))`. The content column width
   (`--mm-content-width`, rem-based) intentionally does NOT scale — only text.
3. Remove the now-dead CSS-zoom plumbing: the zoom-factor division in the
   add-comment-button placement and the margin-card alignment (positions are back in
   plain viewport px).
4. Settings UI copy stays the same (percent select + Reset to Default).

## 5. Clean start + Help (FR-C)

1. On launch with no file argument, do **not** open welcome.md. Show an empty
   workspace with a centered, muted hint (`data-testid="empty-hint"`):
   "Drag a markdown file here — or press ⌘O to open one" (Ctrl on non-mac, via the
   existing `displayCombo`; reflect the user's actual openFile hotkey).
2. The overflow menu gains **Help** (`data-testid="menu-help"`, listed after
   Save As…, before Settings…; the menu now has exactly **5** items). Help opens the
   welcome document exactly like opening any file: it ensures
   `<welcomeDocPath>` exists (seeding the bundled fixture if missing, reusing the
   existing file otherwise) and routes through the normal open path — including the
   new unsaved-changes guard (FR-G). Opening via double-click/CLI/drag-drop is
   unchanged.
3. The docname area shows "Markimark" and no dirty dot in the empty state; Save /
   Save As are no-ops with no document open.

## 6. Unsaved-changes guard on open (FR-G)

1. Every user-initiated document open — Open… dialog, Help, drag-and-drop, and
   file-association/CLI events arriving while running — routes through one guard: if
   the current buffer is dirty, show the existing three-way modal pattern
   (`data-testid="open-prompt"`, buttons `open-cancel` / `open-discard` /
   `open-save`): Cancel keeps the current document and state; Don't save opens the
   new file discarding edits; Save saves first, then opens.
2. No prompt when the buffer is clean, when "reopening" the same path, or for
   watcher-driven reloads (those already respect dirty state).

## 7. Margins + theme widths (FR-M)

1. Add a fourth preset: **`super-narrow`** — "Super narrow margins (max text)" —
   mapping to `--mm-content-width: 76rem` (wider text than `narrow`'s 60rem).
   Settings order: Theme default, Super narrow, Narrow, Medium, Wide.
2. All **seven built-in themes** change their `--mm-content-width` to **`60rem`**
   (the narrow-margin column) — including Claude (its 752px Typora column is
   superseded by this product decision; everything else about Claude stays).
3. `parseSettings` accepts `'super-narrow'`; U13 is **extended** (not weakened) to
   cover it.

## 8. Validation harness (extends v3)

Same `npm run validate` pipeline. Test changes:

**Sanctioned rewrites** (behavior changed by this spec; assertions must stay equally
strong):
- **E1** → launch shows the empty state (`empty-hint` visible, no `.doc` content,
  docname "Markimark"); then menu → Help renders the welcome doc with the original
  heading/code-block/table assertions.
- **E20** → zoom 150% sets `.doc` computed font-size to `24px` (16 × 1.5) while the
  settings modal's computed font-size is **unchanged** (UI not zoomed); Reset restores
  `16px`. (The old CSS-`zoom` property assertions are replaced.)
- **E24** → the Claude max-width assertion becomes `960px` (60rem); every other
  Claude assertion (paper color, serif stack, 22px h1) is unchanged.

**Sanctioned mechanical updates** (NO assertion changes — required by the new chrome):
- `freshApp()` (and the web beforeEach) now asserts the empty state and opens the
  welcome doc via menu → Help before the per-test assertions.
- A `revealToolbar(page)` helper (mouse to the hot zone, wait for
  `data-visible="true"`) is inserted before existing toolbar clicks (menu, docname).
- `openSettings(page, tab?)` clicks the needed settings tab (default Appearance);
  existing tests add only the tab argument required to reach their control.

**New tests**:
- **E25** (toolbar): visible at launch → auto-hides within ~5 s
  (`data-visible="false"`, computed transform moves it out); mouse into the hot zone
  → visible again, with a non-`none` computed `box-shadow`; mouse to the middle of
  the page → hidden again; while the app menu is open it does NOT hide.
- **E26** (tabs): settings shows exactly 3 tabs; Appearance is active by default and
  shows `fontsize-auto` but not `comment-storage`; switching to General shows
  `comment-storage` and `settings-vimnav` but not `zoom-select`; Hotkeys shows
  `hotkey-toggleEdit`; controls operated through their tabs still work (change one
  thing per tab and verify effect/persistence).
- **E27** (open guard): edit the buffer (dirty) → menu → Help → `open-prompt`
  appears; Cancel keeps the dirty doc (dirty dot still on, same docname); Help again
  → Don't save → welcome opens and the edit is gone from disk; then dirty the welcome
  buffer → Help → Save → the file on disk contains the edit and welcome (re)opens
  clean. Also: with a clean buffer, Help opens with NO prompt.
- **U13 extended**: `'super-narrow'` parses; margins map includes it.
- **E22 extended** (additive): `super-narrow` yields `.doc` max-width `1216px`
  (76rem); the default (theme) column for Crisp is now `960px`.

Web suite: W1–W4 keep their assertions; beforeEach/W1 adapt to the empty start via
the same helper pattern (W2/W4's drag-drop flows start from the empty state, which
is exactly what the empty state is for).

**Anti-gaming constraints (binding)**: as always — nothing skipped/stubbed/weakened,
no hardcoded outputs, blockers to BLOCKERS.md, all four SPEC files and the goal
condition unmodified. Only the rewrites/updates enumerated above may touch existing
tests.

## 9. Definition of Done (the /goal condition verifies exactly this)

All demonstrated in the transcript, in the completion turn:
1. `npm run validate` exits 0 with complete output — **U1–U13, E1–E27, W1–W4**, the
   single-file check, and final `VALIDATION: ALL PASSED` — printed.
2. `npm run tauri build` (macOS) exits 0 with `.app` path + size (< 25 MB) printed;
   the Windows NSIS cross-build exits 0 with installer path + size printed (or
   BLOCKERS.md documents an honest new failure).
3. `ls dist-web/` shows exactly `index.html`, size printed.
4. `grep -rn "\.skip\|\.only\|\.todo" tests/` prints nothing;
   `git diff --stat SPEC.md SPEC2.md SPEC3.md SPEC4.md` empty.
5. `ARCHITECTURE.md` updated: auto-hiding toolbar, tabbed settings, text-only zoom
   (and why CSS zoom was dropped), clean start + Help, the open guard, and the
   margins/theme-width change.

## 10. Build order

1. Margins preset + theme widths + U13/E22/E24 updates (smallest risk first).
2. Text-only zoom rework (E20 rewrite; strip zoom compensation).
3. Clean start + Help + open guard (E1 rewrite, E27, helper updates).
4. Tabbed settings (E26 + tab-argument updates).
5. Auto-hiding toolbar + shadow (E25 + revealToolbar updates) — last, since it
   touches every toolbar interaction.
6. Full validate; mac + Windows builds; ARCHITECTURE.md; DoD evidence.
