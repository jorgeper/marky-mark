# Spec: Comment format: version literal and migration seam (pure module) (#14)

## Goal

All acceptance criteria in specs/issue-14.md are satisfied for issue #14, with
evidence visible in the session: a pure `src/lib/commentFormat.ts` module
declares the `1.0.0` comment-format version literal and a single migration
chokepoint that maps a raw parsed payload plus its declared `version` to either
the current in-memory shape or an explicit "unsupported, do not parse" result
(integer `1` and an absent `version` both coerced to `1.0.0`; a malformed or
newer-MAJOR version unsupported; comparison on MAJOR then MINOR with PATCH
informational), `src/lib/embedded.ts` and `src/lib/sidecar.ts` keep their
current behaviour with no store rewired, new numbered unit tests (U124 onward)
exercise the seam directly, `npm run validate:quick` prints
`QUICK VALIDATION: ALL PASSED`, and a summary comment from the implementer
exists on issue #14.

## Acceptance criteria

- A new pure module — `src/lib/commentFormat.ts` — holds the whole seam. It has
  no DOM access (`document`, `window`), no React, and no platform imports (no
  `@tauri-apps/*`), matching `embedded.ts` / `sidecar.ts` today. It may import
  types from `src/lib/anchoring.ts` and may reuse `parseSidecar`'s entry-level
  schema check, but nothing outside `tests/` imports it yet — wiring the stores
  through it is issue #15.
- The build's supported comment-format version is declared **once**, as a single
  exported constant whose value is the string `"1.0.0"` (PRD 004 Req 2, Req 11).
  It is not derived from and not compared against the app version in
  `package.json` — the two are independent.
- A valid version is a string of the form `MAJOR.MINOR.PATCH` where each
  component is a run of digits (PRD Req 1). An exported parser/predicate decides
  this; `"1.0"`, `"v1.0.0"`, `"1.0.0-beta"`, `"1.0.0.0"` and `"1"` are all
  invalid.
- `version` is the only versioning key the module reads or names. No
  `major`/`minor` fields, no `formatVersion` alias, anywhere in the new code
  (PRD Req 6).
- The seam is a single exported function taking the raw parsed payload
  (`unknown` — the result of `JSON.parse`, not a pre-validated object) and
  returning a **discriminated union**: a supported branch carrying the resolved
  version plus the payload in the current in-memory shape, and an unsupported
  branch carrying the declared version (as it appeared, for the indication
  issue #16 will surface) and no comments. The discriminant must make it a type
  error to read comments off the unsupported branch (PRD Req 29).
- Version interpretation on read, each with its own assertion:
  - `version` is the integer `1` → interpreted as `1.0.0`, supported (existing
    embedded trailers; PRD Req 3).
  - no `version` key at all → interpreted as `1.0.0`, supported (existing
    sidecars; PRD Req 4).
  - `version` is a valid semver string → interpreted as itself.
  - `version` is present but is neither the integer `1` nor a valid semver
    string — `"1"`, `"1.0"`, `2`, `1.5`, `true`, `null`, `[]`, `{}`,
    `"newest"` — → **unsupported**, not `1.0.0` (PRD Req 5). `null` counts as
    present; distinguishing it from an absent key is part of the criterion.
- Comparison against the supported version is MAJOR first, then MINOR; PATCH
  never affects the decision (PRD Req 11):
  - a greater MAJOR (`2.0.0`, `9.1.4`) → unsupported, do not parse (PRD Req 12).
  - a greater MINOR within the supported MAJOR (`1.1.0`, `1.7.2`) → supported,
    parsed normally (PRD Req 18). Unknown-key retention for that case is
    issue #15's work and is not implemented here.
  - a differing PATCH (`1.0.9`) → supported, decided identically to `1.0.0`.
  - a version below the supported one that has no registered transformation
    (`0.9.0`) → unsupported. Req 30 forbids inventing a migration for a version
    that never existed, and Req 5's principle applies: an uninterpretable
    version is a signal to be careful, not to guess. State this in a code
    comment and cover it with an assertion.
- The registered transformations are exactly the two legacy coercions above
  (integer `1`, absent key). The registry/table is shaped so a future step can
  be appended, but no speculative step is written for a version that does not
  exist (PRD Req 30).
- A payload that is not an object at all (`null`, a string, an array, a number)
  is handled without throwing — the seam returns a defined result rather than
  raising, so a caller in issue #15 can rely on it inside the existing
  try/catch-free read paths.
- `src/lib/embedded.ts` and `src/lib/sidecar.ts` are unchanged in behaviour:
  `serializeTrailer` still writes `{"version":1,…}`, `serializeSidecar` still
  writes no `version` key, `parseSidecar` still drops unknown keys and skips
  malformed entries, and the existing U8 / embedded unit tests pass unmodified.
  Doc-comment edits pointing at the new seam are fine; functional edits are not
  — the stores move onto the seam in issue #15.
- Nothing else in the repo gains a version key or changes its versioning:
  `settings.ts`, `workspace.ts`, `drafts.ts`, `readingPositions.ts`,
  `recentFiles.ts` keep their integer `version: 1`; `exportDoc.ts` and
  `reviewBundle.ts` are untouched (PRD non-goals). `docs/COMMENT-FORMAT.md` and
  the `CONTRIBUTING.md` bump rule are issue #17 and are **not** written here.
- New numbered unit tests exist in a new `tests/unit/comment-format.test.ts`,
  starting at **U124** (U123 is the current maximum; numbers are never reused,
  per CONTRIBUTING.md). They exercise the seam function directly — its own
  module, not through a store — and cover every bullet above: both legacy
  coercions, the valid-semver passthrough, each malformed-version type, greater
  MAJOR, greater MINOR, differing PATCH, the below-1.0.0 case, and the
  non-object payload. Existing tests are extended, never weakened, skipped, or
  deleted.
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (or `npx vitest run tests/unit/comment-format.test.ts` for a tighter loop),
  and ran the full gate below exactly once, right before declaring the goal met
  — not after every change. Any baseline at the start of the attempt used the
  quick tier only.
- `npm run validate:quick` has been run in the implementer's session and printed
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #14, naming the files
  added/changed, the seam's exported surface and result type, and the gate
  evidence.

## Context

This is the first of four sub-issues under `prd/004-comment-format-versioning.md`
(#14 seam → #15 stores through the seam → #16 unsupported-store app behaviour →
#17 the published document). Read the PRD's sections A, C and F; the issue body
lists exactly which requirements are in scope for this one (1–6, 11, 29–31).
Everything else in the PRD — unknown-key retention, lowest-version stamping,
byte preservation, the persistent indication, `docs/COMMENT-FORMAT.md` — belongs
to the later sub-issues. Adding it here makes review harder, not easier.

The two stores today: `src/lib/embedded.ts` (71 lines) splits an HTML-comment
trailer off the end of the `.md` and hands its JSON text to `parseSidecar`; it
writes `{"version":1,"comments":[…]}` and nothing reads that field.
`src/lib/sidecar.ts` (98 lines) parses/serializes `{"comments":[…]}` with no
version key, dropping unknown keys and skipping entries that fail `isAnchor` /
`isReply`. `src/App.tsx` is the only consumer; it stays untouched here.

The seam's job in this issue is purely the *version decision* — take what
`JSON.parse` produced, decide whether this build may interpret it, and say so in
a shape the stores can consume next. The comment/reply/anchor schema itself does
not change (PRD Req 2); `1.0.0` is a name for the shape that already ships.

Tests live in `tests/unit/*.test.ts` (vitest, `npm run test:unit`) with stable
`U<n>` ids in the test title, referenced by `docs/specs/SPEC*.md`. The quick gate
`npm run validate:quick` runs typecheck + unit + the desktop-shim Playwright
suite and prints `QUICK VALIDATION: ALL PASSED`; the full `npm run validate`
adds web builds and `cargo check` and is not required by this spec.
