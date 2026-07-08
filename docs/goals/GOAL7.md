# Launching the Marky Mark v7 build with /goal

Run from `marky-mark/`.

```
/goal Implement SPEC7.md in full (delta on SPEC.md–SPEC6.md; SPEC7 wins on conflict, no regressions; do NOT implement split-pane scroll sync, editor extras like find/replace, or remappable undo/redo keys). Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U15, desktop e2e E1–E41, web e2e W1–W4, the single-file check, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' (macOS) exits 0 with the 'Marky Mark.app' path and size (< 25 MB) printed, AND the Windows NSIS cross-build ('npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis') exits 0 with the installer path and size printed (or BLOCKERS.md documents an honest new failure), AND 'ls dist-web/' shows exactly index.html with its size printed, AND 'grep -rn ".skip\|.only\|.todo" tests/' prints nothing, AND 'git diff --stat SPEC.md SPEC2.md SPEC3.md SPEC4.md SPEC5.md SPEC6.md SPEC7.md' is empty, AND ARCHITECTURE.md documents the fixed-size settings dialog, the comments master switch, type-to-comment, the resolved-ghost settings move and new default, the split-edit layout, and editor-history survival across mode toggles. Constraints: the seven SPEC files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted test changes are those enumerated in SPEC7 §7 (new E35–E41 and U15, U13's showResolved default flipping to true, explicit showResolved:false setup steps in E9-style tests with assertions unchanged, and E33 re-driven through Settings with assertions unchanged); disabling comments must never modify or delete stored comments; all existing behavior must be intact with splitEdit off; comment sidecar/trailer formats must not change. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

After it goes green, manual checks: flip through the three settings tabs — the dialog
must not budge; disable comments and confirm the doc reads clean, re-enable and they
return; select a sentence and just start typing — the composer opens mid-word; resolve
a comment and check the ghost is faint-but-findable; turn on side-by-side edit, drag
the divider around, double-click it; type a paragraph, ⌘Z it away, toggle preview and
back, ⌘Z again.
