# Spec: Comment stores: read and write through the seam, unknown-key retention, lowest-version stamping (#15)

## Goal

All acceptance criteria in specs/issue-15.md are satisfied for issue #15, with
evidence visible in the session: `src/lib/sidecar.ts` and `src/lib/embedded.ts`
both read through `readCommentPayload` in `src/lib/commentFormat.ts` and both
report an unsupported-MAJOR store as unreadable with zero comments instead of
yielding comments; unknown keys on a comment, reply or anchor survive a
parse → serialize round-trip verbatim without ever shadowing a known key; both
stores write a `version` key whose value is the **lowest** version capable of
representing the data (`"1.0.0"` today, or the retained higher version when
unknown fields from a newer minor are present) while staying byte-stable and
still writing no trailer for zero comments; new numbered unit tests (U133
onward) cover each rule; `npm run validate:quick` prints
`QUICK VALIDATION: ALL PASSED`; and a summary comment from the implementer
exists on issue #15.

## Acceptance criteria

### Reading through the seam

- Both stores read through the single seam. `src/lib/embedded.ts` and
  `src/lib/sidecar.ts` each hand the raw `JSON.parse` result to
  `readCommentPayload` from `src/lib/commentFormat.ts` and act on the returned
  discriminated union; neither store re-implements the version decision
  (PRD 004 Req 29).
- The seam no longer round-trips through `JSON.stringify` to reuse
  `parseSidecar`. The entry-level comment/reply/anchor schema check lives in
  exactly one place and the seam calls it directly, so `commentFormat.ts` no
  longer serializes a payload back to text in order to parse it. Whether that
  check ends up in `commentFormat.ts` or stays exported from `sidecar.ts` is the
  implementer's call, as long as there is one copy and no re-serialization.
- **(Req 12)** A store whose version has a MAJOR greater than the build
  supports contributes **zero** comments. Concretely: an embedded trailer or a
  sidecar declaring `"2.0.0"` (or a present-but-uninterpretable version, which
  Req 5 already routes to the same branch) parses to no comments at all — not a
  best-effort subset.
- Each store reports unreadability in its own return shape, so the app layer of
  issue #16 has something to act on:
  - `splitEmbedded`'s `SplitDoc` gains a report of whether the trailer was
    readable and, when it was not, the version exactly as it was declared.
    `hadTrailer` keeps its current meaning (a block was present), and
    `content` is still the markdown with the trailer stripped, byte-exact.
  - The sidecar gains a read entry point that returns the same information for
    sidecar JSON text. Whether `parseSidecar` is changed in place, kept as a
    thin comments-only wrapper, or replaced is the implementer's call.
  - Exposing the trailer's raw bytes for issue #16's byte-preservation work is
    permitted but **not** required here.
- **(Req 18)** A store whose MAJOR is supported but whose MINOR is greater
  (`"1.3.0"`, `"1.7.2"`) parses normally through both stores, with its comments
  present.
- **(Req 40)** Existing files still load their comments through the new code
  paths: an embedded trailer with the integer `"version":1`, a trailer using the
  legacy `markimark-comments` marker, and a sidecar with no `version` key at all.
- **(Req 22)** An entry that fails the schema check is still skipped rather than
  crashing the parse, and a store containing a mix of valid and malformed
  entries still yields the valid ones. Unparseable JSON still behaves as today
  (`splitEmbedded` swallows it; the sidecar's read path keeps its current
  throw-or-empty contract, and `src/App.tsx`'s existing try/catch still covers
  it).

### Unknown-key retention

- **(Req 19)** Keys the build does not recognize on a **comment**, on a
  **reply**, and on an **anchor** are retained in an opaque per-object bag
  rather than dropped, at all three levels. All three levels are covered by
  assertions; retaining only the comment level does not satisfy this.
- **(Req 19)** Retained keys are re-emitted verbatim by `serializeSidecar` and
  `serializeTrailer` — same key, same value, including nested objects and
  arrays, at the same level of the payload they were found at. The bag itself is
  an in-memory field only: no key named after it (`extra`, `unknown`, or
  whatever it is called) ever appears in serialized output.
- **(Req 20)** A key the build knows is parsed by the build's rules and is **not
  also** carried in the bag. Assert the exact known-key sets — comment:
  `id`, `author`, `createdAt`, `body`, `resolved`, `thread`, `anchor`; reply:
  `id`, `author`, `createdAt`, `body`; anchor: `exact`, `prefix`, `suffix`,
  `start`, `end` — and that a known key with a wrong-typed value is still
  handled by the build's existing rule rather than bagged (e.g. `resolved: "yes"`
  still parses to `false` via the current `=== true` coercion, and is not
  retained as an unknown key).
- The bag is **absent, not empty**, when an object had no unknown keys. A
  payload with no extra keys parses to comment objects deep-equal to what the
  current code produces (U8's `toEqual` round-trip assertions keep passing
  unmodified), and serializes to the same bytes as today apart from the added
  `version` key.
- Any new field added to `CommentData`, `ThreadReply` or `Anchor` in
  `src/lib/anchoring.ts` is **optional**, so every existing construction site in
  `src/App.tsx`, `drafts.ts`, `reviewBundle.ts` and `exportDoc.ts` keeps
  compiling and behaving unchanged.
- An entry skipped by the schema check (Req 22) loses its unknown keys along
  with the rest of the entry — retention applies to entries that parse. Say so
  in a code comment so the interaction is deliberate rather than accidental.

### Writing

- **(Req 26)** Both stores serialize the same comment payload schema and the
  same `version` key, with the same key placement, so the two payloads differ
  only by container. The sidecar gains the `version` key it lacks today, and the
  trailer's integer `1` becomes a semver **string** (PRD Req 1, Req 39 — the
  shipped `0.4.0-alpha.4` build ignores the field, so the change does not
  disturb it).
- **(Req 23)** The stamped version is the **lowest** version capable of
  representing the data being written, not the build's supported version. For a
  comment set using no field newer than 1.0.0 the stamp is `"1.0.0"`. This must
  be *computed*, not read from `SUPPORTED_COMMENT_FORMAT_VERSION`: the baseline
  is its own declaration, and a test asserts the write path does not derive the
  stamp from the supported-version constant (a source-level assertion in the
  style of the existing U131/U132 checks is acceptable), so that bumping the
  supported version to 1.4.0 later would not silently start stamping 1.4.0.
- **(Req 21, Req 24)** A store read at a supported MAJOR with a higher MINOR
  whose entries carry retained unknown fields keeps that higher version on
  save — `"1.3.0"` in, `"1.3.0"` out, never downgraded to `"1.0.0"`. The version
  travels with the parsed comments: a round-trip through the store alone
  (`serialize(read(text))`) reproduces the higher version **without the caller
  threading it by hand**, so `src/App.tsx`'s existing `serializeSidecar(current)`
  and `attachEmbedded(s.savedText, current)` call sites need no new argument.
- The complementary case is asserted too: a store read at `"1.3.0"` whose
  entries carry **no** unknown fields stamps `"1.0.0"` on save — Req 24 defers to
  the retained *fields*, not to the version the file happened to declare.
- When comments with different retained versions end up in one write (e.g. via
  `mergeComments`), the stamp is the highest version any retained field
  requires. A version comparison used for this is exported and unit tested.
- **(Req 27)** Writing stays idempotent and byte-stable: serializing an
  unchanged comment set twice produces identical bytes (including for comments
  carrying retained unknown keys — key order in the output is deterministic),
  and `attachEmbedded` still never double-attaches a trailer. The sidecar is
  still 2-space pretty-printed with a trailing newline; the trailer still escapes
  `-->` losslessly and is still stripped invisibly from the rendered document.
- **(Req 28)** A document with zero comments still writes **no trailer at all** —
  `serializeTrailer([])` is still `''`, and an absent trailer is not replaced by
  a versioned empty one. The sidecar's zero-comment behaviour in
  `persistComments` (delete the file rather than write an empty one) is
  unchanged.

### Scope

- Store layer only. `src/App.tsx` changes only as much as the changed store
  signatures require to keep compiling and to keep its current behaviour: no
  persistent indication, no disabled comment authoring, no byte-for-byte
  preservation of an unreadable store, no per-store version state in app
  state — PRD Reqs 13–17 are issue #16.
- `docs/COMMENT-FORMAT.md`, the `CONTRIBUTING.md` bump rule and the PRD's
  section H are issue #17 and are **not** written here.
- Nothing else in the repo changes its versioning: `settings.ts`,
  `workspace.ts`, `drafts.ts`, `readingPositions.ts` and `recentFiles.ts` keep
  their integer `version: 1`; `exportDoc.ts` and `reviewBundle.ts` are untouched
  (PRD non-goals). `mergeComments` keeps its trailer-wins-by-id semantics.
- The container is frozen (Req 32/33): the `marky-mark-comments` marker, the
  permanent `markimark-comments` read alias and the `<doc>.comments.json`
  filename pattern are unchanged.

### Tests and gate

- New numbered unit tests exist, starting at **U133** (U132 is the current
  maximum; numbers are never reused, per CONTRIBUTING.md). They cover, each with
  its own assertion: newer-MAJOR yields zero comments in *both* stores;
  newer-MINOR parses in both stores; unknown-key retention and verbatim
  re-emission at comment, reply and anchor level; no known key shadowed or
  duplicated into the bag; a malformed entry still skipped; the `"1.0.0"` stamp
  for plain data in both stores; the retained-version stamp of Req 21/24 and its
  complement; byte-stability of a double serialize including retained keys;
  `serializeTrailer([]) === ''`; and the legacy reads of Req 40 (integer `1`
  trailer, `markimark-comments` marker, versionless sidecar).
- Existing tests are extended, never weakened, skipped, or deleted. **U132 is
  the deliberate exception and must be updated**, because it asserts exactly the
  end state this issue replaces: that no `src/` file imports `commentFormat`,
  that the trailer contains `"version": 1`, and that the sidecar has no `version`
  property. Rewrite those three assertions to state the new end state (both
  stores import the seam; both payloads carry `"version": "1.0.0"`), keeping the
  purity assertions (no DOM, no React, no `@tauri-apps` in the seam) intact.
  U8, U9, U10 and U11 must keep passing — adjust them only where the added
  `version` key makes a literal-bytes assertion stale.
- The implementer iterated with `npm run typecheck` and `npm run test:unit` (or
  a tighter loop such as
  `npx vitest run tests/unit/comment-format.test.ts tests/unit/sidecar.test.ts tests/unit/embedded.test.ts`),
  and ran the full gate below exactly **once**, right before declaring the goal
  met — not after every change. Any baseline at the start of the attempt used the
  quick tier only.
- `npm run validate:quick` has been run in the implementer's session and printed
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #15, naming the files
  changed, the read/write surface each store now exposes, how the retained
  version reaches the writer, and the gate evidence.

## Context

Second of four sub-issues under `prd/004-comment-format-versioning.md`
(#14 seam → **#15 stores through the seam** → #16 unsupported-store app
behaviour → #17 the published document). In-scope requirements are 12, 18–24
and 26–28; the issue body lists them verbatim.

`src/lib/commentFormat.ts` (from #14) already exports
`SUPPORTED_COMMENT_FORMAT_VERSION = '1.0.0'`, `parseFormatVersion`,
`isFormatVersion` and `readCommentPayload`, plus the two-entry `MIGRATIONS`
table (integer `1` → `1.0.0`, absent key → `1.0.0`) that must keep working
forever for files already in the wild. Its `extractComments` currently calls
`parseSidecar` via a `JSON.stringify` round-trip and its doc comments already
name this issue as the one that removes that.

`src/lib/sidecar.ts` (98 lines) holds the `isReply` / `isAnchor` schema checks
and `parseSidecar` / `serializeSidecar`. `src/lib/embedded.ts` (71 lines) splits
the trailer with `TRAILER_RE`, delegates parsing to `parseSidecar`, and writes
`{"version":1,"comments":[…]}`. `src/App.tsx` is the only consumer:
`loadDocParts` (~line 966) reads both stores and merges, `persistComments`
(~line 1709) writes one of them, and the export/save-as paths near lines
2322–2341 call `attachEmbedded` / `serializeSidecar`.

Tests live in `tests/unit/*.test.ts` (vitest, `npm run test:unit`) with stable
`U<n>` ids in the title. `fixtures/interop-sidecar.comments.json` is a real
sidecar from the sibling `md-with-comments` app and must keep parsing (U8).
E2E specs write trailers with `version: 1` as *input* fixtures and only assert
on the marker, not the written version — but re-check them if a signature moves.
`npm run validate:quick` runs typecheck + unit + the desktop-shim Playwright
suite and prints `QUICK VALIDATION: ALL PASSED`; the full `npm run validate`
adds web builds and `cargo check` and is not required by this spec.
