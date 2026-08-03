# Launching the Marky Mark v10 build with /goal

Run from `~/src/marky-mark` (the standalone repo). Prereq: `npm install` once,
and review/approve `license.md` first — the goal scaffolds what it proposes.

```
/goal Implement SPEC10.md in full (delta on SPEC.md–SPEC7.md as implemented; SPEC10 wins on conflict, no regressions; SPEC8 stays unimplemented with E42–E44 reserved; do NOT implement code signing, notarization, auto-updater, Linux packages, or hosted web deployment). Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U16, desktop e2e E1–E41 plus E45, web e2e W1–W4, the single-file check, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND grep shows version 0.2.0-alpha.1 in package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml, AND 'npm run release:prepare -- 0.2.0-alpha.2 --no-commit' prints a diffstat touching exactly the three version files plus lockfiles (tree restored afterward) and a same-version rerun reports a no-op, AND 'npm run licenses' exits 0 and regenerates THIRD-PARTY-NOTICES.md with zero diff on a second consecutive run, AND 'npm run tauri build' (macOS) exits 0 with the 'Marky Mark.app' path and size (< 25 MB) printed, AND the Windows NSIS cross-build ('npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis') exits 0 with the installer path and size printed (or BLOCKERS.md documents an honest new failure), AND 'ls dist-web/' shows exactly index.html with its size printed, AND .github/workflows/release.yml parses cleanly (actionlint if available, else a YAML parse check printed), AND LICENSE (MIT, Copyright (c) 2026 Jorge Pereira), README.md (with /releases/latest and /releases links, alpha banner, download-per-platform section), RELEASING.md (Claude Code flow AND manual flow with the exact commands), and THIRD-PARTY-NOTICES.md all exist, AND 'grep -rn ".skip\|.only\|.todo" tests/' prints nothing, AND 'git diff --stat SPEC.md SPEC2.md SPEC3.md SPEC4.md SPEC5.md SPEC6.md SPEC7.md SPEC8.md SPEC9.md SPEC10.md' is empty, AND ARCHITECTURE.md documents the __APP_VERSION__ plumbing, the release pipeline topology, and the license allowlist guard. Constraints: the SPEC files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted test changes are new E45 and U16 plus E13's menu-count assertion going from exactly five to exactly six with menu-about added (SPEC10 §6); the About dialog must show the app name, version from __APP_VERSION__ (build-time from package.json, both vite configs), an alpha notice, Developer: Jorge Pereira, and the MIT license; the version pre-release identifier must never be stripped from the three source files; comment sidecar/trailer formats and all existing behavior must be unchanged. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part — pushes and the first release)

```bash
cd ~/src/marky-mark
! git push -u origin main                 # first push of the repo
! git push origin v0.2.0-alpha.1          # after tagging per RELEASING.md
gh run watch                              # test gate → 3 builds → draft release
gh release view v0.2.0-alpha.1           # check the four assets
# smoke-test, then:
gh release edit v0.2.0-alpha.1 --prerelease --draft=false
```

Manual checks: ☰ → About shows v0.2.0-alpha.1, the alpha notice, and Jorge
Pereira; README's download links resolve once the release is published; a
teammate's clone + `npm run licenses` produces zero diff.
