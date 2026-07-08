# Launching the Marky Mark v5 build with /goal

Run from `marky-mark/`.

```
/goal Implement SPEC5.md in full (delta on SPEC.md–SPEC4.md; SPEC5 wins on conflict, no regressions). Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U13, desktop e2e E1–E30, web e2e W1–W4, the single-file check, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' (macOS) exits 0 with the produced 'Marky Mark.app' path and size (< 25 MB) printed, AND the Windows NSIS cross-build ('npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis') exits 0 with the installer path and size printed (or BLOCKERS.md documents an honest new failure), AND 'ls dist-web/' shows exactly index.html with its size printed and its <title> containing 'Marky Mark', AND 'grep -rn ".skip\|.only\|.todo" tests/' prints nothing, AND 'git diff --stat SPEC.md SPEC2.md SPEC3.md SPEC4.md SPEC5.md' is empty, AND src-tauri/tauri.conf.json still contains '"identifier": "com.markimark.app"', AND ARCHITECTURE.md notes the rename, the app badge, and the auto-hide default flip. Constraints: the five SPEC files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted test changes are those enumerated in SPEC5 §3 (the user-facing name string substitution, the E1 docname-badge line, E25's enable-auto-hide setup, U13's additive extension, and new E28–E30); the bundle identifier and config-dir location must not change. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

After it goes green, manual checks: the empty-state toolbar shows the orange-M badge;
the bar stays put by default and only auto-hides after enabling it in Settings →
General; the drag hint sits dead-center; Finder shows "Marky Mark.app".
