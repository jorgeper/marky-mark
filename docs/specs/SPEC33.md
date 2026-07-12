# SPEC33: Marky Mark v33 — the tiered developer workflow

Delta spec on top of SPEC.md–SPEC32.md as implemented (SPEC31 remains
spec-only; SPEC28 withdrawn). This file wins on conflict. §6 is the goal
condition. Infrastructure only: **zero product-behavior changes** — the
app, its tests U1–U59 / E1–E92 / W1–W11, and the shipped bundles are
byte-equivalent in function.

**Why:** one gate currently serves every purpose, so the inner loop pays
outer-loop prices. This spec splits the loop into tiers — iterate live,
check fast, dogfood cheap, ship macOS first, add Windows on demand — and
documents + automates each tier.

---

## 1. Script tiers (FR-SCRIPTS)

1. **`npm run validate:quick`** — `scripts/validate.mjs --quick`:
   version lock-step, typecheck, unit tests, desktop-shim e2e. Skips:
   web build, web e2e, desktop bundle build, cargo check, single-file
   check, bundle scan. Prints `QUICK VALIDATION: ALL PASSED` (distinct
   string — the full gate's `VALIDATION: ALL PASSED` remains the only
   release-worthy evidence). Full `npm run validate` is unchanged.
2. **`npm run build:app:fast`** — a **debug-profile** .app bundle
   (`tauri build --debug --bundles app` + the existing local
   `createUpdaterArtifacts:false` override): minutes → tens of seconds
   after first compile. **`npm run install:app:fast`** installs it (the
   debug bundle path differs from release; same pkill/ditto/open flow).
3. **`npm run ship:local`** — `validate:quick` → `build:app:fast` →
   `install:app:fast`: the one-command dogfood loop.
4. `build:app` / `install:app` (release profile) stay as-is for
   pre-release verification.

## 2. CI split: macOS ships first (FR-CI)

1. `release.yml` (tag-triggered) loses the Windows job: test gate →
   **build-macos + build-web** → draft release with the DMG, updater
   tar.gz(+sig in latest.json), web HTML, and a SHA256SUMS.txt covering
   the present assets. `latest.json` carries the darwin platforms only
   at this stage.
2. New **`release-windows.yml`** (`workflow_dispatch`, input `tag`):
   checks out the tag, runs the test gate, builds the signed NSIS
   installer, **uploads it to the existing release** (draft or
   published), regenerates SHA256SUMS.txt over all assets, and updates
   the release's `latest.json` with the windows platform entry; when
   the release is already published it finishes by re-running the
   existing `updater-manifest` dispatch lever so the rolling pointer
   picks up the windows entry.
3. RELEASING.md is rewritten around the two-phase flow (cut macOS →
   smoke → publish → `gh workflow run release-windows.yml -f
   tag=vX.Y.Z` whenever).

## 3. The workflow doc (FR-DOC)

**`docs/DEVELOPING.md`**, linked from README's "For developers"
paragraph: a tier table (what you're doing → the command → what runs →
rough time) covering: `npm run tauri dev` / `npm run dev` (live
iteration), targeted `vitest run <file>` / `playwright test -g "E##"`,
`validate:quick` (mid-feature checkpoint), full `validate`
(feature-complete gate), `ship:local` (dogfood install), release-profile
verification, the macOS cut, and the Windows follow-up — plus the
house rules a feature must satisfy (spec first, test numbering,
amendment discipline, `VALIDATION: ALL PASSED` before any commit).

## 4. Claude shortcuts (FR-CLAUDE)

Project-scoped Claude Code commands in **`.claude/commands/`** (checked
in, so any session in this repo gets them):
1. **`/check`** — run `validate:quick`; on failure, diagnose the failing
   test and report (never weaken tests to pass).
2. **`/gate`** — run the full `validate`; print the complete evidence
   block (test counts + ALL PASSED) into the chat.
3. **`/dogfood`** — run `ship:local` and confirm the app relaunched.
4. **`/release-mac <version>`** — the full macOS cut: release:prepare,
   full gate, licenses, push, tag, push tag, watch CI to the draft,
   checksum-verify, then STOP and report (publishing stays a human
   decision unless told otherwise in the invocation).
5. **`/release-windows <tag>`** — dispatch `release-windows.yml` for
   the tag, watch it, verify the appended assets and updated sums.
   Each command file states its steps, its stop conditions, and that
   specs/tests must never be modified to make a gate pass.

## 5. Tests & guardrails

No new numbered tests (infrastructure). Guardrails verified in §6:
both workflows parse; the quick gate provably skips the slow steps; the
debug bundle is a real installable .app; the full gate is untouched
(byte-diff of its step list).

## 6. Definition of Done

1. Full `npm run validate` exits 0 — U1–U59, E1–E41 + E45–E92, W1–W11,
   `VALIDATION: ALL PASSED` printed (the product is untouched).
2. `npm run validate:quick` exits 0, prints `QUICK VALIDATION: ALL
   PASSED`, and its transcript contains no web-build, cargo, bundle, or
   scan step markers.
3. `npm run build:app:fast` exits 0 and prints the debug .app path;
   `npm run ship:local` exits 0 end-to-end and the app relaunches.
4. `actionlint` (or a YAML parse check printed in the transcript)
   passes for `.github/workflows/release.yml` and
   `release-windows.yml`; `release.yml` contains no Windows job;
   `release-windows.yml` is `workflow_dispatch` with a `tag` input.
5. `docs/DEVELOPING.md` exists and README links it; RELEASING.md
   documents the two-phase flow; `.claude/commands/` contains the five
   command files.
6. `git diff src-tauri/` empty; no dependency or version-file changes;
   no test file modified; reserved-name scan prints nothing.
