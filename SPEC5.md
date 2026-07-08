# SPEC5: Marky Mark v5 — app badge, opt-in auto-hide, centered hint, rename

Delta spec on top of SPEC.md–SPEC4.md (all green: U1–U13, E1–E27, W1–W4). This file
wins on conflict; nothing else may regress. §6 is the goal condition.

---

## 1. Changes

1. **App badge in the toolbar**: when no document is open, the toolbar's title slot
   shows the app icon — the white "M" on the terracotta rounded square (an inline SVG
   replica of the app icon, `data-testid="app-badge"`, ~20 px) — instead of the word
   "Markimark". With a document open, the filename shows as today (badge optional
   before it, author's choice).
2. **Auto-hide is now a setting, default OFF**: General tab gains "Auto-hide the
   toolbar" (`autoHideToolbar: boolean`, default `false`, `data-testid`
   `settings-autohide`). Off = the bar is always visible and the workspace gets
   top padding equal to the bar height so content never sits underneath it. On =
   exactly the SPEC4 §2 behavior (grace, hot zone, hide delay, pinning), with the
   overlay layout (no workspace padding).
3. **Centered empty hint**: the "Drag a markdown file here…" hint must sit in the
   true center of the window (its bounding-box center within ±40 px of the viewport
   center both axes) — absolutely centered in the workspace, not flow-positioned.
4. **Rename to "Marky Mark"**: every user-facing "Markimark" becomes **"Marky Mark"**
   — window titles (`… — Marky Mark`), `productName` in `tauri.conf.json` (artifacts
   become `Marky Mark.app` / `Marky Mark_…-setup.exe`), the welcome fixture
   (`# Welcome to Marky Mark` etc.), THEMES.md/README.md prose, and the web page
   `<title>`. **Unchanged**: the bundle identifier `com.markimark.app` (changing it
   would orphan existing config/themes dirs — keep it), the npm package name, code
   identifiers, and test ids.

## 2. Settings

`autoHideToolbar` parses with a `false` default (U13 extended, additively). All other
settings and migrations unchanged.

## 3. Sanctioned test changes

- **Global string rename** in fixtures and tests: `Welcome to Markimark` →
  `Welcome to Marky Mark` and other user-facing name assertions — pure string
  substitution, assertions equally strong.
- **E1 rewrite (partial)**: the empty-state check `docname has text "Markimark"`
  becomes `docname contains the app-badge SVG and no "Markimark"/"Marky Mark" text`;
  everything else stays.
- **E25 rewrite (setup only)**: auto-hide is opt-in now, so E25 first enables
  `settings-autohide` (General tab), then runs its existing assertions unchanged.
- New tests below; nothing else may change.

## 4. New tests

- **U13 (extended)**: `autoHideToolbar` defaults to false, parses true.
- **E28**: empty state shows `app-badge` (an `svg`) in the toolbar, no
  "Markimark"/"Marky Mark" text in the docname slot; `document.title` contains
  "Marky Mark" and not "Markimark"; opening a doc shows the filename again.
- **E29**: with default settings, the toolbar is still visible well past the old
  grace+delay window (> 3.5 s, mouse parked mid-screen); enabling
  `settings-autohide` makes it hide (data-visible=false) after the mouse leaves;
  disabling it brings the bar back permanently.
- **E30**: the `empty-hint` bounding-box center is within ±40 px of the viewport
  center on both axes.

## 5. Notes

- With auto-hide off, `.workspace` gets `padding-top: 42px` (bar height) via a
  root-level class (e.g. `.theme-root.toolbar-static`); the editor's internal top
  padding may stay as is.
- The hint text and hotkey display are unchanged from SPEC4 §5.1.

## 6. Definition of Done (the /goal condition verifies exactly this)

1. `npm run validate` exits 0 with complete output — **U1–U13, E1–E30, W1–W4**, the
   single-file check, `VALIDATION: ALL PASSED` — printed in the transcript.
2. macOS `npm run tauri build` exits 0; the produced **`Marky Mark.app`** path + size
   (< 25 MB) printed. Windows NSIS cross-build exits 0 with its installer path + size
   printed (or BLOCKERS.md documents an honest new failure).
3. `ls dist-web/` shows exactly `index.html`, size printed; its `<title>` contains
   "Marky Mark".
4. `grep -rn "\.skip\|\.only\|\.todo" tests/` prints nothing;
   `git diff --stat SPEC.md SPEC2.md SPEC3.md SPEC4.md SPEC5.md` empty;
   `tauri.conf.json` still has `"identifier": "com.markimark.app"`.
5. `ARCHITECTURE.md` notes the rename (and why the identifier stays), the app badge,
   and the auto-hide default flip.
