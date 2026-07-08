# Launching the Markimark v3 build with /goal

Run from `marky-mark/`. Everything (Rust, cargo-xwin, nsis/llvm, Playwright) is
already installed from v1/v2.

## Interactive (paste into a Claude Code session)

```
/goal Implement SPEC3.md in full (delta on SPEC.md + SPEC2.md; SPEC3 wins on conflict, no regressions). Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U13, desktop e2e E1–E24, web e2e W1–W4, the single-file check, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' (macOS) exits 0 with the .app path and size (< 25 MB) printed, AND the Windows NSIS cross-build ('npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis') exits 0 with the installer path and size printed (or BLOCKERS.md documents an honest new failure), AND 'ls dist-web/' shows exactly index.html with its size printed, AND 'grep -rn ".skip\|.only\|.todo" tests/' prints nothing, AND 'git diff --stat SPEC.md SPEC2.md SPEC3.md' is empty, AND ARCHITECTURE.md documents the appearance settings, vim navigation, Save As flow, and the new Claude theme. Constraints: SPEC.md, SPEC2.md, SPEC3.md, and this condition must not be modified; tests must contain real assertions and may not be weakened, stubbed, or deleted — the only sanctioned rewrite is E13 (menu now has exactly Open…/Save/Save As…/Settings…); the new Claude theme must use the §7 pinned values from the user's Typora theme, not invented ones; no mouse-wheel zoom, no word count, no Get Themes. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

## Notes

- The Typora source theme (`~/Library/Application Support/abnerworks.Typora/themes/claude.css`)
  was already mined into SPEC3 §7's pinned value table — the build doesn't need to read
  it (and must not bundle its fonts).
- After it goes green, manual checks: toggle macOS dark mode with "Use separate theme
  in dark mode" on; try `gg`/`G`/`j`/`k` with vim navigation enabled; Open Theme Folder
  should reveal the themes directory in Finder.
