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

### Doctor and Configure

Fresh checkouts have **no default harness or models**, even if Claude Code
or Copilot is installed or credentials are present. Doctor first asks you
to run `npm run configure`; both commands work before npm dependencies.

| Command | Behavior |
| --- | --- |
| `npm run doctor` | Read-only diagnosis and next-step guidance. |
| `npm run configure` | Show current choices, then interactively edit harness, tier models, and agent assignments. |
| `npm run configure -- --show` | Read-only effective configuration, including assignment provenance; no prompts. |

Configure requires a terminal. It has no automatic harness/model selection.
After you select a harness, it checks the native CLI's authentication and
retrieves its model catalog, then offers a numbered picker for each tier.
You can also enter an ID directly; an ID absent from a successfully retrieved
catalog requires explicit confirmation as **unverified**. The automatic
`auto` and `default` choices are omitted and cannot be saved.
Changing harness requires choosing its models again. Blank model answers
only preserve an existing explicit choice for the same harness.
The wizard previews the configuration and asks before saving.
Exit without saving, `:cancel`, Ctrl-C, and end-of-input leave the file alone.
An invalid file can be replaced only after confirmation. If another process
changes it while the wizard is open, saving fails instead of overwriting it.

#### Authentication and model discovery

Configure reuses the selected CLI's own authentication; it never asks you to
paste credentials or copies credentials into `.sandcastle/local.json`.
Install the native CLI to enable discovery:

| Harness | Native setup | Catalog |
| --- | --- | --- |
| Copilot | [Install Copilot CLI](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli), then `copilot login` | CLI account catalog, subject to your account, policy, and CLI version. No OpenAI API key is needed for Copilot models. |
| Claude Code | [Install Claude Code](https://code.claude.com/docs/en/setup), then `claude auth login`, or configure its API/cloud-provider credentials | Native Claude Code model picker, not a separate Anthropic API catalog. A Claude subscription does not require an additional API key. |

Claude's picker may return aliases, including context-window suffixes such
as `opus[1m]`. Configure preserves these verbatim; aliases resolve according
to the CLI/provider and can change over time. Enter a full model ID manually
if you need a version pin. A picker entry is not proof of successful inference.

Missing CLI/login, an unsupported CLI version, malformed metadata, network
errors, and timeouts are reported rather than replaced with a hardcoded model
list. After logging in or updating the CLI in another terminal, enter
`:retry` at a model prompt. Alternatively enter a manual ID, explicitly
marked **unverified**, or `:cancel` to leave without saving.

Discovery deliberately removes `GH_TOKEN` and `GITHUB_TOKEN` from child
environments so repository tokens cannot override Copilot's identity.
A dedicated `COPILOT_GITHUB_TOKEN` is respected if explicitly present in
the environment; otherwise Copilot uses its native stored credentials.
Configure does not load `.sandcastle/.env`. Repository credentials, host
model-discovery credentials, and future Docker agent authentication remain
separate concerns.

Discovery uses Node built-ins and installed CLIs: no engine checkout, npm
dependencies, or SDK download is needed. Copilot is queried through its
headless metadata RPC without creating a session. It follows normal CLI
startup and runtime selection, like interactive `copilot`: discovery must
not pass `--no-auto-update`, which can force an older bundled runtime instead
of the newer downloaded version and return a different model catalog.
Native CLI auto-update behavior still applies.
Claude uses safe-mode
authentication status and a stream-json initialization request with tools,
MCP integrations, and session persistence disabled. No user prompt or
inference request is sent, and Configure does not invoke login, a package
installer, or an explicit update command.
Probes run outside the repository in temporary directories with bounded
output/time and child-process cleanup. The native CLIs may maintain their
own updates, credential caches, or diagnostic files; discovery is not a guarantee of
zero filesystem activity. Secrets and raw CLI diagnostics are not displayed.

`npm run configure -- --show` remains entirely local: it does not start either
CLI, refresh models, or authenticate. Doctor's Docker/execution checks remain
separate; seeing a model in Configure does not prove the Docker token can
use it.

#### Saved configuration

Choices live in ignored `.sandcastle/local.json` (schema version 1):
`harness` (`claude-code` or `copilot`), `models` (one ID for each tier), and
optional `agentTiers` overrides. No secrets belong there. Shared policy in
`.sandcastle/configuration.mjs` defines tier names/order and default agent
assignments, but no harness or models. The loop takes one snapshot at
startup; restart it after configuration changes. All execution entrypoints,
including design/decompose/issue lanes, stop before workflow side effects
if configuration is absent, invalid, or selects an unsupported harness.

Tier labels are model-independent: switching machines must not rewrite
shared label descriptions. Local model mappings are your choices, not a
claim that different providers' models have equivalent capabilities.
The old `sandcastle:agents` command is a read-only alias for Configure's
`--show` mode. Agent configuration is script-based; no configuration skill
is installed. Existing non-configuration workflow skills are unchanged.

### Install the local engine

The engine is a private package named `sandcastle-local`, linked from a
sibling checkout of [jorgeper/sandcastle](https://github.com/jorgeper/sandcastle):

```text
src/
  marky-mark/
  sandcastle/
```

After saving configuration, the normal dependency setup from Marky Mark is:

```bash
git clone https://github.com/jorgeper/sandcastle.git ../sandcastle
npm --prefix ../sandcastle ci --no-audit --no-fund
npm --prefix ../sandcastle run build
npm ci --no-audit --no-fund
npm run doctor
```

On a work machine using an approved npm mirror, image building is a separate
setup step: Docker does not inherit the host's npm registry. Doctor reads
`npm config get registry` locally and prints the appropriate build command;
it does not change npm settings, probe the registry, or build an image.
Pass the credential-free HTTPS registry explicitly:

```bash
node ../sandcastle/dist/main.js docker build-image \
  --npm-registry https://packagefeedproxy.microsoft.io/npm/
```

Without the option, the Dockerfile uses `https://registry.npmjs.org/`.
The override applies to npm/npx during the image build, including Playwright
and Copilot installation; it is not persisted as a runtime registry setting.
It does not proxy browser downloads, apt, or the Claude installer.
Never pass tokens in this option or copy your host `.npmrc` into the image.
Registry authentication, if required, needs a separate build-secret setup.
Rebuild the sibling engine first if its CLI does not recognize the option.

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

Both harnesses support the main loop and design/decompose/issue conversations,
including resumed PR-summary turns. All agent roles and attribution markers
use the selected harness and explicitly configured model. There is no Claude
fallback. Saving configuration validates structure, not model execution.

For Copilot, set a **nonempty `COPILOT_GITHUB_TOKEN` directly in
`.sandcastle/.env`**, using a fine-grained PAT with the account permission
**Copilot Requests**. Use the same account as your host CLI login. This is
separate from `GH_TOKEN` for repository operations; neither that token nor
the Mac's native Copilot login is an inference-credential fallback. Blank
or missing file values are rejected by this workflow, even if a token is
exported in the parent shell. Do not put tokens in `local.json` or Configure.
Then rebuild the sandbox image from Marky Mark:

```bash
node ../sandcastle/dist/main.js docker build-image
npm run doctor
```

The image contains both CLIs; its Copilot capability marker is written only
after the build checks the required CLI flags. Doctor inspects image metadata
without starting a container, checks the dedicated token against GitHub's
read-only user endpoint, and reports missing prerequisites. This proves
neither Copilot entitlement nor model availability; Doctor makes no inference
requests and does not change accounts.

Copilot goals run bounded autopilot, followed by a **fresh, independent
verification session using the configured reviewer model**. The verifier
inspects the workspace and runs the required checks itself. Only an explicit
positive JSON verdict sets `goalMet`; worker completion promises cannot bypass
it. Rejection leaves the goal unmet; malformed verdicts or verifier failures
fail the attempt. Verification incurs additional model usage and check time.
`goalMaxTurns` bounds Copilot's autopilot *continuations*, not every internal
model/tool turn; Claude retains its native `/goal` semantics.

Copilot sessions are captured as native session directories under
`~/.copilot/session-state` (or host `COPILOT_HOME`) and restored into fresh
containers for resume. Account configuration and the global session database
are not copied. Native retention/deletion can make older conversations
unresumable; the conversation transcript alone cannot reconstruct model context.
Session forking is not supported. Both CLIs discover the existing
`.claude/skills/` directory; no duplicate configuration skills are needed.

For Claude configurations, the container installs Claude Code itself.
The host CLI provides model discovery and can obtain an OAuth token via
`claude setup-token`. An Anthropic API key is the alternative for agent
execution; manual configuration does not require host model discovery.

For Claude, when Docker is running, build the image from Marky Mark with
`node ../sandcastle/dist/main.js docker build-image`. Doctor's label guidance
uses `npm run sandcastle:init`, which provisions the existing workflow's
labels and skills rather than replacing its scaffold. After Doctor passes,
review `npm run configure -- --show` and start `npm run sandcastle`.
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
