# SPEC27: Marky Mark v27 — the new icon, everywhere, and a real splash

Delta spec on top of SPEC.md–SPEC26.md as implemented (all green: U1–U55,
E1–E41 + E45–E86, W1–W10; SPEC8 still pending, E42–E44 reserved). This
file wins on conflict; nothing may regress. §5 is the goal condition.

**What ships:** the new Marky Mark artwork (the smiley-M tile in
`icon-assets/`, committed as design source) becomes the app icon on both
OSes and the in-app badge; the empty-state screen becomes a proper
splash — the icon glyph (no tile background) over a wispy orange cloud,
the About-dialog information beneath it, and a single "Drop a file to
open" line. The ⌘O/⌘N hint lines are gone.

Out of scope: Android/iOS icon folders and the Windows Store `Square*`/
`StoreLogo` PNGs (not referenced by `bundle.icon`), a new DMG background,
README screenshots, cutting a release.

---

## 1. App icon (FR-ICON)

1. `src-tauri/icons/` gets the new artwork from `icon-assets/` —
   byte-identical copies: `icon.icns` (macOS), `icon.ico` (Windows),
   `32x32.png`, `128x128.png`, `128x128@2x.png`, and `icon.png` (the
   1024 full-bleed source). `tauri.conf.json` is unchanged (same paths).
   This is the **only** permitted `src-tauri/` change.
2. `icon-assets/` is committed as the design source (no `.DS_Store`).

## 2. In-app badge (FR-BADGE)

`AppBadge` (toolbar filename chip, About dialog) renders the new tile as
an inline SVG — rounded terracotta gradient square + the cream smiley-M
glyph — same test ids (`app-badge`, `about-badge`), same size props, no
image files (the single-file web build stays self-contained). A separate
exported **`MarkGlyph`** renders the glyph alone on a transparent
background (the splash's version).

## 3. The splash (FR-SPLASH)

1. The preview empty state (no document, no untitled buffer) becomes,
   centered, top to bottom (container keeps test id `empty-hint`; new
   inner test id `splash-mark` on the icon block):
   - **`MarkGlyph`** at ~120 px — no tile background — floating on a
     **wispy orange cloud**: pure CSS (layered, blurred radial gradients
     in the brand terracotta), no images, dark-theme friendly.
   - **"Marky Mark"** (title) and the About-dialog information:
     `v{__APP_VERSION__}`, the alpha notice ("Alpha — pre-release
     software, expect rough edges."), "Developer: Jorge Pereira · MIT
     License", and the repo link (managed `openExternal` hand-off, like
     About).
   - **"Drop a file to open"** — the only hint line; the ⌘O/⌘N key-combo
     lines are REMOVED (the commands and hotkeys themselves are
     untouched).
2. Identical on desktop, dev shim, and web (pure app UI).

## 4. Tests (amended: E1, E78; added: E87)

1. **Amended, not weakened:** E1's splash-copy assertion becomes the new
   copy ("Marky Mark", "Drop a file to open"); E78 drops its four
   hint-line assertions (the ⌘O/⌘N lines no longer exist) — its New-flow
   assertions are untouched. No other existing test may be modified,
   weakened, skipped, or deleted; E42–E44 stay reserved.
2. **E87** — pristine launch: `splash-mark` visible inside `empty-hint`;
   the splash shows "Marky Mark", the exact package version, the alpha
   notice, developer + license, and "Drop a file to open"; it contains
   no "⌘O"/"⌘N"/"press" hint text; opening a document removes the splash
   entirely; the toolbar `app-badge` still renders.

## 5. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U55, E1–E41 +
   E45–E87, W1–W10 — and `VALIDATION: ALL PASSED` printed.
2. `cmp src-tauri/icons/icon.icns icon-assets/macos/MarkyMark.icns` and
   `cmp src-tauri/icons/icon.ico icon-assets/windows/MarkyMark.ico` both
   report identical; `git diff src-tauri/` shows only `icons/*` changes;
   `tauri.conf.json` untouched.
3. No dependency or version-file changes; no `.skip/.only/.todo`;
   reserved-name scan prints nothing; no `.DS_Store` committed.
4. `npm run build:app` exits 0 and the built `Marky Mark.app` carries
   the new `icon.icns` (byte-compare inside the bundle).
