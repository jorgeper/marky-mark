# SPEC12: Marky Mark v12 — native desktop menus, chromeless desktop window

Delta spec on top of SPEC.md–SPEC11.md as implemented (all green: U1–U18,
E1–E41 + E45 + E46, W1–W5; SPEC8 still pending, E42–E44 reserved). This file
wins on conflict; nothing may regress. §8 is the goal condition.

**What ships:** on desktop (macOS and Windows) the in-app header/toolbar —
filename, Edit/Preview button, comments toggle, hamburger menu — is replaced
by the platform's **native menu bar** (system menu bar on macOS, in-window
menu bar on Windows) and the **window title**. The document starts at the top
edge of the window: zero app chrome. The web build keeps its header exactly
as today.

Out of scope: Linux menus, tray icons, a Recent Files menu, macOS proxy
icons, touch bar, per-window menus beyond the single main window, README
screenshot refresh (appearance changed, but re-shooting is a manual follow-up).

---

## 1. Native menu bar (FR-M)

1. Menus are **native** (Tauri v2 menu API), not DOM. macOS installs an app
   menu bar (`Menu.setAsAppMenu`); Windows shows the classic in-window menu
   bar. Layout:

   **macOS** —
   - **Marky Mark**: About Marky Mark · Settings… `⌘,` · Services · Hide
     `⌘H` / Hide Others `⌥⌘H` / Show All · Quit Marky Mark `⌘Q`
   - **File**: Open… · Save · Save As… `⇧⌘S` · Close Window `⌘W`
   - **Edit**: Undo / Redo / Cut / Copy / Paste / Select All (predefined
     system items, so they work in the editor, comments, and text fields)
   - **View**: Edit Mode (checkbox) · Comments (checkbox, live count —
     "Comments (3)") · Zoom In `⌘+` / Zoom Out `⌘-` / Actual Size `⌘0` ·
     Enter Full Screen (predefined)
   - **Window**: Minimize `⌘M` · Zoom · Bring All to Front (predefined)
   - **Help**: Marky Mark Help

   **Windows** —
   - **File**: Open… · Save · Save As… `Ctrl+Shift+S` · Settings…
     `Ctrl+,` · Exit
   - **Edit**, **View**: as macOS (minus Enter Full Screen)
   - **Help**: Marky Mark Help · About Marky Mark

2. **Accelerators follow the rebindable hotkeys** (SPEC2/SPEC7): Open, Save,
   Edit Mode, and Comments display the user's current combos and update when
   rebound in Settings (menu rebuild). Save As / Settings / Zoom / window
   items use the fixed accelerators above and are not rebindable in v12.
3. **Exactly-once invariant:** a combo bound to a menu item must trigger its
   action exactly once per keypress. On desktop the menu owns its
   accelerators; the in-app keydown listener must not fire a second time for
   the same combo. (Web keeps the DOM listener as sole owner — unchanged.
   The dev shim has no real accelerators, so under `?nativeMenu=1` the DOM
   listener remains the dispatcher — the invariant is exactly-once, not
   menu-only.)
4. Dynamic state mirrors today's toolbar: Edit Mode checked in edit mode;
   Comments checked when the panel shows, its label carrying the open-comment
   count; the Comments item is **absent** when comments are disabled in
   Settings (master switch, SPEC7 §2). Save stays always-enabled (current
   behavior). Zoom items step through the existing `ZOOM_LEVELS` and write
   the same `settings.zoom` the Settings dropdown uses.
5. **No data-loss path:** Quit (macOS), Exit (Windows), and Close Window are
   custom items routed through the same unsaved-changes guard as the
   window's close button (SPEC FR-6 close guard). They must never bypass the
   save/discard/cancel prompt.

## 2. Chromeless desktop window (FR-C)

1. On desktop the `<header class="toolbar">` is **not rendered at all** — no
   auto-hide, no hover reveal, no reserved pixel row. The rendered document
   (or editor) starts at the top of the window content area.
2. The window title remains the filename display and carries the dirty
   marker, format unchanged from today when a document is open:
   `<name> • — Marky Mark` when dirty, `<name> — Marky Mark` when clean.
   With no document the title becomes bare `Marky Mark` (today it
   degenerates to `Marky Mark — Marky Mark`; fix that). This is now the
   *only* filename/dirty indicator on desktop. (macOS MAY
   additionally set the native document-edited dot if the runtime exposes it
   without widening capabilities; the title text is the requirement.)
3. Render rule (single seam): the header renders **iff the platform does not
   provide a native menu** (`platform.setAppMenu` undefined). Desktop
   provides it; web never does; the dev shim provides it only on request
   (§5.2).

## 3. Command registry & menu spec (FR-A)

1. **`src/lib/commands.ts`** (new): a named-command registry — one command
   per user action (`open`, `save`, `saveAs`, `toggleMode`,
   `toggleComments`, `settings`, `help`, `about`, `zoomIn`, `zoomOut`,
   `zoomReset`, `close`). `App.tsx` registers its existing handlers; the DOM
   toolbar (web) and the native menu both dispatch through the registry.
   One source of truth — no duplicated handlers.
2. **`src/lib/menuSpec.ts`** (new): pure
   `buildMenuSpec({ isMac, mode, showComments, commentsEnabled,
   commentCount, hotkeys })` → a plain serializable structure (menus, items,
   command ids, checked flags, accelerator strings, predefined-item markers).
   No Tauri imports; fully unit-testable.
3. **`src/platform/types.ts`**: optional `setAppMenu?(spec): Promise<void>`.
   `tauri.ts` implements it — converts the spec to `@tauri-apps/api/menu`
   objects (predefined items for Edit/Window/Services/Hide/Full Screen),
   maps combo strings to Tauri accelerator syntax, installs as app menu
   (macOS) or window menu (Windows). Item events dispatch into the command
   registry. Rebuilds are driven by App state changes (mode, comment count,
   commentsEnabled, hotkeys) and may be debounced; a rebuild must never drop
   a click.
4. **Capabilities**: `src-tauri/capabilities/default.json` gains only the
   minimal `core:menu` permissions the menu API needs. Nothing else widens;
   the SPEC11 CSP and network-isolation guarantee are untouched (menus are
   local UI — no network surface). **No new runtime dependencies** — the
   menu API ships in the existing `@tauri-apps/api`.

## 4. Settings (FR-S)

1. The **"Auto-hide the toolbar"** checkbox is not rendered on desktop
   (there is no toolbar). It remains on web, where behavior is unchanged.
2. The `autoHideToolbar` key **stays in the settings model** — parse,
   serialize, and defaults identical — so settings files round-trip
   unchanged between web and desktop and old desktop settings still parse.
   Desktop simply ignores it.
3. Settings open from the native menu (macOS `⌘,` app menu; Windows File →
   Settings…). The panel itself is unchanged apart from §4.1.

## 5. Web build & dev shim (FR-W)

1. `kind === 'web'` is untouched: header, hamburger, auto-hide setting and
   behavior, comment storage lock — all exactly as shipped. W1–W5 unchanged.
2. `browser.ts` (dev/e2e shim) keeps today's toolbar by default so E1–E41 +
   E45/E46 run unchanged. With query param **`?nativeMenu=1`** it simulates
   desktop: implements `setAppMenu` by recording the latest installed spec
   on **`window.__mmMenu`** and exposing `window.__mmMenu.click(commandId)`
   to dispatch items through the registry — the e2e seam for §6, since
   Playwright cannot click real native menus.

## 6. Tests (all suites stay green; only these are added)

1. **U19** — `buildMenuSpec` macOS layout: app menu holds About/Settings/
   Quit; File has no Settings or Exit; Window menu present; Help has no
   About; predefined markers where §1 says so.
2. **U20** — `buildMenuSpec` Windows layout: File carries Settings… and
   Exit; Help carries About; no app or Window menu; no Full Screen item.
3. **U21** — `buildMenuSpec` dynamics: Edit Mode / Comments checked flags
   follow state; comment count in the label; Comments item absent when the
   master switch is off; rebinding a hotkey changes exactly that
   accelerator.
4. **E47** (shim, `?nativeMenu=1`) — no header/toolbar in the DOM (no
   `menu-btn`, no `docname`); document content starts at the top; the
   window title carries the filename and gains the dirty marker after an
   edit and loses it after save.
5. **E48** (shim, `?nativeMenu=1`) — `window.__mmMenu` holds the installed
   spec; `click()` on open/save/save-as/settings/about/help/toggle items
   performs the same behavior as the old toolbar path; after toggling mode
   and adding a comment the re-installed spec shows the updated checkmark
   and count.
6. **E49** (shim) — Settings panel: auto-hide checkbox absent under
   `?nativeMenu=1`, present without it (web-style); `autoHideToolbar`
   survives a settings save/load round-trip in both modes.
7. **E50** (shim, `?nativeMenu=1`) — with unsaved changes,
   `window.__mmMenu.click('close')` shows the save/discard/cancel prompt;
   cancel keeps the document; no data loss.
8. E42–E44 stay reserved for SPEC8. No existing test may be modified,
   weakened, skipped, or deleted.

## 7. Docs

1. ARCHITECTURE.md: new short section — command registry, menu-spec seam,
   the header render rule (§2.3), and why menus stay inside the
   network-isolation guarantee.
2. README: one line in the features/UI area noting desktop uses native
   menus and a chromeless window (no screenshot refresh required in v12).

## 8. Definition of Done (the /goal condition verifies exactly this)

1. `npm run validate` exits 0 with complete output — **U1–U21, E1–E41 +
   E45–E50, W1–W5**, the single-file check, the static bundle scan line,
   and `VALIDATION: ALL PASSED` — printed in the transcript.
2. `npm run tauri build` (macOS) exits 0; app path + size printed; launching
   the built app shows the native menu bar per §1 and no in-app header.
3. `grep -n 'core:menu' src-tauri/capabilities/default.json` shows the added
   menu permissions and `git diff src-tauri/tauri.conf.json` shows no CSP
   change.
4. `git diff --stat docs/specs/` is empty (SPEC12 itself lands in its own
   docs commit); `grep -rEn '\.(skip|only|todo)\(' tests/` prints nothing.
5. Web build unchanged in behavior: W1–W5 pass against a fresh
   `npm run build:web`.
6. ARCHITECTURE.md and README updated per §7; version files untouched.
