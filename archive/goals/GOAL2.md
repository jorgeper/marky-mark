# Launching the Markimark v2 build with /goal

Run from `marky-mark/`. For an unattended run, enable auto/permissive mode.
Prereqs already on this machine: Node 20+, Rust stable, Playwright Chromium. The
Windows attempt additionally installs: `rustup target add x86_64-pc-windows-msvc`,
`cargo install cargo-xwin`, `brew install nsis llvm`.

## Interactive (paste into a Claude Code session)

```
/goal Implement SPEC2.md in full (delta on SPEC.md; SPEC2 wins on conflict, no v1 regressions). Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U11, desktop e2e E1–E16, web e2e W1–W4, the single-file check, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' (macOS) exits 0 with the .app path and size (< 25 MB) printed, AND for Windows either the NSIS installer path and size under src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/ is printed or BLOCKERS.md documents the honest cross-compile failure — and in both cases .github/workflows/release.yml exists covering macOS and Windows, AND 'ls dist-web/' shows exactly index.html with its size printed, AND 'grep -rn ".skip\|.only\|.todo" tests/' prints nothing, AND 'git diff --stat SPEC.md SPEC2.md' is empty, AND ARCHITECTURE.md documents the web platform, the embedded-comments trailer format with the --> escape, storage migration, and the Windows build story. Constraints: SPEC.md, SPEC2.md, and this condition must not be modified; tests must contain real assertions and may not be weakened, stubbed, or deleted — the only sanctioned rewrites are E2 and E3, which must assert the same behaviors through the new Settings UI; the web e2e must run against the built dist-web/index.html; do not fake a Windows artifact. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

## Unattended one-liner

Same text via `claude -p "/goal …"` (escape the inner double quotes as in GOAL.md).

## Notes

- The Windows cross-compile is Tauri's experimental path; treat a clean failure as a
  legitimate BLOCKERS.md outcome — the GitHub Actions workflow is the guaranteed
  Windows deliverable either way.
- After it goes green, manual checks: host `dist-web/index.html` anywhere static and
  drag a `.md` onto it; on desktop, flip Settings → Comment storage to "embedded",
  comment something, and open the file in another editor to see the invisible
  `<!-- markimark-comments … -->` trailer at the end.
