# Spec: README advertises version 0.2.0-alpha.1; nothing keeps it in lock-step with the real version (#22)

## Goal

All acceptance criteria in specs/issue-22.md are satisfied for issue #22, with
evidence visible in the session: the alpha banner at `README.md:16` advertises
the version `package.json` carries (`0.4.0-alpha.5` today); the README's
advertised version is part of an automated lock-step check so it cannot
silently drift again; the check is demonstrated to fail on a deliberately
wrong README version (transcript evidence, tree restored afterwards) and to
stay green against the download table's `<version>` placeholders and the
release badge URL; `npm run validate:quick` has been run and printed
`QUICK VALIDATION: ALL PASSED`; and a summary comment from the implementer
exists on issue #22.

## Acceptance criteria

### The README is correct

- The alpha banner at `README.md:16`
  (`> **⚠️ Alpha** — Marky Mark is pre-release software (\`…\`).`) carries the
  exact version string in `package.json` — `0.4.0-alpha.5` unless the version
  moved during implementation. The pre-release identifier is intact, never
  stripped.
- The `/releases/latest` links on README lines 4 and 21 are **unchanged**.
  Their redirect to the bare releases listing is intended and already
  explained in lines 21–24; it is explicitly out of scope.
- The download table (README lines ~28–30) still uses the `<version>`
  placeholder in the asset filenames — it is not rewritten to a literal
  version.
- No other README prose, no app code, and no version bump.

### The drift cannot recur silently

- The README's advertised version is covered by an automated check that runs
  as part of the commit gate. The preferred shape (stated in the issue) is to
  add `README.md` as a fourth file to the version lock-step block in
  `scripts/validate.mjs` (lines 36–51), alongside `package.json`,
  `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`; the lock-step is a
  pre-step of both tiers, so it runs under `--quick` as well as the full gate.
  If the implementer chooses the `release-prepare.mjs`-rewrite shape instead,
  the summary comment states which shape and why.
- The extraction is a **pure, exported string transform** (e.g. a
  `readmeVersion(content)` in `scripts/release-prepare.mjs` next to
  `isValidSemver`/`setJsonVersion`/`setCargoVersion`, or an equivalent helper
  `validate.mjs` imports), so the unit suite can exercise exactly the code the
  gate runs — the precedent is `licenseAllowed` in `scripts/licenses.mjs`
  covered by U16 in `tests/unit/licenses.test.ts`.
- The match is anchored tightly to the alpha-banner line. It does **not**
  match, and is not confused by:
  - the badge URL on line 4 (`img.shields.io/...`, `?include_prereleases`),
  - the `<version>` placeholders in the download table,
  - `0.2.0-alpha.2`-style example versions appearing elsewhere in repo docs.
  A README with no recognisable banner version fails loudly rather than
  passing vacuously (a `null`/`undefined` extraction must not be treated as
  "in lock-step").
- The failure output names `README.md` and the offending value, in the same
  shape as the existing lock-step failure (per-file listing, then
  `VALIDATION FAILED at step: version lock-step`), and the success line
  mentions README among the files now in lock-step.

### The failure is demonstrated, not assumed

- The implementer's session contains transcript evidence that editing the
  README banner to a wrong version (e.g. `0.4.0-alpha.4`) makes the chosen
  mechanism fail — the actual command output, not a claim. The working tree is
  restored to the correct version afterwards, and the final diff contains no
  leftover mutation.
- At least one new numbered unit test (**U148** onward — U147 in
  `tests/unit/comment-format.test.ts` is the current maximum; numbers are
  never reused, per `CONTRIBUTING.md`) covers the check as a regression guard:
  the real `README.md` read from disk agrees with the real `package.json`
  version, a banner with a stale version is rejected, and the badge URL /
  `<version>` table rows do not produce a false match. Reading a repo file
  from a unit test follows `tests/unit/licenses.test.ts` and U147 (vitest runs
  in the node environment).
- Existing tests are not weakened, skipped, renumbered, or deleted.

### The release path stays coherent

- Cutting a release does not leave the gate red. Either `release-prepare.mjs`
  rewrites the README banner alongside the three version files (preferred —
  it is the same mechanical rewrite as `setJsonVersion`), or `docs/RELEASING.md`
  gains an explicit step telling the releaser to update the README banner
  before running `npm run validate`. Whichever is chosen, `docs/RELEASING.md`'s
  statement of where the version lives (lines ~10–14) matches reality after
  the change.
- If `release-prepare.mjs` writes the README, its no-op path (rerun with the
  version already in place) still no-ops, and its scoped diffstat/commit file
  list includes `README.md`.

### Gate

- The implementer iterated with `npm run typecheck` and a tight unit loop
  (`npx vitest run tests/unit/<the new or touched file>`), plus direct
  `node scripts/validate.mjs --quick` runs while shaping the check — not the
  full suite after every change. Any baseline at the start of the attempt used
  the quick tier only.
- `npm run validate:quick` has been run **once**, in the implementer's
  session, right before declaring the goal met, and printed
  `QUICK VALIDATION: ALL PASSED`. (The issue's Definition of Done asks for the
  full `npm run validate`; it is welcome as extra evidence if it completes in
  this environment, but `validate:quick` — the repo's configured verify
  command, `.sandcastle/config.mts` — is what this spec requires. The
  lock-step step being checked runs identically in both tiers.)
- A summary comment from the implementer exists on issue #22, naming the files
  changed, which of the two shapes was chosen and why, the new test id(s), the
  demonstrated-failure evidence, and the gate output.

## Context

Everything lives in three files. `README.md:16` is the stale banner.
`scripts/validate.mjs:36–51` is the version lock-step block — it runs before
the `steps` array, so it gates both `validate` and `validate:quick`, and it
already imports `isValidSemver` from `scripts/release-prepare.mjs` (that module
only runs `main()` when invoked directly, so importing helpers from it is
safe). `scripts/release-prepare.mjs:23–35` holds the exported pure transforms
and `VERSION_FILES` (line 43); `docs/RELEASING.md:10–14` documents where the
version lives.

Test numbering: U147 is the current maximum (`tests/unit/comment-format.test.ts`).
`tests/unit/licenses.test.ts` (U16) is the precedent for a unit test importing
from `scripts/*.mjs`; U147 is the precedent for one reading a repo file via
`fileURLToPath(new URL('../../<file>', import.meta.url))`.

Watch the false-positive surface the issue calls out: the shields.io badge URL
on line 4 and the `Marky Mark_<version>_x64-setup.exe` rows in the download
table. Anchor on the banner's own line rather than scanning the whole file for
anything semver-shaped.
