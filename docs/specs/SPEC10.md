# SPEC10: Marky Mark v10 — open-source alpha: semver, CI/CD releases, About, license

Delta spec on top of SPEC.md–SPEC7.md as implemented (all green: U1–U15, E1–E41,
W1–W4) in the standalone `jorgeper/marky-mark` repo. SPEC8 (scroll continuity)
remains a separate pending milestone with E42–E44 reserved; SPEC9 was the
monorepo pipeline draft and is **superseded by this spec**. This file wins on
conflict; nothing may regress. §8 is the goal condition. Out of scope: code
signing/notarization, auto-updater, Linux packages, hosted web deployment
(design seams only).

---

## 1. Semantic versioning, alpha channel (FR-V)

1. Adopt semver.org versioning with a pre-release channel: the app is in
   **alpha**, so versions read `MAJOR.MINOR.PATCH-alpha.N`. The first public
   release is **`0.2.0-alpha.1`** (0.1.0 was the internal era; never published).
2. The version lives in exactly three files, always in lock-step:
   `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
   (locks refresh alongside).
3. **`scripts/release-prepare.mjs`** (`npm run release:prepare -- <version>
   [--no-commit]`): validates full semver (pre-release ids allowed), writes all
   three files, refreshes `package-lock.json` and `Cargo.lock`, prints a
   diffstat, and commits `chore: release v<version>` unless `--no-commit`.
   Same-version rerun is a no-op.
4. Windows note: NSIS accepts pre-release strings (Tauri derives the numeric
   installer fields itself). If the build ever balks, fix via Tauri's version
   overrides — never by dropping the pre-release id from the source of truth.

## 2. CI/CD release pipeline (FR-CI)

1. Rework the dormant **`.github/workflows/release.yml`** (now live in this
   standalone repo; it predates v2–v7 and has no test gate). Triggers: tag push
   `v*` and `workflow_dispatch` with a `version` input (dry-run → draft
   **prerelease**, no tag needed).
2. Jobs:
   - **test** (macos-latest): `npm ci`, `npx playwright install chromium`,
     `npm run validate` — the full gate before anything builds. Also verifies
     the released version equals all three version files (fail names the stale
     file). Cache node + cargo (`swatinem/rust-cache`).
   - **build-macos** (macos-latest, needs test): universal binary
     (`--target universal-apple-darwin`) → one `.dmg` for both Intel and
     Apple Silicon.
   - **build-windows** (windows-latest, needs test): `--bundles nsis` →
     `..._x64-setup.exe` (native build; cargo-xwin stays a local-dev fallback).
   - **build-web** (ubuntu-latest, needs test): `npm run build:web`, asset
     renamed **`marky-mark-web-<ver>.html`** so downloads are self-describing.
   - **release** (needs all three): collects artifacts, writes
     `SHA256SUMS.txt`, creates one **draft** GitHub Release for the tag with
     generated notes plus a fixed header (what each asset is; unsigned-build
     caveats: macOS right-click → Open / `xattr -dc`, Windows SmartScreen →
     Run anyway; alpha disclaimer). Publishing is always a human action.
3. `contents: write` permission on the release job only; concurrency group
   keyed on the ref so re-pushed tags cancel stale runs. Implementation may use
   `tauri-action` or plain `tauri build` + `gh release` — judged on the
   outcome: **one draft release, exactly four assets** (dmg, setup.exe, web
   html, SHA256SUMS.txt).

## 3. Where releases live + the docs (FR-R)

1. Prebuilt binaries live on **GitHub Releases** (that is the "releases
   directory") — binaries in git history would bloat every clone forever, and
   Releases already gives latest/previous, per-asset URLs, and download counts.
   `https://github.com/jorgeper/marky-mark/releases/latest` is the canonical
   "get it" link; the full index lists every prior version.
2. **README.md** rewrite, standard OSS shape: name + one-liner, alpha-status
   banner, license + release badges, features, a **Download** section (latest
   links per platform + "all versions" link + the web single-file explained:
   download and open, or host anywhere), building from source, docs links
   (ARCHITECTURE/SPECs/THEMES), License section (MIT, Jorge Pereira).
3. **RELEASING.md**: the operator manual. Both flows:
   - **From Claude Code**: tell Claude "release 0.2.0-alpha.2" → it runs
     release-prepare, commits, and hands back the two push commands (the guard
     hook means pushes are always run by you: `! git push` then
     `! git push origin v0.2.0-alpha.2`), then watches CI (`gh run watch`) and
     reports when the draft is up.
   - **Manually**: the same steps as commands — release-prepare, push, `git
     tag -a v<ver>`, push the tag, `gh run watch`, smoke-test the draft
     (`gh release download` + `shasum -c`), publish with `gh release edit
     v<ver> --draft=false --latest` (pre-releases: `--prerelease` instead of
     `--latest`).
   - Also: dry-runs via `workflow_dispatch`, retracting a bad tag, semver-alpha
     policy (when alpha.N bumps vs MINOR, what graduating to beta/1.0 means).

## 4. About dialog (FR-A)

1. The app menu gains **"About Marky Mark"** (`data-testid="menu-about"`,
   next to Help). It opens a modal (`about-dialog`) showing: the app badge,
   the name **Marky Mark**, the version (`about-version`, e.g.
   `v0.2.0-alpha.1`), an **Alpha** notice (`about-alpha` — wording like
   "Alpha preview — expect rough edges"), **Developer: Jorge Pereira**, the
   license ("MIT License") and a link to the GitHub repo. Esc/click-outside/
   Close all dismiss it, consistent with the settings modal.
2. The version is injected at build time from `package.json` (a
   `__APP_VERSION__` define in **both** vite configs — desktop and web builds
   must show the same truth). No runtime fs reads.
3. **E45** asserts: menu → About opens the dialog; `about-version` text equals
   `v` + the version in package.json (the test reads package.json directly);
   the alpha notice and "Jorge Pereira" are visible; Close dismisses.

## 5. License scaffolding (FR-L)

Per the approved proposal in `license.md` (MIT, most permissive that stays
ecosystem-normal; audit found nothing stronger than Tauri's standard MPL-2.0
transitive crates, which impose nothing on our license):

1. **`LICENSE`** at the root: MIT, `Copyright (c) 2026 Jorge Pereira`.
2. **`scripts/licenses.mjs`** (`npm run licenses`): walks the shipped npm
   production tree and `cargo metadata`, regenerates
   **`THIRD-PARTY-NOTICES.md`** (package, version, license, grouped), and
   **exits non-zero if any license outside the allowlist appears**
   (MIT/Apache-2.0/BSD/ISC/Zlib/Unicode/CC0/0BSD/Unlicense/MPL-2.0-transitive)
   — this is the ongoing guard that future deps stay clear. Deterministic:
   rerun → no diff.
3. Metadata: `"license": "MIT"` in package.json; `license = "MIT"` in
   src-tauri/Cargo.toml; MIT named in the About dialog (§4) and README (§3).
4. `license.md` stays in the repo as the audit/decision record.

## 6. Sanctioned test changes

Only:
- New **E45** (About dialog).
- **E13**: the menu grows one item — the exactly-five assertion becomes exactly
  **six** with `menu-about` added to the asserted set; everything else in E13
  unchanged.

E42–E44 stay reserved for SPEC8. Nothing else may change.

## 7. Notes

- The workflow can't be end-to-end proven without pushing; the goal proves
  everything locally (validate, both desktop builds with the alpha version
  string, web build, workflow lint) and RELEASING.md's first-release checklist
  covers the rest.
- `git describe`/tags are not the version source — the three files are; tags
  mirror them (`v` + version).
- Don't let the About modal grow settings-dialog complexity: one column,
  static content, ~380px, reuses `.modal` styles.

## 8. Definition of Done (the /goal condition verifies exactly this)

1. `npm run validate` exits 0 with complete output — **U1–U15, E1–E41 + E45,
   W1–W4**, the single-file check, `VALIDATION: ALL PASSED` — printed in the
   transcript.
2. `grep '"version"' package.json`, `grep '"version"' src-tauri/tauri.conf.json`,
   and `grep '^version' src-tauri/Cargo.toml` all print **0.2.0-alpha.1**.
3. `npm run release:prepare -- 0.2.0-alpha.2 --no-commit` prints a diffstat
   touching exactly the three version files + lockfiles, then the tree is
   restored; a same-version run reports a no-op.
4. `npm run licenses` exits 0, regenerates THIRD-PARTY-NOTICES.md with **zero
   diff on a second run**, and demonstrably fails on a disallowed license
   (covered by a unit test **U16** against the checker's core with a fake
   copyleft entry).
5. macOS build exits 0 with `Marky Mark.app` path + size (< 25 MB) printed and
   the dmg carrying the `0.2.0-alpha.1` version; Windows NSIS cross-build exits
   0 with installer path + size printed (or BLOCKERS.md documents an honest new
   failure); `ls dist-web/` shows exactly `index.html`, size printed.
6. `.github/workflows/release.yml` parses clean (`actionlint` if available,
   else a YAML parse + `gh workflow` lint once pushed); LICENSE, README.md,
   RELEASING.md, THIRD-PARTY-NOTICES.md all exist with the §3/§5 content;
   README links to `/releases/latest` and `/releases`.
7. `grep -rn "\.skip\|\.only\|\.todo" tests/` prints nothing; `git diff --stat
   SPEC*.md` empty; ARCHITECTURE.md documents the version plumbing
   (`__APP_VERSION__`), the pipeline topology, and the license guard.
