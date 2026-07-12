# Releasing Marky Mark

Releases are two-phase (SPEC33 §2): a tag builds **macOS + web** via
`.github/workflows/release.yml` and lands as a **draft** GitHub Release —
nothing goes public until a human smoke-tests the draft and flips it.
**Windows follows on demand**: `gh workflow run release-windows.yml -f
tag=vX.Y.Z` builds the NSIS installer against the tag, appends it to the
same release, and refreshes SHA256SUMS.txt + latest.json (re-advancing
the updater pointer if already published). Versions are strict semver; the
pre-release identifier (`0.2.0-alpha.1`) is **never stripped**. The version
lives in `package.json`, `src-tauri/tauri.conf.json`, and
`src-tauri/Cargo.toml`, and moves only via `npm run release:prepare`. Tags
mirror the files (`v` + version) — the files are the source of truth, not
`git describe`.

## Flow 1 — from Claude Code

Tell Claude: *"release 0.2.0-alpha.2"*. Claude runs, in order:

```bash
cd ~/src/marky-mark
npm run release:prepare -- 0.2.0-alpha.2   # bumps the 3 version files + lockfiles, commits
npm run validate                            # full gate must print VALIDATION: ALL PASSED
npm run licenses                            # regenerate THIRD-PARTY-NOTICES.md (commit if changed)
git tag -a v0.2.0-alpha.2 -m "Marky Mark 0.2.0-alpha.2"
```

The guard hook means pushes are always run by you — Claude hands back:

```bash
! git push
! git push origin v0.2.0-alpha.2            # ← this starts the pipeline
```

Claude then watches CI (`gh run watch`) and reports when the draft is up;
smoke-test and publish as below.

## Flow 2 — manually

```bash
# ---- cut ------------------------------------------------------------------
cd ~/src/marky-mark
npm run release:prepare -- 0.2.0-alpha.2    # bump 3 version files + locks, commit
npm run validate                            # must end with VALIDATION: ALL PASSED
git push
git tag -a v0.2.0-alpha.2 -m "Marky Mark 0.2.0-alpha.2"
git push origin v0.2.0-alpha.2              # ← this starts the pipeline

# ---- watch ------------------------------------------------------------------
gh run list --workflow release.yml
gh run watch                                 # test gate → 3 builds → draft release

# ---- smoke-test the draft ----------------------------------------------------
gh release view v0.2.0-alpha.2               # exactly 4 assets: dmg, setup.exe, web html, SHA256SUMS.txt
gh release download v0.2.0-alpha.2 -D /tmp/mm-smoke
(cd /tmp/mm-smoke && shasum -c SHA256SUMS.txt)   # verify, then install & poke the app

# ---- publish (the only irreversible step) -------------------------------------
gh release edit v0.2.0-alpha.2 --draft=false --prerelease   # alpha/beta/rc
gh release edit v1.0.0 --draft=false --latest               # stable releases

# ---- Windows, whenever (SPEC33 §2.2) --------------------------------------------
gh workflow run release-windows.yml -f tag=v0.2.0-alpha.2   # appends setup.exe
gh run watch                                                # gate → NSIS → attach
gh release view v0.2.0-alpha.2                              # exe + refreshed sums present

# ---- other moves ---------------------------------------------------------------
gh workflow run release.yml -f version=0.2.0-alpha.2   # dry-run: draft prerelease, no tag
gh release delete v0.2.0-alpha.2 --yes                 # discard a draft/dry-run
git push origin :refs/tags/v0.2.0-alpha.2              # retract a bad tag
gh release list
```

Rules of thumb: the tag push is the trigger, the draft is the safety net, and
`--draft=false` is the only step that makes anything public. A failed run is
re-cut by fixing, deleting + re-pushing the tag, or `workflow_dispatch`.

## Semver / alpha policy

- **`alpha.N` bumps** (`0.2.0-alpha.1` → `0.2.0-alpha.2`): fixes and
  incremental features on the way to the same milestone.
- **MINOR bumps** (`0.2.0-…` → `0.3.0-alpha.1`): a new feature milestone
  (roughly: a new SPEC delta implemented).
- **Graduating**: `-beta.N` when features for the milestone are frozen and
  only stabilization remains; dropping the pre-release id entirely (`1.0.0`)
  means signed builds, stable formats, and update guarantees — publish those
  with `--latest` so `/releases/latest` points at them.
- Pre-releases are published with `--prerelease` (GitHub labels them and
  keeps them off `/releases/latest` once a stable release exists).

Out of scope for now (seams noted in SPEC10): code signing / notarization,
the auto-updater, Linux packages, and hosted web deployment.

## Updater artifacts (SPEC19)

Release builds are signed with the updater key (`TAURI_SIGNING_PRIVATE_KEY`
/ `_PASSWORD` in Actions secrets — the local backup lives outside the repo;
guard it, losing it breaks updates). Each versioned release additionally
carries `Marky.Mark_<version>_universal.app.tar.gz` and `latest.json`
(signatures embedded). When you **publish** a draft, the `updater-manifest`
workflow copies its `latest.json` onto the rolling **`updater`** release —
the fixed endpoint Check for Updates… polls. Publishing remains the manual
act it always was; updates start flowing the moment you flip the draft.
Never edit the `updater` release by hand and never mark it pre-release.
