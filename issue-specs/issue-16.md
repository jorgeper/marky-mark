# Spec: App behaviour for an unsupported comment store: byte preservation, disabled authoring, persistent indication (#16)

## Goal

All acceptance criteria in issue-specs/issue-16.md are satisfied for issue #16, with
evidence visible in the session: a document whose trailer or sidecar declares a
version this build may not interpret still opens, renders and edits normally
while that store's bytes survive an open → edit → save round-trip
byte-for-byte (the trailer re-emitted verbatim, an unreadable sidecar never
written to or deleted); every comment-authoring path — new comment, edit,
reply, resolve, delete — is disabled for that document while a readable store's
comments still show; a **persistent** indication (not the 4-second `mm-notice`
toast) says for as long as the document is open that its comments were written
by a newer version of Marky Mark; new numbered tests (U144 onward, E137 onward)
cover byte preservation, disabled authoring, the persistence of the indication
and the PRD's compatibility evidence (Reqs 39–41); `npm run validate:quick`
prints `QUICK VALIDATION: ALL PASSED`; and a summary comment from the
implementer exists on issue #16.

## Acceptance criteria

### The unreadable-store state reaches the app

- `src/App.tsx` knows, per open document, which of the two stores this build
  could not interpret. `loadDocParts` (~line 966) already gets
  `SplitDoc.readable` / `declaredVersion` from `splitEmbedded` and can get the
  same from `readSidecar` in `src/lib/sidecar.ts` (`parseSidecar` is the
  comments-only view); it now returns that verdict alongside `content` and
  `comments` instead of discarding it.
- The verdict follows the document, not the session. It is set on every path
  that loads a document — `openDoc`, the file watcher's reload
  (~line 1344), and the parked-bundle restore of SPEC36 (`parkRef`, ~line 304 /
  `parkActive` ~line 1177) — and is cleared when a document is closed or
  replaced by an untitled buffer (the existing `setComments([])` sites,
  ~lines 1548 and 2444). Switching tabs away from an affected document and back
  restores its state; a clean document opened next never inherits it.
- **(Req 13)** The markdown document still opens, renders, and edits normally in
  that state. Only comment data is withheld: no blocked open, no read-only
  editor, no modal, no change to the diff, find, export, folder or word-count
  surfaces.
- An unreadable store means `readable === false` from the store layer, which
  today covers both an unsupported/uninterpretable version (PRD Reqs 5 and 12)
  and a trailer whose JSON does not parse (U143). Both get the byte-preservation
  and frozen-authoring behaviour below, because destroying corrupt-but-present
  comment data is exactly the loss this PRD exists to stop. The indication's
  wording differs: the newer-version wording of Req 16 is used when a version
  was declared, and a plainer "could not be read" wording when there is none.

### Byte preservation (Req 14)

- Saving a document with an unreadable **trailer** writes the modified markdown
  content followed by the original trailer block **byte-for-byte** — the same
  bytes `splitEmbedded` stripped, including its JSON text, whitespace, and the
  `marky-mark-comments` or legacy `markimark-comments` marker as it was found.
  A round-trip of open → edit text → save leaves the comment payload
  bit-identical, and re-saving repeatedly keeps it so.
- An unreadable **sidecar** file is not written to at all, and is not deleted.
  In particular `persistComments` (~line 1709) must not take its
  embedded-storage branch's "clean up a stale sidecar" removal, nor its
  zero-comment `p.remove(sidecar)` branch, against an unreadable sidecar.
- No comment-store migration runs for a document with an unreadable store. With
  `commentStorage: 'embedded'` and an unreadable trailer, the save must not
  serialize the merged comment set into the trailer position; with
  `commentStorage: 'sidecar'` and an unreadable trailer, the save must not drop
  the trailer as today's embedded→sidecar migration does (`saveDoc` ~line 2341
  writes trailer-free text). Both stores of that document keep the bytes they
  had; only the markdown content changes.
- The exact trailer bytes come from the store layer, not from a regex re-run in
  `App.tsx`: `splitEmbedded` exposes the raw block it stripped (issue #15 left
  this "permitted but not required"), and the composition of content + preserved
  trailer is a **pure, exported, unit-tested** function in `src/lib/embedded.ts`
  — `attachEmbedded` gaining an optional preserved-trailer argument, or a
  sibling function, is the implementer's call. `attachEmbedded`'s
  never-double-attach property holds for the preserving path too.
- `saveDocAs` (~line 2316) carries the preserved trailer bytes into the new
  file, so Save As on such a document does not silently drop them. Copying an
  unreadable **sidecar** to the new path is explicitly out of scope; the source
  sidecar is left untouched either way.

### Comment authoring is disabled (Reqs 15, 17)

- **(Req 17)** When *any* store of the open document is unreadable, authoring is
  disabled for the **whole** document — including the case where the trailer is
  unreadable but the sidecar is at a supported version, and vice versa.
- **(Req 17)** The readable store still shows its comments. A document with an
  unreadable trailer and a supported sidecar renders the sidecar's comments,
  their marks, the navigator and the panel exactly as today; they are simply
  not editable.
- Every authoring entry point is closed for such a document, each asserted:
  - the `add-comment-btn` selection button does not appear (~line 4242);
  - type-to-comment does not open a composer (the effect at ~line 3752), and
    `startComposer` (~line 3740) opens none by any other route;
  - `CommentCard` renders read-only: no `reply-btn`, `edit-btn`, `edit-reply`,
    `delete-reply`, `resolve-btn`, `reopen-btn` or `delete-btn` — for open,
    resolved and ghosted cards alike, and for cards inside the collapsed
    `resolved-section`.
- `CommentCard` takes the read-only state as an explicit prop (default =
  editable) rather than inferring it, so every existing call site and every
  existing E-test of the comment UI keeps its current behaviour.
- No `setComments` mutation can be reached for such a document, so nothing ever
  calls `persistComments` with a partial set. A defensive early return in
  `persistComments` for the unreadable case is welcome but does not replace
  closing the UI paths above.

### The persistent indication (Req 16)

- A persistent element with a stable `data-testid` renders whenever the active
  document has an unreadable store, and it is **not** `.mm-notice` /
  `data-testid="notice"` and does not go through `showNotice`, whose 4-second
  timer (~line 847) is exactly what Req 16 rules out.
- It remains visible for as long as the document is open: still there more than
  4 seconds after the document opened, still there after switching between
  preview and edit mode, and still there whether or not the comments panel is
  visible (the panel needs preview/split mode and a non-empty comment set;
  the indication does not). It has no auto-dismiss and no control that hides it
  for the rest of the document's life.
- It disappears when a document without an unreadable store becomes active, and
  comes back on switching back.
- Its text says the document's comments were written by a newer version of
  Marky Mark and cannot be shown, and names the version as declared when there
  is one (per the wording rule above for a version-less unreadable store).
- When the comments master switch is off (`settings.commentsEnabled === false`,
  SPEC7 §2 — the comments UI is gone, menu included) the indication is not
  shown. Byte preservation and the no-write rule still apply in that state.
- Styling uses the existing theme custom properties (`--mm-*`) as the
  neighbouring chrome in `src/styles.css` does; no hard-coded colours.

### Compatibility evidence (Reqs 39–41)

- **(Req 39)** A test proves a file written by the new build is read correctly
  by the **shipped `0.4.0-alpha.4`** parsing logic. Recover that logic with
  `git show v0.4.0-alpha.4:src/lib/embedded.ts` and
  `git show v0.4.0-alpha.4:src/lib/sidecar.ts`, transcribe the parse path into a
  frozen helper under `tests/` (a plain module, not an import from `src/`),
  comment it as frozen — it is a record of a released build and is never updated
  to track `src/` — and assert it recovers the same comments from today's
  `serializeTrailer` and `serializeSidecar` output, i.e. that `"version"` being
  the string `"1.0.0"` rather than the integer `1` does not disturb a reader
  that ignores the field.
- **(Req 40)** The three legacy reads are covered — an embedded trailer with
  `"version":1`, a sidecar with no `version` key, and a trailer using the
  `markimark-comments` marker all load their comments. U142 already asserts
  this; confirm it still passes and cite it rather than duplicating it.
- **(Req 41)** The PRD's full test list is satisfied across the suite. Already
  landed by #15 and to be confirmed still present and passing: each legacy
  coercion (U142), a newer-minor store whose unknown fields survive a
  round-trip (U135, U139), the version-retention rule of Req 21 (U139), the
  lowest-version write rule of Req 23 (U138), and a malformed version string
  treated as newer-major (U133/U131). New here: a newer-major store preserved
  **byte-for-byte** across an open → edit → save cycle, and comment authoring
  **disabled** for a newer-major document. The summary comment on the issue maps
  each of the seven items to the test id that covers it.

### Scope

- The store layer changes only as far as exposing the trailer's raw bytes and
  the preserving composition requires. The seam (`src/lib/commentFormat.ts`)
  needs no change: the version decision, the migration table, unknown-key
  retention and the stamped version are all settled by #14/#15.
- `docs/COMMENT-FORMAT.md`, the `CONTRIBUTING.md` bump rule and the PRD's
  section H are issue #17 and are **not** written here.
- No PRD non-goal is touched: no downgrade path for a newer-major file, no
  version UI/setting/picker, no change to `mergeComments`' trailer-wins-by-id
  semantics, no versioning of `settings.ts`, `workspace.ts`, `drafts.ts`,
  `readingPositions.ts` or `recentFiles.ts`, and no change to `exportDoc.ts` or
  `reviewBundle.ts`.
- The container stays frozen (Reqs 32/33): the `marky-mark-comments` marker, the
  permanent `markimark-comments` read alias, and the `<doc>.comments.json`
  filename pattern are unchanged.

### Tests and gate

- New numbered unit tests start at **U144** (U143 is the current maximum) and
  new desktop e2e tests at **E137** (E136 is the current maximum). Numbers are
  never reused (CONTRIBUTING.md); existing tests are extended, never weakened,
  skipped, or deleted.
- Unit coverage, each with its own assertion: the raw trailer bytes reported by
  `splitEmbedded` for a `2.0.0` trailer, a legacy-marker trailer and a trailer
  whose JSON does not parse; the preserving composition reproducing those bytes
  exactly after the content changed, including a trailer containing an escaped
  `-->`; the composition staying idempotent across repeated saves; and the
  Req 39 frozen-reader assertion above.
- Desktop e2e coverage through the browser shim (`__mmfs`, `fsRead`/`fsWrite` in
  `tests/e2e/helpers.ts`), each asserted end to end in the real app: seed a doc
  whose trailer declares `"2.0.0"`, open it, confirm it renders and edits, save
  via `menu-save`, and assert the trailer substring of the file on disk is
  byte-identical to what was seeded; assert no authoring control is reachable
  for it (selection shows no `add-comment-btn`, typing over a selection opens no
  composer, and any rendered card has no reply/edit/resolve/delete control);
  assert the indication is present, is not `data-testid="notice"`, and is still
  present more than 4 seconds after open; and assert the per-store case — an
  unreadable trailer beside a supported sidecar shows the sidecar's comments
  while authoring stays disabled, and the sidecar file is unchanged on disk
  after a save.
- The implementer iterated with `npm run typecheck` and `npm run test:unit` (or
  a tighter loop such as `npx vitest run tests/unit/embedded.test.ts
  tests/unit/comment-format.test.ts`, and `npx playwright test -g "E13"` for the
  new e2e), and ran the full gate below exactly **once**, right before declaring
  the goal met — not after every change. Any baseline at the start of the
  attempt used the quick tier only.
- `npm run validate:quick` has been run in the implementer's session and printed
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #16, naming the files
  changed, how the unreadable-store verdict reaches and leaves app state, where
  the preserved bytes are composed, the indication's `data-testid`, and the
  Req 41 item → test-id map plus the gate evidence.

## Context

Third of four sub-issues under `prd/004-comment-format-versioning.md`
(#14 seam → #15 stores through the seam → **#16 app behaviour** → #17 the
published document). In-scope requirements are 13–17 and 39–41; the issue body
lists them verbatim. #15 is already merged on this branch (commit `b2426cc`,
refined by `d33c20b`) and is what this issue builds on.

`src/lib/embedded.ts` (87 lines) already returns `readable` and
`declaredVersion` on `SplitDoc`, strips the trailer with `TRAILER_RE`, and
notes in its own doc comment that the app behaviour is this issue.
`src/lib/sidecar.ts` (51 lines) exposes `readSidecar` (`{comments, readable,
declaredVersion}`) and the comments-only `parseSidecar`.
`src/lib/commentFormat.ts` owns the version decision and needs no change.

`src/App.tsx` (4604 lines) is the only consumer: `loadDocParts` ~line 966,
`openDoc` ~line 1356, the watcher ~line 1334, `parkActive`/`parkRef` ~lines
304 and 1177, `persistComments` ~line 1709, `saveDocAs` ~line 2316, `saveDoc`
~line 2334, the composer and `submitComment`/`updateComment`/`deleteComment`
~lines 3740–3801, the comment panel ~line 3855, the `add-comment-btn` ~line
4242 and the `mm-notice` toast ~line 4262. `src/components/CommentCard.tsx`
holds every per-card control and its testids.

Tests: `tests/unit/*.test.ts` (vitest, `npm run test:unit`) with `U<n>` ids in
the title, `tests/e2e/app.spec.ts` with `E<n>` ids driven by the browser
platform shim (`freshApp`, `fsRead`, `fsWrite`, `selectPhrase` in
`tests/e2e/helpers.ts`; `WELCOME` is `/docs/welcome.md`). `npm run
validate:quick` runs version lock-step + typecheck + unit + desktop-shim e2e and
prints `QUICK VALIDATION: ALL PASSED`; the full `npm run validate` adds the web
build, web e2e and `cargo check` and is not required by this spec.
