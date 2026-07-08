# Launching the Marky Mark v8 build with /goal

Run from `marky-mark/`.

```
/goal Implement SPEC8.md in full (delta on SPEC.md–SPEC7.md; SPEC8 wins on conflict, no regressions; do NOT implement AST/sourcemap position mapping, animated scroll sync, or scroll-linked highlighting — proportional fraction mapping is the accepted fidelity). Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U15, desktop e2e E1–E44, web e2e W1–W4, the single-file check, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' (macOS) exits 0 with the 'Marky Mark.app' path and size (< 25 MB) printed, AND the Windows NSIS cross-build ('npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis') exits 0 with the installer path and size printed (or BLOCKERS.md documents an honest new failure), AND 'ls dist-web/' shows exactly index.html with its size printed, AND 'grep -rn ".skip\|.only\|.todo" tests/' prints nothing, AND 'git diff --stat SPEC.md SPEC2.md SPEC3.md SPEC4.md SPEC5.md SPEC6.md SPEC7.md SPEC8.md' is empty, AND ARCHITECTURE.md documents the scroll-fraction mapping across mode toggles, the bidirectional split-pane sync with its echo guard, and the post-re-render scroll restore. Constraints: the eight SPEC files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted test change is adding the new E42–E44 (SPEC8 §3); all existing tests including E4, E23, E31, and E39–E41 must pass untouched (fix the implementation, not the tests); the cursor's document position must survive toggle round-trips; scroll listeners must not cause re-renders or feedback loops. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

After it goes green, manual checks: open a long document, scroll to the middle,
⌘E — you should land in the same neighborhood of the source; toggle back — the
preview didn't move; turn on side-by-side edit and drag either pane's scrollbar —
the other follows without shudder; type a paragraph near the bottom and watch the
right pane hold its place through the re-render instead of snapping to the top.
