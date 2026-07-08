# Launching the Marky Mark v6 build with /goal

Run from `marky-mark/`.

```
/goal Implement SPEC6.md in full (delta on SPEC.md–SPEC5.md; SPEC6 wins on conflict, no regressions; do NOT implement editor vim mode). Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U14, desktop e2e E1–E34, web e2e W1–W4, the single-file check, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' (macOS) exits 0 with the 'Marky Mark.app' path and size (< 25 MB) printed, AND the Windows NSIS cross-build ('npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis') exits 0 with the installer path and size printed (or BLOCKERS.md documents an honest new failure), AND 'ls dist-web/' shows exactly index.html with its size printed, AND 'ls themes/ | wc -l' prints at least 27, AND 'grep -rn ".skip\|.only\|.todo" tests/' prints nothing, AND 'git diff --stat SPEC.md SPEC2.md SPEC3.md SPEC4.md SPEC5.md SPEC6.md' is empty, AND ARCHITECTURE.md documents the editor-column alignment, the Word-style comment flow, the resolved-ghost mode, and the theme expansion. Constraints: the six SPEC files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted test changes are those enumerated in SPEC6 §5 (new E31–E34 and U14, the additive U13 extension, and positioning-independent selector fixes in E7/E8/E15 only if the layout rework breaks them, with assertions unchanged); E9's default resolved-section behavior must keep passing unchanged; new themes must use canonical palettes with correct metadata and distinct backgrounds; comment sidecar/trailer formats must not change. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

After it goes green, manual checks: pile four comments on one paragraph and click the
bottom one — it should glide up level with its highlight, Word-style; resolve one and
flip "Show resolved" to see it ghosted in place; switch through gruvbox/tokyo-night/
phosphor/typewriter; enter edit mode and confirm the text column doesn't jump.
