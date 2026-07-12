# Developing Marky Mark — the tiered workflow

One rule: **pay only for the tier you're in.** Iterate in seconds, check
in minutes, gate fully once per feature, ship macOS first, add Windows
whenever.

## The tiers

| You're doing… | Command | What runs | Rough time |
| --- | --- | --- | --- |
| Iterating on UI/behavior | `npm run tauri dev` | Real desktop window, Vite HMR — changes appear as you save | seconds per change |
| Iterating on pure logic / quick UI | `npm run dev` | Browser shim (virtual fs, same app code) at `localhost:5173` | seconds |
| Poking one unit test | `npx vitest run tests/unit/<file>.test.ts` | Just that file | seconds |
| Poking one e2e test | `npx playwright test -g "E90"` | Just that test against the dev shim | ~30 s |
| Mid-feature checkpoint | `npm run validate:quick` | Version lock-step, typecheck, all units, all desktop e2e. Prints `QUICK VALIDATION: ALL PASSED` | ~2 min |
| Feature complete (before any commit) | `npm run validate` | Everything: + web build, web e2e, bundle build, cargo check, single-file check, network scan. Prints `VALIDATION: ALL PASSED` | ~4 min |
| Living on your build (dogfood) | `npm run ship:local` | quick gate → **debug-profile** .app → install to /Applications → relaunch | ~1–2 min |
| Pre-release sanity (release profile) | `npm run build:app && npm run install:app` | Optimized bundle, the thing users get | ~3 min |
| Cutting a macOS release | see [RELEASING.md](RELEASING.md) | prepare → full gate → tag → CI (mac + web) → draft → smoke → publish | ~25 min wall |
| Adding Windows to a release | `gh workflow run release-windows.yml -f tag=vX.Y.Z` | CI builds NSIS against the tag, appends it to the release, refreshes sums + updater manifest | ~15 min CI |

## The shape of a feature

1. **Spec first.** Every feature is a numbered delta spec in
   `docs/specs/SPECn.md` — what ships, what's out of scope, exact test
   IDs, amendments called out by name, a Definition of Done.
2. **Iterate in tier 1**, checkpoint with `validate:quick` when a chunk
   lands.
3. **Tests carry the spec's numbers** (U/E/W). Existing tests are never
   weakened; an amendment must be named in the spec.
4. **`npm run validate` must print `VALIDATION: ALL PASSED` before any
   commit.** The quick gate's pass-line is deliberately a different
   string — it is not release evidence.
5. **Dogfood** with `ship:local` (debug build — fast, slightly slower
   runtime). Before cutting a release, do one release-profile
   `build:app && install:app` pass.

## Claude shortcuts

This repo checks in Claude Code commands (`.claude/commands/`) so a
session here can run the tiers for you:

| Command | Does |
| --- | --- |
| `/check` | `validate:quick`, and diagnoses any failure (never "fixes" a test to pass) |
| `/gate` | full `validate`, prints the complete evidence block |
| `/dogfood` | `ship:local`, confirms the app relaunched |
| `/release-mac <version>` | the whole macOS cut through the draft + checksum verify, then stops for your publish decision |
| `/release-windows <tag>` | dispatches and watches the Windows follow-up, verifies the appended assets |

## Odds and ends

- The dev shim (`npm run dev`) exposes `window.__mmfs`, `__mmMenu`
  (under `?nativeMenu=1`), and `__mmEdit` — the same seams the e2e
  suite drives.
- Debug builds installed by `ship:local` replace /Applications; run the
  release-profile install before judging performance.
- Windows-reserved filenames (`aux`, `con`, `nul`, …) break CI checkout
  on Windows — scan before tagging.
