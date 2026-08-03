# Spec: updater-manifest.yml races itself on publish and can leave the updater endpoint with no manifest (#19)

## Goal

All acceptance criteria in specs/issue-19.md are satisfied for issue #19, with
evidence visible in the session: `.github/workflows/updater-manifest.yml`
carries a fixed `concurrency` group with `cancel-in-progress: false`, so the
duplicate `published`/`prereleased` events a single publish fires queue instead
of racing the same `--clobber` upload; the job verifies **after** uploading that
the rolling `updater` release really carries a `latest.json` for the expected
version and exits non-zero if it does not; advancing the pointer to an older
version is refused by a pure, unit-tested semver comparator that still advances
when the endpoint is empty and still obeys an explicit manual force path;
unit tests fail if the concurrency serialisation is removed or weakened;
`npm run validate:quick` has been run and printed `QUICK VALIDATION: ALL PASSED`;
and a summary comment from the implementer exists on issue #19.

## Acceptance criteria

### The race is serialised

- `.github/workflows/updater-manifest.yml` has a top-level `concurrency:` block
  with a **fixed** group name (e.g. `updater-manifest`) and
  `cancel-in-progress: false`. The group must not be keyed by
  `github.ref`/`github.event.release.tag_name`/`inputs.tag` — the duplicate
  events that caused the incident share the same tag *and* a manual recovery
  dispatch must also queue behind an in-flight run, so anything that splits the
  group by tag or by event re-opens the race. (Contrast
  `.github/workflows/release.yml:20` and `release-windows.yml:19`, which key by
  ref/tag and cancel — correct there, wrong here.)
- `cancel-in-progress: true` is **not** used: cancelling a run between the
  delete and the upload of `gh release upload --clobber` is exactly the state
  that loses the asset. The workflow comment says so, so a future reader does
  not "optimise" it back.
- The stale comment at lines 8–10 ("the job is idempotent — clobber upload") is
  corrected: idempotent *outcome* is not the same as safe *concurrent
  execution*, and it is the concurrency block, not idempotence, that makes
  listening to three release types safe.

### The trigger decision is made explicitly

- Either the three `types: [published, prereleased, released]` stay (now safe
  under the concurrency group) or the list is narrowed to `published` with
  `workflow_dispatch` kept as the recovery lever. Whichever is chosen, the
  workflow comment and the implementer's summary comment state which and why.
  Narrowing alone is **not** sufficient — the concurrency block is required
  regardless, since a manual dispatch can still overlap an event-driven run.

### A broken endpoint fails red instead of silently

- After the upload, the job asserts that the rolling `updater` release actually
  carries `latest.json` — the incident's end state (`gh release view updater
  --json assets` → `[]`) must make the run fail, not exit 0.
- The assertion checks the **content**, not just presence: the manifest served
  by the `updater` release parses as JSON and its `version` matches the version
  just published (the `latest.json` downloaded from `$TAG`, or `$TAG` with its
  leading `v` stripped). A zero-byte or stale asset must fail.
- The failure message names the tag and what was found, so the Actions log says
  what to re-dispatch.
- The existing early-exit path is preserved: a tag with no `latest.json`
  (pre-SPEC19 release) still warns and exits 0 without touching the endpoint,
  and must not trip the new assertion.

### The pointer cannot silently go backwards

- Publishing an older tag after a newer one no longer advances the endpoint
  backwards (in the incident, publishing `v0.4.0-alpha.4` after
  `v0.4.0-alpha.5` pointed the updater at alpha.4). The job compares the
  candidate version against the version currently on the `updater` release and
  skips the upload — logging why, exiting 0, not failing — when the candidate
  is older or equal.
- The comparison is a **pure, exported function** in `scripts/updater-manifest.mjs`
  (next to `composeManifest`), invoked from the workflow through a small CLI
  mode of that same script — the pattern the file already uses. No semver
  ordering logic lives only in shell.
- The comparator handles this repo's real version shapes: `0.4.0-alpha.5` >
  `0.4.0-alpha.4`, `0.4.0-alpha.10` > `0.4.0-alpha.9` (numeric, not
  lexicographic), `0.4.0` > `0.4.0-alpha.5` (a release outranks its
  pre-releases), and equal versions are not "newer".
- Two escape hatches are mandatory, because the guard must never make the
  broken state unrecoverable:
  - if the `updater` release does not exist, has no `latest.json`, or its
    manifest is unparseable/has no `version`, the run **advances** (this is
    precisely the state issue #19 describes);
  - a `workflow_dispatch` run can force the pointer to an older version (e.g. a
    `force` boolean input, defaulting to false), so a bad release can be rolled
    back by hand. The forced path is documented in the workflow inputs.

### Regression guards

- New numbered unit tests (**U150** onward — U149 in
  `tests/unit/readme-version.test.ts` is the current maximum; numbers are never
  reused, per `CONTRIBUTING.md:53`) cover:
  - the semver comparator, including the ordering cases and the
    empty/unparseable-current cases listed above;
  - the workflow file itself: reading `.github/workflows/updater-manifest.yml`
    from disk and failing if the `concurrency` block is absent, if
    `cancel-in-progress` is anything but `false`, or if the group is
    interpolated per-tag/per-ref. Reading a repo file from a unit test follows
    `tests/unit/readme-version.test.ts` (U148) and `tests/unit/licenses.test.ts`
    (U16); vitest runs in the node environment.
- No YAML parser is available offline (no `js-yaml`/`yaml` in `node_modules`, no
  `pyyaml`), so the workflow test is text/regex based. Do not add a dependency
  for this.
- Existing tests are not weakened, skipped, renumbered, or deleted. U42
  (`tests/unit/updater-manifest.test.ts`) keeps passing unchanged.

### The shell logic is demonstrated, not assumed

- The implementer's session shows the new decision logic actually running —
  the comparator CLI invoked directly with representative inputs (newer,
  older, equal, missing-current, forced) and the printed results — rather than
  a claim that the workflow would behave. CI cannot be exercised from the
  sandbox; this local run is the evidence that stands in for it.
- The workflow's `run:` block is checked for shell correctness as far as the
  sandbox allows (e.g. `bash -n` over the extracted script body), and the
  result is in the transcript.

### Docs and scope

- `docs/RELEASING.md`'s "Updater artifacts (SPEC19)" section (lines ~95–106)
  still describes reality after the change: if the trigger list or the manual
  recovery command changed, the doc says so, and the new force/skip behaviour a
  releaser could hit is mentioned. (That section's closing line, "never mark it
  pre-release", already contradicts the workflow's deliberate `--prerelease` —
  correcting it is welcome but optional, and belongs in the same doc edit if
  done.)
- Scope is the updater manifest workflow, its script helper, its tests, and
  those docs. No version bump, no app code, no changes to `release.yml` or
  `release-windows.yml`, and no edits to `docs/specs/*`.

### Gate

- The implementer iterated with `npm run typecheck` and a tight unit loop
  (`npx vitest run tests/unit/updater-manifest.test.ts`), not the full suite
  after every change. Any baseline at the start of the attempt used the quick
  tier only.
- `npm run validate:quick` has been run **once**, in the implementer's session,
  right before declaring the goal met, and printed `QUICK VALIDATION: ALL
  PASSED`. This is the repo's configured verify command
  (`.sandcastle/config.mts:57`); the full `npm run validate` is welcome as extra
  evidence but is not required.
- A summary comment from the implementer exists on issue #19, naming the files
  changed, the trigger decision and why, the new test ids, the demonstrated
  comparator output, and the gate output.

## Context

`.github/workflows/updater-manifest.yml` is 46 lines: the trigger block is lines
6–16, the job body lines 21–46, and the racing upload is line 45
(`gh release upload updater manifest/latest.json --clobber`, delete-then-upload,
not atomic). `scripts/updater-manifest.mjs` already pairs a pure exported core
(`composeManifest`, unit-tested as U42) with a guarded CLI (`if (process.argv[1]
&& …endsWith('updater-manifest.mjs') && arg('version'))`) — extend that pattern
rather than inventing a new one, and keep the existing CLI entry working when
adding a second mode.

`scripts/release-prepare.mjs:25` has `isValidSemver` (validation only, no
ordering) — reuse it for input validation if useful, but the ordering comparator
is new. `scripts/validate.mjs` needs no change: unit tests run in both tiers.

The endpoint contract is SPEC19 §1.2 (rolling `updater` release,
`releases/download/updater/latest.json`) and §3.3 (this workflow); read them for
intent, but do not edit `docs/specs/`.

Runs cited in the issue for reference: 30781196401 (success) and 30781196483
(404 on upload) fired at the same timestamp from one publish of
`v0.4.0-alpha.4`. Repo version today is `0.4.0-alpha.5`.
