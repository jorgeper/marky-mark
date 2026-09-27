# Developing Marky Mark — the tiered workflow

One rule: **pay only for the tier you're in.** Iterate in seconds, check
in minutes, gate fully once per feature, ship macOS first, add Windows
whenever.

## Local Sandcastle setup

Start with Git and Node.js 22.18+ (22.x) or 24+, clone Marky Mark, and run
`npm run doctor` before installing anything else. `npm run sandcastle:doctor`
is an alias. Doctor runs on Node alone, prints the next commands, exits
nonzero when setup needs attention, and can be rerun safely after every step.
It never installs software, writes credentials, starts agents, or changes
GitHub issues.
Node 22.17 and older lack the default native TypeScript execution needed by
the server checks; Doctor catches that before installing dependencies.

The engine is a private package named `sandcastle-local`, linked from a
sibling checkout of [jorgeper/sandcastle](https://github.com/jorgeper/sandcastle):

```text
src/
  marky-mark/
  sandcastle/
```

The normal dependency setup, run from Marky Mark, is:

```bash
git clone https://github.com/jorgeper/sandcastle.git ../sandcastle
npm --prefix ../sandcastle ci --no-audit --no-fund
npm --prefix ../sandcastle run build
npm ci --no-audit --no-fund
npm run doctor
```

No engine package registration or publishing is involved. Other npm
dependencies still download from their registries. Keep the engine checkout
in place; after changing or updating its source, rebuild it. Existing
checkouts must contain the `sandcastle-local` migration in both repositories.
Do not re-run the engine's scaffold/init command over this customized workflow.

Once dependencies load, Doctor checks host GitHub access and commit identity,
the ignored `.sandcastle/.env` file, agent credentials, the sandbox GitHub
token, committed skills, verification commands, effort tiers, the Docker
daemon/image, and labels. It tells you how to fix missing prerequisites.
The host's `gh auth login` and the sandbox's `GH_TOKEN` are separate;
[PR_SETUP.md](../.sandcastle/PR_SETUP.md) documents the token permissions.
Never paste tokens into chat or commit them.

The current loop is still Claude Code-based. Setting up the local engine
does not yet add Copilot goal/conversation support; Doctor explicitly reports
the Claude credential requirement. The container installs Claude Code itself;
the host CLI is only needed if you obtain an OAuth token via `claude setup-token`.
An Anthropic API key is the alternative.

When Docker is running, build the image from Marky Mark with
`node ../sandcastle/dist/main.js docker build-image`. Doctor's label guidance
uses `npm run sandcastle:init`, which provisions the existing workflow's
labels and skills rather than replacing its scaffold. After Doctor passes,
review `npm run sandcastle:agents` and start `npm run sandcastle`.
Pass `npm run doctor -- --image-gaps` for the optional install-log scan.
Rust and native desktop build prerequisites are not needed for this
Docker-based workflow; desktop/release builds have additional requirements.

### Fork isolation

All Marky Mark remote writes belong on `jorgeper/marky-mark`; all engine
writes belong on `jorgeper/sandcastle`. Never send changes, PRs, issues, or
comments to the engine's upstream, regardless of its current name.

Use `git clone` as above: `gh repo clone` can add an upstream remote and
select the parent as its default repository. After cloning, run these
local safeguards from Marky Mark once GitHub CLI is installed:

```bash
git config --local remote.pushDefault origin
git config --local push.default simple
gh repo set-default jorgeper/marky-mark
git -C ../sandcastle config --local remote.pushDefault origin
git -C ../sandcastle config --local push.default simple
(cd ../sandcastle && gh repo set-default jorgeper/sandcastle)
git remote -v
git -C ../sandcastle remote -v
```

Both checkouts should have only their owned `origin` remote. If an
`upstream` remote exists, remove it with `git remote remove upstream` in
that checkout. Verify `gh repo set-default --view` in each checkout too.
These settings do not travel with commits; repeat them on every machine.
Agents must still use explicit owned-repository targets for remote writes.
Defaults and instructions prevent accidental routing, not arbitrary API
access. For stronger isolation, use dedicated agent credentials with access
limited to the owned repositories; do not give agents broader credentials.

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

- The hosted flavor runs offline with `npm run server:local` (Azurite +
  mock auth, no Azure resources). Its Azurite persists state in
  `node_modules/.cache/azurite` — delete that directory to wipe it; the e2e
  lane instead runs Azurite in memory (`MM_AZURITE_IN_MEMORY=1`), fresh per
  run.
  [`server/README.md`](../server/README.md)
  is its backend reference and
  [HOSTING-AZURE.md](HOSTING-AZURE.md) the operator guide for deploying it
  to a real subscription. [AGENT-BRIDGE.md](AGENT-BRIDGE.md) walks through
  connecting Claude Code to a workspace over the experimental agent bridge
  (`MM_AGENT_BRIDGE=1 npm run server:local`).
- The dev shim (`npm run dev`) exposes `window.__mmfs`, `__mmMenu`
  (under `?nativeMenu=1`), and `__mmEdit` — the same seams the e2e
  suite drives.
- Debug builds installed by `ship:local` replace /Applications; run the
  release-profile install before judging performance.
- Windows-reserved filenames (`aux`, `con`, `nul`, …) break CI checkout
  on Windows — scan before tagging.
- e2e reads of animation- or observer-driven state must poll, never
  sample once: transitions (pane slides, the toolbar shell), and anything
  applied in a `requestAnimationFrame` or a `ResizeObserver` (the gutter),
  settle after the action that triggered them. Wrap the property under
  test in `expect.poll` (or a web-first `expect`) with the assertion
  unchanged — `07da43e` (E25, the slide-out transform) and `75b92ae`
  (E136, the rAF-scheduled gutter rules) are the model. `stableBox()` in
  `tests/e2e/helpers.ts` is the same idea for geometry a drag starts from.
