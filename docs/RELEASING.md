# Releasing Marky Mark

Releases are two-phase (SPEC33 §2): a tag builds **macOS + web** via
`.github/workflows/release.yml` and lands as a **draft** GitHub Release —
nothing goes public until a human smoke-tests the draft and flips it.
**Windows follows on demand**: `gh workflow run release-windows.yml -f
tag=vX.Y.Z` builds the NSIS installer against the tag, appends it to the
same release, and refreshes SHA256SUMS.txt + latest.json (re-advancing
the updater pointer if already published). Versions are strict semver; the
pre-release identifier (`0.2.0-alpha.1`) is **never stripped**. The version
lives in four files — `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`, and the README's alpha banner (`README.md`) — and
moves only via `npm run release:prepare`, which rewrites all four.
`validate`'s version lock-step holds the four to the same version. Tags
mirror the files (`v` + version) — the files are the source of truth, not
`git describe`.

## Flow 1 — issue-driven, from Claude Code (the primary path, prd/008)

Two skills, two invocations, with the release issue as the running log:

1. `/new-release` — interviews you for version + platforms, drafts the
   changelog from commits and closed issues, and files the
   `sandcastle:release` issue once you approve the text. It never
   starts the cut.
2. `/cut-release <issue#>` — executes the cut in your session:
   preflight (parse + ordering guard via `release-lane.mts`), the
   release branch and mechanics, the full gate, the pre-tag
   `release-branch-test.yml` run, tag + merge-back, `release.yml`
   watch, draft verification, and the Windows append for `both` /
   `windows` requests. Every phase lands as a marker comment on the
   issue, so a re-invocation resumes where the cut left off; a failed
   step files a blocking bug and parks the cut until the bug closes.

Publishing the draft is still exclusively your act (below); the
`release-closeout` workflow comments the final links and closes the
issue when you publish.

## Flow 2 — manually

```bash
# ---- cut ------------------------------------------------------------------
cd ~/src/marky-mark
npm run release:prepare -- 0.2.0-alpha.2    # bump 4 version files + locks, commit
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

Pushing a `release/**` branch triggers `release-branch-test.yml` — the
same macOS suite the tag run gates on — so you can get a green light
*before* spending the tag. The `/cut-release` skill always does this;
manual cuts may tag directly and lean on the draft safety net as
before.

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
Never edit the `updater` release by hand — the workflow owns it, and it
deliberately keeps it marked **pre-release** so the rolling pointer never
hijacks the `/releases/latest` slot the README links to.

Two behaviours a releaser can hit there (issue #19):

- **The pointer only moves forwards.** Publishing a tag whose version is
  older than — or the same as — the one the endpoint already serves logs
  why and exits 0 *without* uploading. That is the guard, not a failure. It
  yields automatically when the endpoint is empty or unreadable, so the
  broken state is always recoverable.
- **A run fails red if the endpoint ends up wrong.** After uploading, the
  job re-downloads `latest.json` from the `updater` release and checks the
  version it serves. No asset, a zero-byte asset, or a stale version fails
  the run and names the tag to re-dispatch.

Recovery levers:

```sh
gh workflow run updater-manifest.yml -f tag=<newest published tag>
gh workflow run updater-manifest.yml -f tag=<older tag> -f force=true  # roll back on purpose
```

Every run of that workflow — event-driven or manual — queues on one fixed
`concurrency` group and never cancels: a single publish fires several
`release` events, and `gh release upload --clobber` is delete-then-upload,
so overlapping runs are what emptied the endpoint in the first place.
