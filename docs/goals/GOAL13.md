# Launching the Marky Mark v13 build with /goal

Run from `~/src/marky-mark`. Prereq: review and approve
`docs/specs/SPEC13.md` first — the goal implements exactly what it
prescribes.

```
/goal Implement docs/specs/SPEC13.md in full (delta on SPEC.md–SPEC12.md as implemented; SPEC13 wins on conflict, no regressions; SPEC8 stays unimplemented with E42–E44 reserved; out of scope: AppKit-native controls, per-window native menus, multi-document windows, Linux, remembered aux-window positions, README screenshot refresh). The deliverable is native Settings and About windows on desktop: Settings… (⌘,/Ctrl+,) opens a dedicated fixed-size non-resizable Tauri window (label settings, ~620×560, centered, singleton — reinvoking focuses it) holding the existing SettingsPanel tabs standalone with no scrim or in-page close button, themed like the main window and re-themed live, closing on Esc and ⌘W/Ctrl+W; About opens its own small window (label about, ~360×420) the same way; no in-app overlay ever renders on desktop. Architecture per SPEC13 §3–§4: the main window stays sole owner of settings state, persistence, themes, and command handlers — aux windows are dumb views with no filesystem access that handshake via mm://aux-ready → mm://aux-init, send edits as mm://settings-edit (full Settings object), send reload-themes/reveal/open-external as mm://aux-request, and re-render from canonical mm://settings-changed / mm://themes-changed broadcasts with no echo loops and no clobbering of panel-unedited keys like splitRatio; closing/quitting the main window closes aux windows and the unsaved-changes guard is unchanged; new pure src/lib/windowRole.ts routes ?window= to main/settings/about; Platform gains optional openAuxWindow plus an emit/listen event-bus seam with the render rule overlays-iff-openAuxWindow-undefined; tauri.ts implements it with WebviewWindow and Tauri events; browser.ts under ?nativeMenu=1 implements it with window.open + BroadcastChannel recording open/focus counts on window.__mmAux; aux windows get their own capability with core window/event basics only — no fs, dialog, or opener identifiers. Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U24, desktop e2e E1–E41 plus E45–E53, web e2e W1–W5, the single-file check, the static bundle scan line, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' (macOS) exits 0 with the app path and size printed, AND grep of src-tauri/capabilities/*.json shows the aux-window capability contains no fs:/dialog:/opener: identifiers while 'git diff src-tauri/tauri.conf.json' shows no CSP change, AND W1–W5 pass against a fresh 'npm run build:web' with web overlays unchanged, AND ARCHITECTURE.md gains the multi-window section and README's native-desktop line mentions the real Settings/About windows, AND 'git diff --stat docs/specs' is empty and 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing. Constraints: the spec files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted test additions are U22–U24 and E51–E53, and the only permitted amendments are E48's settings/about steps and E49's panel-driving steps minimally redirected at the popup page with every existing assertion preserved (all other existing tests unchanged); hotkey rebinds from the Settings window keep the exactly-once accelerator invariant; no new runtime dependencies (windows and events ship in the existing @tauri-apps/api); the sidecar/trailer formats, theme format, SPEC11 network-isolation guarantee, and all existing user-visible web behavior are unchanged; the version files stay at their current version. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part)

```bash
cd ~/src/marky-mark
! git push                                # ship the native settings/about windows
# optionally cut the next alpha per docs/RELEASING.md
```

Manual checks (the parts automation can't see):

- **macOS**: launch the built app — `⌘,` opens a real separate Settings
  window (own title bar, draggable, fixed size); pick a different theme →
  both the document window and the Settings window restyle instantly;
  `⌘W` closes Settings, `⌘,` again reopens, twice focuses instead of
  stacking; rebind Save there → the File menu accelerator updates and the
  old combo goes dead; About opens its own little window and Esc dismisses
  it; quit with Settings open — no stray window, no prompt from it.
- **Windows** (when you next build there, per WINDOWS.md): File →
  Settings… opens the separate window with `Ctrl+,`/`Ctrl+W` behavior;
  Exit still prompts on unsaved changes.
- **Web**: open the built `dist-web` page — Settings and About are still
  the in-page overlays, unchanged.
