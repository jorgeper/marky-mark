# SPEC9: Marky Mark v9 — release pipeline (CI/CD → GitHub Releases)

Delta spec on top of SPEC.md–SPEC8.md. This one is infrastructure, not app
features: a tag-driven GitHub Actions pipeline that builds the **macOS app**,
**Windows installer**, and **single-file web app**, and attaches them —
prebuilt, versioned, checksummed — to a GitHub Release. §7 is the goal
condition; §6 is the operator's manual (the commands you actually run).

Explicitly out of scope for v9 (future sections note the seams): code signing /
notarization, the Tauri auto-updater, Linux packages, macOS universal binaries,
and publishing the web build to a hosted site. Do NOT build them yet.

---

## 1. Shape of the pipeline (FR-P)

1. One new workflow: **`.github/workflows/marky-mark-release.yml`** (repo root —
   this is the `jorgeper/sandbox` monorepo; the file replaces the `release.yml`
   that WINDOWS.md has referenced aspirationally). It follows the house
   convention set by `workout-app-publish.yml`: app-prefixed name, app-scoped
   triggers, `working-directory: marky-mark` everywhere.
2. Triggers:
   - `push` on tags matching **`marky-mark-v*`** — the release path.
   - `workflow_dispatch` with a `version` input — dry-runs and re-cuts without
     tagging (produces a **prerelease draft** named `marky-mark-v<version>`).
3. Monorepo discipline: tags are app-prefixed (`marky-mark-v0.2.0`), so other
   apps in the sandbox can adopt the same pattern without collisions. The
   workflow never looks outside `marky-mark/`.

## 2. Jobs (FR-J)

1. **`test`** (macos-latest): `npm ci`, `npx playwright install chromium`,
   `npm run validate` — the full local gate (typecheck, U-tests, desktop e2e,
   web build, W-tests, cargo check, single-file check) must be green before any
   artifact is built. Rust via `dtolnay/rust-toolchain@stable`; cache cargo +
   node (`actions/cache` or `Swatinem/rust-cache`).
2. **`version-check`** (part of `test`): the version being released (tag suffix
   or dispatch input) must equal the version in `package.json`,
   `src-tauri/tauri.conf.json`, **and** `src-tauri/Cargo.toml` — mismatch fails
   the run with a message naming the stale file. No silent drift.
3. **`build-macos`** (macos-latest, needs `test`): `npm run tauri build` →
   `Marky Mark_<ver>_aarch64.dmg`. Upload as artifact.
4. **`build-windows`** (windows-latest, needs `test`): `npm run tauri build --
   --bundles nsis` → `Marky Mark_<ver>_x64-setup.exe`. Native build — no
   cargo-xwin needed on a real Windows runner (WINDOWS.md route A).
5. **`build-web`** (ubuntu-latest, needs `test`): `npm run build:web`, then
   rename `dist-web/index.html` → **`marky-mark-web-<ver>.html`** so the asset
   is self-describing when downloaded.
6. **`release`** (ubuntu-latest, needs all builds): download all artifacts,
   generate `SHA256SUMS.txt` over them, and create a **draft** GitHub Release
   for the tag (`softprops/action-gh-release` or `gh release create --draft`)
   with auto-generated notes plus a fixed header listing what each asset is and
   the unsigned-build caveats (§4). Tag-triggered runs make a normal draft;
   dispatch runs make a draft **prerelease**. Nothing auto-publishes — a human
   smoke-tests and flips the draft (§6).
7. Permissions: `contents: write` on the release job only. Concurrency group
   `marky-mark-release-<ref>` so a re-push of the same tag cancels the stale
   run.

## 3. Versioning (FR-V)

1. The version lives in three files that must move in lock-step: `package.json`,
   `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (plus `Cargo.lock` /
   `package-lock.json` refreshes). Hand-editing three files is how drift
   happens, so:
2. **`scripts/release-prepare.mjs`** (new, wired as `npm run release:prepare --
   <version>`): validates the version is semver, writes it into all three
   files, refreshes `Cargo.lock` (`cargo update -p markimark` or a `cargo
   check`) and `package-lock.json` (`npm install --package-lock-only`), prints
   a diffstat, and commits `chore(marky-mark): release v<version>` — or with
   `--no-commit`, leaves the working tree for inspection.
3. Tag names are the single source of release truth: `marky-mark-v<version>`,
   annotated, created on the commit that release-prepare made.

## 4. Artifacts and their caveats (FR-A)

1. Release assets, exactly: the `.dmg` (Apple Silicon), the NSIS `-setup.exe`
   (x64), the single-file `.html`, and `SHA256SUMS.txt`. Sizes today: ~6 MB /
   ~3 MB / ~1.2 MB — the release job fails if any asset exceeds 25 MB
   (something went wrong) or is missing.
2. Both installers are **unsigned** in v9. The release-notes header must say so
   and give the escape hatches: macOS — right-click → Open (or `xattr -dc
   "/Applications/Marky Mark.app"`); Windows — SmartScreen → More info → Run
   anyway.
3. The web asset is the whole product in one file: the notes say "download and
   open, or host anywhere static".

## 5. Future work (design seams, do not build)

- **Signing/notarization**: Tauri supports both via secrets
  (`APPLE_CERTIFICATE…`, `TAURI_SIGNING_*`, or a `sign_command` for Windows) —
  slot into the two build jobs, no topology change.
- **Linux**: one more matrix leg (`ubuntu-latest`, `--bundles appimage,deb`)
  behind the same `test` gate.
- **macOS universal / x86_64**: additional `--target` legs on `build-macos`.
- **Auto-updater**: needs signing first; then `tauri-plugin-updater` + a
  `latest.json` asset per release.
- **Hosted web**: publish `marky-mark-web-<ver>.html` to GitHub Pages on
  release-publish (separate tiny workflow keyed on `release: published`).

## 6. Operating the pipeline (the commands)

```bash
# ---- cut a release -------------------------------------------------------
cd ~/src/sandbox/marky-mark
npm run release:prepare -- 0.2.0        # bump 3 version files + locks, commit
git push                                 # (guard hook: run pushes yourself)
git tag -a marky-mark-v0.2.0 -m "Marky Mark 0.2.0"
git push origin marky-mark-v0.2.0        # ← this starts the pipeline

# ---- watch it ------------------------------------------------------------
gh run list  --workflow marky-mark-release.yml
gh run watch                              # live-follows the latest run

# ---- smoke-test the draft --------------------------------------------------
gh release view marky-mark-v0.2.0
gh release download marky-mark-v0.2.0 -D /tmp/mm-0.2.0
shasum -c /tmp/mm-0.2.0/SHA256SUMS.txt    # verify, then install & poke the app

# ---- publish (the only irreversible step) ----------------------------------
gh release edit marky-mark-v0.2.0 --draft=false --latest

# ---- other moves -----------------------------------------------------------
gh workflow run marky-mark-release.yml -f version=0.2.0-rc.1   # dry-run, no tag
gh release delete marky-mark-v0.2.0-rc.1 --yes                 # discard a dry-run
git push origin :refs/tags/marky-mark-v0.2.0                   # retract a bad tag
gh release list                                                # what's out there
```

Rules of thumb: the tag push is the trigger, the draft is the safety net, and
`--draft=false` is the only step that makes anything public. A failed run is
re-cut by fixing, re-tagging (delete the tag first), or `workflow_dispatch`.

## 7. Definition of Done (the /goal condition verifies exactly this)

1. `npm run validate` still exits 0 locally with complete output (U1–U15,
   E1–E44 or current suite, W1–W4, `VALIDATION: ALL PASSED`) — the pipeline
   work must not touch app code or tests.
2. `.github/workflows/marky-mark-release.yml` exists, `actionlint` (or
   `gh workflow view`) accepts it, and `scripts/release-prepare.mjs` runs
   locally: `npm run release:prepare -- 0.1.1 --no-commit` updates exactly the
   three version files + locks (diffstat printed), and a second run with the
   same version is a no-op.
3. A `workflow_dispatch` dry-run (`gh workflow run marky-mark-release.yml -f
   version=0.1.1-rc.1`) completes green end-to-end and yields a **draft
   prerelease** containing exactly: the dmg, the setup.exe, the web html, and
   `SHA256SUMS.txt` — asset list printed in the transcript (`gh release view`),
   then the dry-run draft is deleted.
4. WINDOWS.md's route A reference is updated to the real workflow name;
   README.md's release line points at this SPEC; ARCHITECTURE.md gains a short
   "release pipeline" section (triggers, jobs, versioning contract).
5. `git diff --stat SPEC*.md` empty (this file included, once committed).
