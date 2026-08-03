# Spec: Publish docs/COMMENT-FORMAT.md and the CONTRIBUTING bump rule (#17)

## Goal

All acceptance criteria in specs/issue-17.md are satisfied for issue #17, with
evidence visible in the session: `docs/COMMENT-FORMAT.md` is published and is
complete enough for an outside implementer to build a reader/writer against
without reading this codebase — the 1.0.0 payload schema with a minimum-version
record per field, both container forms, the MAJOR/MINOR/PATCH table with a
worked example per component drawn from this codebase, the reader and writer
rules exactly as this build implements them, the frozen-container rule with its
reason, an explicit statement that the format version is independent of the
Marky Mark app version, and a changelog whose first entry is 1.0.0;
`CONTRIBUTING.md` requires any PR that changes the comment payload to bump the
version per the document's rules and append a changelog entry; a new numbered
unit test (U147 onward) fails if the document drifts from
`src/lib/commentFormat.ts`; `npm run validate:quick` prints
`QUICK VALIDATION: ALL PASSED`; and a summary comment from the implementer
exists on issue #17.

## Acceptance criteria

### The document exists and is discoverable

- `docs/COMMENT-FORMAT.md` is committed on this branch. It is a standalone
  specification of the **comment format**, not a tour of the implementation:
  someone building a tool that reads or writes Marky Mark comments can
  implement against it with no access to `src/` (**Req 37**). References to
  `src/lib/commentFormat.ts`, `embedded.ts` and `sidecar.ts` are welcome as
  pointers, but no rule is stated *only* by naming an identifier — every rule
  is spelled out in prose, JSON, or a table that stands on its own.
- **(Req 36)** The document states explicitly, in its own right (not in a
  footnote), that the comment-format version is independent of the Marky Mark
  application version: `1.0.0` of the format has nothing to do with
  `0.4.0-alpha.4` of the app, and the two move separately.
- The document is reachable from the repo's existing map:
  `docs/ARCHITECTURE.md`'s "Comment storage: sidecar or embedded" section
  (~line 245) links to it, and its stale trailer snippet (~line 255, still
  showing `{"version":1,…}`) is corrected to the `"1.0.0"` string this build
  writes. `CONTRIBUTING.md` links to it as part of Req 38 below.

### What the document contains (Req 35)

- **The complete 1.0.0 payload schema.** Every key of the payload object
  (`version`, `comments`) and of a comment, a reply and an anchor, with its
  JSON type, whether it is required, and what it means — matching
  `src/lib/anchoring.ts` (`CommentData`, `ThreadReply`, `Anchor`) and the key
  lists in `commentFormat.ts` (`COMMENT_KEYS`, `REPLY_KEYS`, `ANCHOR_KEYS`).
  The anchor's coordinate space is stated, not assumed: `start`/`end` are
  character offsets into the document's *rendered plain text*, `prefix`/
  `suffix` are 32 characters of context. At least one complete, valid worked
  payload appears verbatim, and it round-trips through the real parser (see
  the drift test below).
  - The in-memory-only fields `extra` and `extraVersion` are **not** part of
    the wire schema and are documented as such if mentioned at all — a retained
    key is re-emitted at the level it was read from, never inside an `extra`
    object.
- **(Req 25)** The schema section records, per field, the **minimum format
  version that field requires** (every field today: 1.0.0), and states that
  every future field addition must record the same, so the lowest-version write
  rule (Req 23) stays computable as the format grows.
- **Both container forms**, each precisely enough to produce and consume:
  - The embedded trailer: the exact `<!-- marky-mark-comments` … `-->` block,
    its position at the very end of the file, the newline layout, the
    permanently accepted legacy `markimark-comments` marker on read
    (**Req 33**), the rewriting of every `-->` in the JSON text into the
    escaped hyphen form `serializeTrailer` emits (the exact escape sequence,
    quoted from `src/lib/embedded.ts`) and why `JSON.parse` restores it
    losslessly, and the rule that a document with zero comments carries no
    trailer at all rather than an empty versioned one.
  - The sidecar: the `<doc>.comments.json` filename pattern, 2-space
    pretty-printed JSON with a trailing newline, and that the file is removed
    when the last comment goes.
- **(Reqs 7–10) The MAJOR / MINOR / PATCH table**, stating the three rules
  verbatim in substance, with **at least one concrete worked example per
  component, drawn from this codebase** — e.g. MAJOR: changing what an anchor's
  `start`/`end` count, or dropping `prefix`/`suffix`; MINOR: adding an optional
  colour or mention field to a comment that an older reader ignores; PATCH: the
  `-->` escape or a key-order/whitespace change that produces byte-different
  but schema-identical output. The examples name real fields of the schema
  above; the exact choices are the implementer's.
- **The reader rules (PRD sections C and D)**: version resolution (integer `1`
  → 1.0.0; absent → 1.0.0; present but not a `MAJOR.MINOR.PATCH` string →
  *not* 1.0.0, treated as uninterpretable); comparison on MAJOR then MINOR with
  PATCH never deciding; an unsupported store contributing **zero** comments
  while the markdown still opens and edits; its bytes preserved exactly across
  open → edit → save; comment authoring disabled for the whole document while
  any store is unsupported; a persistent (non-toast) indication; per-store
  verdicts, so a supported sidecar still shows its comments beside an
  unsupported trailer; a newer minor of a supported major parsed normally with
  unrecognized keys retained per object and re-emitted verbatim, never
  shadowing a known key; and an entry failing the schema check skipped
  individually rather than crashing the parse.
- **The writer rules (PRD section E)**: the stamped version is the **lowest**
  version capable of representing the data being written, not the build's
  supported version; retained fields from a newer version keep that newer
  version on save; both containers carry the same payload schema and the same
  `version` key; serialization is byte-stable and idempotent.
- **(Reqs 32, 34) The frozen-container rule**: the trailer marker and the
  `<doc>.comments.json` filename never change again, in 1.x or in any later
  major, and all future evolution happens inside the JSON payload — **with its
  reason stated**: the version field lives *inside* the container, so a reader
  that does not recognize the container never reaches the version and cannot be
  warned. The legacy marker alias is permanent, not deprecated.
- **A changelog section** whose first (and today only) entry is **1.0.0**,
  describing it as the shape that shipped, dated, and formatted so that later
  entries append cleanly (newest-first or oldest-first is the implementer's
  call, as long as the document says which and CONTRIBUTING matches).

### The document matches shipped behaviour, not the PRD's summary of it

- Every rule stated is true of the code on this branch as of #16. Where the PRD
  is less specific than the implementation, the document describes the
  implementation. In particular, check and state correctly:
  - `isSupportedVersion` in `src/lib/commentFormat.ts` requires the MAJOR to
    **equal** the build's supported MAJOR and the MINOR to be **greater than or
    equal to** the supported MINOR — so a *lower* major or a lower minor with
    no registered migration step is also not interpreted. An outside
    implementer must not be told "anything ≤ the supported version is read".
  - A payload that is not a JSON object at all (null, array, string, number)
    declares no version, so it resolves to 1.0.0 and yields zero comments.
  - A trailer whose JSON does not parse is unreadable; its bytes are preserved
    like any unsupported store.
  - `version` is the only versioning key — no `formatVersion`, no parallel
    `major`/`minor`.
- If any statement the PRD asks for would be **false** of the shipped code, the
  document states the shipped truth and the discrepancy is called out in the
  issue comment. Changing `src/lib/*.ts` behaviour to match a doc sentence is
  out of scope here — #14/#15/#16 settled that behaviour.

### CONTRIBUTING (Req 38)

- `CONTRIBUTING.md` requires any PR that changes the comment payload to (a)
  bump the `version` per the MAJOR/MINOR/PATCH rules of
  `docs/COMMENT-FORMAT.md`, and (b) append an entry to that document's
  changelog. It links to `docs/COMMENT-FORMAT.md` and is worded as a gate a
  reviewer can apply, in the existing "Pull requests" list style.
- The existing item 3 ("Keep the comment sidecar/trailer formats stable —
  they're interoperable with the sibling `md-with-comments` project") is
  reconciled with the new rule rather than left to contradict it: the container
  is frozen (Reqs 32/33), the payload may evolve under the bump rule.
- No other CONTRIBUTING content is rewritten, and its command list keeps naming
  only scripts that exist in `package.json`.

### Scope

- **Documentation only.** No change to `src/lib/commentFormat.ts`,
  `embedded.ts`, `sidecar.ts`, `src/App.tsx`, `CommentCard.tsx` or `styles.css`
  is required, expected, or in scope. The container stays frozen: the
  `marky-mark-comments` marker, the permanent `markimark-comments` read alias
  and the `<doc>.comments.json` pattern are untouched.
- No PRD non-goal is touched: no downgrade path, no version UI/setting/picker,
  no versioning of `settings.ts`, `workspace.ts`, `drafts.ts`,
  `readingPositions.ts` or `recentFiles.ts`, and no version on `exportDoc.ts`
  or `reviewBundle.ts` output.
- No new `docs/specs/SPEC*.md` delta is written — this PRD's sub-issues have
  not added one, and `docs/COMMENT-FORMAT.md` is itself the published artifact.

### Tests and gate

- One new numbered unit test (**U147** onward — U146 is the current maximum,
  in `tests/unit/comment-format.test.ts`) is a **drift guard**: it reads
  `docs/COMMENT-FORMAT.md` from disk (vitest runs in the `node` environment;
  `tests/unit/licenses.test.ts` is the precedent for a test that reaches out of
  `src/`) and asserts at least:
  - the version the document presents as current, and its first changelog
    entry, are `SUPPORTED_COMMENT_FORMAT_VERSION` /
    `BASELINE_COMMENT_FORMAT_VERSION` from `src/lib/commentFormat.ts` — so
    bumping the constants without touching the document fails the gate;
  - the frozen container strings in the document are the real ones: a trailer
    written with the documented marker parses via `splitEmbedded`, the legacy
    marker still parses, and `sidecarPathFor('a.md')` is the documented
    `a.md.comments.json`;
  - the document's worked example payload parses through `readCommentPayload`
    to the comments it claims, so a schema example cannot rot silently.
- No new e2e test is needed (no user-visible behaviour changes); E numbers are
  untouched. Existing tests are not weakened, skipped, or deleted, and numbers
  are never reused (CONTRIBUTING.md).
- The implementer iterated with `npm run typecheck` and a tight unit loop
  (`npx vitest run tests/unit/comment-format.test.ts`), and ran the full gate
  below exactly **once**, right before declaring the goal met — not after every
  change. Any baseline at the start of the attempt used the quick tier only.
- `npm run validate:quick` has been run in the implementer's session and
  printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #17, naming the files
  changed, mapping each in-scope PRD requirement (7–10, 25, 32–38) to where the
  document satisfies it, giving the drift test's id, noting any place the
  document had to describe shipped behaviour the PRD stated loosely, and citing
  the gate evidence.

## Context

Last of four sub-issues under `prd/004-comment-format-versioning.md` (#14 the
seam → #15 both stores through the seam → #16 app behaviour → **#17 the
published document**). In-scope requirements are 7–10, 25 and 32–38; the issue
body lists them verbatim. #14/#15/#16 are already merged on this branch
(`b2426cc`, `d33c20b`, `9be20d6`, `a11f7c1`), so the document describes shipped
reality — read the code, not the PRD, when the two could differ.

Sources of truth for the document: `src/lib/commentFormat.ts` (the seam — the
version constants, `parseFormatVersion`/`compareFormatVersions`, the migration
table for the integer-`1` and no-`version` legacy coercions, the key lists, the
unknown-key bag, `stampedFormatVersion`, `commentPayload`);
`src/lib/embedded.ts` (`TRAILER_RE`, the `-->` escape, `serializeTrailer`,
`attachEmbedded`'s preserved-bytes argument, `mergeComments`);
`src/lib/sidecar.ts` (`sidecarPathFor`, `readSidecar`, `serializeSidecar`);
`src/lib/anchoring.ts` (`CommentData`, `ThreadReply`, `Anchor`, `RetainedKeys`,
`CONTEXT_LENGTH`); and `src/App.tsx` for the app-level consequences #16 landed
(byte preservation on save, authoring disabled, the persistent indication).
`tests/unit/comment-format.test.ts` (U131–U146) and
`tests/frozen/alpha4-reader.ts` show the behaviour already asserted and are
good raw material for the document's examples.

`docs/ARCHITECTURE.md` §"Comment storage: sidecar or embedded" and §"v5 polish"
already describe the containers informally; the new document supersedes them on
format detail and they should point at it. `npm run validate:quick` runs
version lock-step + typecheck + unit + desktop-shim e2e and prints
`QUICK VALIDATION: ALL PASSED`; the full `npm run validate` is not required by
this spec.
