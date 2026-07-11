# SPEC13: Marky Mark v13 — native Settings and About windows

Delta spec on top of SPEC.md–SPEC12.md as implemented (all green: U1–U21,
E1–E41 + E45–E50, W1–W5; SPEC8 still pending, E42–E44 reserved). This file
wins on conflict; nothing may regress. §8 is the goal condition.

**What ships:** on desktop (macOS and Windows), **Settings…** (`⌘,` /
`Ctrl+,`) and **About Marky Mark** no longer render as HTML overlays inside
the document window — each opens in its **own native window** (Tauri
`WebviewWindow`), the way a Mac preferences window behaves: separate window
with its own title bar, draggable, closes with `⌘W` or Esc, floats
independently of the document, and re-invoking the menu item focuses the
existing window instead of stacking a second one. The web build keeps its
in-page overlays exactly as today.

Out of scope: AppKit-native controls inside the windows (contents remain the
existing themed HTML views), per-window native menus, a multi-document /
multi-main-window model, Linux, remembering aux-window positions, README
screenshot refresh.

---

## 1. Settings window (FR-SW)

1. On desktop the `settings` command opens a dedicated window, label
   `settings`, title **"Settings"** — never the in-app overlay. Fixed-size
   and content-sized (~620×560 logical px; exact values implementer's
   choice), `resizable: false`, `maximizable: false`, minimizable allowed,
   centered on first open.
2. **Singleton:** if the window is already open, the command focuses it
   (unminimizing if needed). At most one settings window ever exists.
3. Content is the existing `SettingsPanel` — same three tabs (Appearance /
   General / Hotkeys), same controls, same test ids — rendered as a
   standalone page: no scrim, no in-page close button (the window chrome is
   the close affordance). `Esc` and `⌘W`/`Ctrl+W` close the window.
4. The window is themed like the main window: active theme CSS,
   light/dark selection, and font-size variables apply, and re-apply live
   when they change (a theme picked in the Settings window restyles the
   Settings window too).
5. Hotkey capture (Hotkeys tab) records key events in the Settings window
   itself and behaves exactly as the overlay did, including the
   exactly-once accelerator invariant (SPEC12 §1.3) after a rebind.
6. Desktop-only facts carry over: the auto-hide checkbox stays absent
   (SPEC12 §4.1) and comment storage stays unlocked (desktop behavior
   today).

## 2. About window (FR-AW)

1. The `about` command opens a dedicated window, label `about`, title
   **"About Marky Mark"** — small, content-sized (~360×420 logical px),
   `resizable: false`, `maximizable: false`, centered. Same singleton and
   close behavior as §1.2–1.3 (`Esc`, `⌘W`).
2. Content is the existing `AboutDialog` view standalone (icon, name,
   version, links). External links keep routing through
   `platform.openExternal` — executed by the **main** window (§3.4); the
   About window gets no opener capability (§4).

## 3. One owner, dumb views: state sync (FR-X)

1. **The main window remains the sole owner** of settings state,
   persistence (`settings.json`), theme loading, and command handlers —
   unchanged from today. Aux windows are views: they hold no authoritative
   state, never touch the filesystem, and render only what the main window
   sends them.
2. **Handshake:** on load an aux window emits `mm://aux-ready` with its
   kind; the main window replies `mm://aux-init` with everything the view
   needs (settings, themes with CSS, isMac, version/build info for About).
   An aux window renders nothing user-visible until init arrives.
3. **Edits:** the Settings window emits `mm://settings-edit` carrying the
   full next `Settings` object (the exact `onChange(next)` contract the
   overlay used). The main window applies it exactly as it applied overlay
   edits — live apply, persist, native-menu rebuild on hotkey/zoom changes.
4. **Requests:** reload-themes, reveal-themes-folder, and open-external
   dispatch as `mm://aux-request` events; the main window executes them
   (it owns fs/dialog/opener capability).
5. **Canonical echo:** whenever the main window's settings or themes change
   — from the Settings window, the native menu (zoom), or the split-ratio
   drag — it broadcasts `mm://settings-changed` / `mm://themes-changed`
   with the canonical objects, and open aux windows re-render from them.
   Applying a received broadcast must not re-emit (no echo loops), and the
   Settings window always edits on top of the latest canonical state (a
   settings write must never clobber a key the panel doesn't edit, e.g.
   `splitRatio`).
6. **Lifecycle:** aux windows hold no unsaved state and never prompt.
   Closing or quitting the main window closes any open aux windows; the
   unsaved-changes guard (SPEC12 §1.5) is unchanged and lives only on the
   main window.

## 4. Window routing, platform seam, capabilities (FR-A)

1. **`src/lib/windowRole.ts`** (new): pure `windowRole(search)` →
   `'main' | 'settings' | 'about'` from the `?window=` query param
   (absent/unknown → `'main'`). `main.tsx` mounts the full app, the
   standalone Settings view, or the standalone About view accordingly.
2. **`src/platform/types.ts`**: optional
   `openAuxWindow?(kind: 'settings' | 'about'): Promise<void>` plus a
   minimal event-bus seam (`emit`/`listen`) shared by both sides of §3.
   **Render rule (single seam, mirrors SPEC12 §2.3):** the in-page
   settings/about overlays render **iff `openAuxWindow` is undefined**.
   Web never provides it (overlays as today); desktop always does; the dev
   shim provides it only under `?nativeMenu=1`.
3. **`tauri.ts`** implements `openAuxWindow` with `WebviewWindow` (url
   `index.html?window=<kind>`, window options per §1–2) and singleton
   focus; the event bus rides Tauri events. **No new runtime
   dependencies** — windows and events ship in the existing
   `@tauri-apps/api`.
4. **Capabilities:** the `main` capability gains only what window creation
   and event emission need. Aux windows get their **own capability**
   (`settings`, `about`) granting core window/event basics only — **no
   `fs`, no `dialog`, no `opener` identifiers may appear in it**. The
   SPEC11 CSP and network-isolation guarantee are untouched (`git diff
   src-tauri/tauri.conf.json` shows no CSP change).

## 5. Web build & dev shim (FR-W)

1. `kind === 'web'` is untouched: overlays, header, hamburger — all exactly
   as shipped. W1–W5 unchanged.
2. `browser.ts` (dev/e2e shim), under `?nativeMenu=1` only, implements
   `openAuxWindow` via `window.open` on the same origin (carrying
   `?window=<kind>&nativeMenu=1`) and the event bus via `BroadcastChannel`,
   so Playwright drives a **real two-page version of the §3 protocol**. It
   records aux activity on `window.__mmAux` (open/focus counts per kind)
   for singleton assertions. Without the param the shim keeps today's
   overlay behavior so E1–E41 + E45/E46 run unchanged.

## 6. Tests

1. **U22** — `windowRole`: absent → `main`; `settings`/`about` map to
   their roles; unknown values and unrelated params → `main`.
2. **U23** — aux-init payload builder (pure, main-side): carries settings,
   themes, isMac, and version info; desktop facts baked in per §1.6.
3. **U24** — no-clobber rule (§3.5, pure): an edit emitted on top of a
   stale snapshot merged through the latest canonical state preserves keys
   the panel doesn't edit (`splitRatio`), and applying a received
   broadcast marks it non-re-emittable.
4. **E51** (shim, `?nativeMenu=1`) — `settings` opens the aux page, no
   in-page overlay appears; the popup shows the three tabs; toggling line
   numbers in the popup applies live in the main page and persists to
   `/config/settings.json`; zoom changed via the main page's menu shows up
   in the popup's zoom control (canonical echo).
5. **E52** (shim, `?nativeMenu=1`) — rebinding Save in the popup updates
   the main page's installed menu-spec accelerator; the new combo saves,
   the old one no longer does, and it fires exactly once.
6. **E53** (shim, `?nativeMenu=1`) — `about` opens its aux page with the
   version visible and Esc closes it; invoking `settings` twice yields one
   open settings page plus a recorded focus (`window.__mmAux`), never two.
7. **Amended, not weakened:** E48 (its settings/about steps) and E49 (its
   panel-driving steps) are minimally adapted to drive the popup page
   instead of the overlay — every existing assertion is preserved against
   the new page handle. No other existing test may be modified, weakened,
   skipped, or deleted; E42–E44 stay reserved for SPEC8.

## 7. Docs

1. ARCHITECTURE.md: short multi-window section — window roles, the
   one-owner/dumb-view event protocol (§3), the render rule (§4.2), and
   why aux windows strengthen the security posture (no fs/dialog/opener
   capability).
2. README: update the native-desktop line to mention Settings and About
   opening as real windows (no screenshot refresh required in v13).

## 8. Definition of Done (the /goal condition verifies exactly this)

1. `npm run validate` exits 0 with complete output — **U1–U24, E1–E41 +
   E45–E53, W1–W5**, the single-file check, the static bundle scan line,
   and `VALIDATION: ALL PASSED` — printed in the transcript.
2. `npm run tauri build` (macOS) exits 0; app path + size printed;
   launching the built app: `⌘,` opens a separate fixed-size Settings
   window per §1, About per §2, both close with `⌘W`/Esc, and no in-app
   overlay renders on desktop.
3. `grep -n 'window' src-tauri/capabilities/*.json` shows the aux-window
   capability with **no** `fs:`/`dialog:`/`opener:` identifiers, and
   `git diff src-tauri/tauri.conf.json` shows no CSP change.
4. `git diff --stat docs/specs/` is empty (SPEC13 lands in its own docs
   commit); `grep -rEn '\.(skip|only|todo)\(' tests/` prints nothing.
5. Web build unchanged in behavior: W1–W5 pass against a fresh
   `npm run build:web`; overlays still render on web.
6. ARCHITECTURE.md and README updated per §7; version files untouched.
