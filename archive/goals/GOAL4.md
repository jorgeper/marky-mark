# Launching the Markimark v4 build with /goal

Run from `marky-mark/`. All toolchains are already installed.

## Interactive (paste into a Claude Code session)

```
/goal Implement SPEC4.md in full (delta on SPEC.md + SPEC2.md + SPEC3.md; SPEC4 wins on conflict, no regressions). Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U13, desktop e2e E1–E27, web e2e W1–W4, the single-file check, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' (macOS) exits 0 with the .app path and size (< 25 MB) printed, AND the Windows NSIS cross-build ('npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis') exits 0 with the installer path and size printed (or BLOCKERS.md documents an honest new failure), AND 'ls dist-web/' shows exactly index.html with its size printed, AND 'grep -rn ".skip\|.only\|.todo" tests/' prints nothing, AND 'git diff --stat SPEC.md SPEC2.md SPEC3.md SPEC4.md' is empty, AND ARCHITECTURE.md documents the auto-hiding toolbar, tabbed settings, text-only zoom, clean start with Help, the unsaved-changes open guard, and the margins/theme-width change. Constraints: the four SPEC files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted test changes are those enumerated in SPEC4 §8 (rewrites of E1/E20/E24 with equally strong assertions, the mechanical freshApp/revealToolbar/openSettings-tab updates with no assertion changes, additive extensions of U13/E22, and new E25–E27); the toolbar must stay pinned while menus or modals are open; zoom must not affect any UI outside the document text. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

## Notes

- The auto-hide timings live in named constants (`TOOLBAR_GRACE_MS` ≈ 2500,
  `TOOLBAR_HIDE_DELAY_MS` ≈ 400) so E25 can wait on real behavior without magic
  numbers scattered in tests.
- After it goes green, manual checks: launch → bar slides away after ~2.5 s → mouse
  to the top edge brings it back with the shadow; drag a file onto the empty start
  screen; dirty a file then hit Help to see the save/discard/cancel prompt; zoom to
  150% and confirm the settings dialog stays its normal size.
