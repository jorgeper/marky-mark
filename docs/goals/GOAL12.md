# Launching the Marky Mark v12 build with /goal

Run from `~/src/marky-mark`. Prereq: review and approve
`docs/specs/SPEC12.md` first — the goal implements exactly what it
prescribes.

```
/goal Implement docs/specs/SPEC12.md in full (delta on SPEC.md–SPEC11.md as implemented; SPEC12 wins on conflict, no regressions; SPEC8 stays unimplemented with E42–E44 reserved; out of scope: Linux menus, tray icons, Recent Files, macOS proxy icons, README screenshot refresh). The deliverable is the chromeless desktop window: on macOS and Windows the in-app header/toolbar is replaced by a native menu bar (system menu bar on macOS via the Tauri v2 menu API, in-window menu bar on Windows) laid out per SPEC12 §1, with rebindable-hotkey accelerators that update on rebind, live Edit Mode/Comments checkmarks and comment count, Comments absent when the master switch is off, and Quit/Exit/Close Window routed through the unsaved-changes guard; the header is not rendered at all on desktop (render rule: header iff platform.setAppMenu is undefined) and the window title stays the only filename/dirty display with its existing format; the web build is untouched. Architecture per SPEC12 §3: src/lib/commands.ts named-command registry shared by toolbar and menus, pure src/lib/menuSpec.ts buildMenuSpec with no Tauri imports, optional Platform.setAppMenu implemented in tauri.ts, browser.ts shim recording specs on window.__mmMenu with click(commandId) under ?nativeMenu=1. Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U21, desktop e2e E1–E41 plus E45–E50, web e2e W1–W5, the single-file check, the static bundle scan line, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' (macOS) exits 0 with the app path and size printed, AND grep shows core:menu permissions added to src-tauri/capabilities/default.json while 'git diff src-tauri/tauri.conf.json' shows no CSP change, AND the 'Auto-hide the toolbar' checkbox is absent on desktop but present on web with the autoHideToolbar key still parsing/serializing unchanged, AND ARCHITECTURE.md gains the command-registry/menu-spec section and README the native-menus line, AND 'git diff --stat docs/specs' is empty and 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing. Constraints: the spec files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted test additions are U19–U21 and E47–E50 (all existing tests unchanged); each hotkey combo bound to a menu item must fire exactly once per keypress on desktop; no new runtime dependencies (the menu API ships in the existing @tauri-apps/api); the sidecar/trailer formats, theme format, SPEC11 network-isolation guarantee, and all existing user-visible web behavior are unchanged; the version files stay at their current version. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part)

```bash
cd ~/src/marky-mark
! git push                                # ship the native-menu desktop UI
# optionally cut the next alpha per docs/RELEASING.md
```

Manual checks (the parts automation can't see):

- **macOS**: launch the built app — the system menu bar shows Marky Mark /
  File / Edit / View / Window / Help; `⌘,` opens Settings; the window has no
  in-app header and the document starts at the top; edit a file → `•`
  appears in the title; `⌘Q` with unsaved changes prompts instead of
  quitting; rebind Save in Settings → the File menu shows the new combo and
  the old one stops working; the combo fires once, not twice.
- **Windows** (when you next build there, per WINDOWS.md): in-window menu
  bar with File / Edit / View / Help; Settings and Exit under File; About
  under Help; Exit prompts on unsaved changes.
- **Web**: open the built `dist-web` page — header, hamburger, and the
  auto-hide setting all still there, unchanged.
