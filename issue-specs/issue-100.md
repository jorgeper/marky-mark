# Spec: GitHub StorageProvider: commit-per-mutation behind the existing storage seam (#100)

## Goal

All acceptance criteria in issue-specs/issue-100.md are satisfied for issue
#100, with evidence visible in the session: a `StorageProvider` implementation
backed by a GitHub repo branch passes the same contract suite as the in-memory
reference provider, every seam mutation lands exactly one commit whose author
line carries the signed-in user's display name and whose committer is the app,
opaque ETags round-trip so a stale conditional write still fails with 412 and
`.mmkeep` folder markers are ordinary committed files, server-side caching never
decides a write from stale state and GitHub rate-limit/transient failures
surface as actionable errors rather than hangs or silent data loss, the provider
is still not selectable by configuration and `src/` is untouched,
`npm run validate:quick` passes in the implementer's session, and a summary
comment from the implementer exists on issue #100.

## Acceptance criteria

### The provider behind the existing seam (Req 2)

- A new server module (suggested: `server/providers/github/storage.ts`) exports
  a factory returning a `StorageProvider` from `server/providers/types.ts` —
  `kind`, `init?`, `read`, `write`, `writeIfMatch`, `readBytes`, `writeBytes`,
  `delete`, `list` — implemented against a GitHub repo branch. The interface in
  `types.ts` is **not** widened for GitHub's benefit except as the author
  criterion below allows; `server/app.ts`, `server/workspaces.ts` and
  `server/userFiles.ts` keep calling the seam exactly as they do today.
- The factory takes its target and its transport as arguments — owner, repo,
  branch, optional root prefix, the GitHub App auth from `#99`
  (`server/providers/github/auth.ts`), an injectable `fetch`-shaped function and
  an API base URL — the same injection shape as
  `createGraphDirectoryProvider(fetchImpl)`. Constructing it performs no I/O.
- Storage paths are the seam's paths: `workspaces/<uuid>/…` and `users/…` land
  at those repo-relative paths under the configured root, unchanged in shape.
  Workspace ids stay opaque; nothing about the repo leaks into a path the client
  sees.
- `api.github.com` (or any `github.com` host) still appears in **exactly one
  place** in `server/` — the `GITHUB_API_BASE` constant in
  `github/auth.ts` — and nowhere in `tests/`. This is stated as a grep with its
  result in the implementer's issue comment.
- No client change: `src/` is untouched, `src/platform/hosted.ts` works against
  the provider without protocol changes, and no GitHub call is ever made from
  the client (SPEC11's fetch allowlist stands).

### One commit per mutation, attributed to the acting user (Req 7)

- Every mutating seam call — `write`, `writeIfMatch`, `writeBytes`, `delete` —
  lands **exactly one commit** on the workspace's branch. A unit test pins the
  commit count against the fake for a save, an upload, a folder create and a
  delete. (Multi-path operations that the API layer already expresses as several
  seam calls — folder rename, workspace delete — therefore produce one commit
  per affected path; this issue adds no batching hook to the seam and none is
  expected.)
- The commit **author** name is the signed-in user's display name (as resolved
  by the auth provider); the **committer** is a fixed app identity (a
  Marky Mark name plus a `noreply`-style address defined in one place). The
  commit **message names the action and the path** — e.g. `Save
  workspaces/<id>/files/notes.md` — readable in the repo's history without the
  app.
- The acting user reaches the provider through an explicit, typed mechanism
  threaded from the request (for example an optional seam method returning a
  per-request view bound to an `AuthUser`, or an explicit author argument) —
  **not** a mutable module-global "current user". A unit test pins that two
  concurrent in-flight writes by different users are attributed correctly and
  never cross-attribute.
- When no acting user is available for a call path, the commit still succeeds
  with the app identity as author. A missing display name never fails or hangs a
  save.
- Anything added to `server/providers/types.ts` for authorship is **optional**,
  so `blob.ts` and the in-memory reference provider compile and behave
  unchanged.

### ETag semantics survive (Req 8)

- `read`/`readBytes`/`list` return an **opaque** version token derived from
  GitHub state (the blob SHA is the natural choice). The client and the API
  layer only ever round-trip it; no caller parses it.
- A conditional write (`writeIfMatch`) whose token no longer matches the stored
  file resolves **null with the stored content untouched**, so
  `server/workspaces.ts` answers **412** exactly as it does today. Pinned by a
  test that changes the file out of band in the fake between read and write.
- An unconditional `write`/`writeBytes` (no If-Match) remains a deliberate
  overwrite and succeeds against a changed file.
- A conditional write is implemented so GitHub itself adjudicates it (the
  Contents API `PUT` carries the SHA that was read; the fake answers 409 on
  mismatch). A 409 maps to `null`, never to a thrown 500 and never to a retry
  that overwrites.
- Merge-on-save is explicitly **out of scope** — stale conditional saves fail
  with 412 here; the three-way merge is #102 (PRD 010 Req 12).

### Folder placeholders and byte fidelity (Req 9)

- Creating an empty folder writes the existing `.mmkeep` marker
  (`FOLDER_PLACEHOLDER` in `server/workspaces.ts`) as a committed file at the
  folder path, and the client keeps hiding it — no GitHub-specific marker and no
  client change.
- `list(prefix)` enumerates files under the prefix including `.mmkeep`, with the
  `FileStat` fields populated (`path`, `size`, `lastModified`, `etag`); an empty
  prefix lists everything under the configured root, and no repo-side directory
  entry leaks into the results as a file.
- Binary round-trip holds: `writeBytes` of PNG bytes followed by `readBytes`
  returns **byte-identical** data, and the returned `contentType` is derived
  from the path extension (GitHub stores no media type) — a `.png` reads back as
  `image/png`. Pinned by a test with real non-UTF-8 bytes.

### Server-side caching without stale write decisions (Req 10)

- The provider caches repo state server-side so repeated reads do not pay a
  GitHub round trip per request; a cache-hit read issues **zero** GitHub
  requests, pinned against the fake's request log.
- Cache correctness is anchored on ref/SHA comparison: when the branch head
  moves (including from an out-of-band change made directly in the fake), the
  cache stops serving the superseded content.
- A write decision is **never** taken from stale cache state: a conditional
  write against a file the cache still believes is current, but which changed
  out of band, resolves `null` (→ 412) rather than succeeding. Pinned by a test
  that primes the cache, mutates the fake behind its back, and asserts both the
  412 outcome and that the subsequent read reflects the new head.

### Rate limits and transient failures (Req 11)

- A GitHub rate-limit response (403 with rate-limit headers) and a transient 5xx
  surface as a thrown error whose message names the status and the operation and
  is actionable — reaching the client as the existing 500/notice pathway in
  `server/app.ts`, never as a silent success, never as a hung save, never as
  data loss.
- Any retry is **bounded and terminating** (no unbounded loop, no retry of a
  non-idempotent write that could double-commit). A test using the fake's
  `queueRateLimit()` / `queueServerError()` pins that the call returns/throws
  promptly and that the repo state is unchanged after a failed write.
- No credential, App JWT, or installation token appears in any error message or
  log line the provider produces.

### Contract tests and the fake (Req 22, this issue's share)

- The `StorageProvider` contract is exercised from a **reusable suite** that
  both the in-memory reference provider (today inline in
  `tests/unit/server-workspaces.test.ts`) and the GitHub provider pass —
  extracted to a shared test helper rather than copy-pasted. Existing tests keep
  passing; `server-workspaces.test.ts` still covers the HTTP layer over the
  in-memory provider.
- The contract suite covers at minimum: read of a missing path → null; write
  then read; a new etag per write; `writeIfMatch` success and mismatch→null;
  `readBytes`/`writeBytes` fidelity and content type; `delete` of a present and
  an absent path; `list` by prefix and empty prefix.
- The GitHub fake (`server/providers/github/fake.ts`) is extended as needed and
  remains the only GitHub any test talks to — no test performs a network
  request, and the unit suite passes with the machine offline. Extensions
  expected: commit author/committer recorded and inspectable, file content
  stored as **bytes** (today's utf8 `string` mangles a PNG), and whatever
  listing surface `list` needs. Existing fake behaviour and
  `tests/unit/server-github-fake.test.ts` keep passing.
- New unit tests live in `tests/unit/` following the server naming (suggested
  `server-github-storage.test.ts`), titles start with the next unused `U<n>`
  (**the current maximum is U373, so new tests begin at U374**), and `describe`
  blocks name the contract (`describe('PRD 010 Req 7 …')`).
- Every new or changed behaviour carries the citation comment the repo requires
  (`// PRD 010 Req <n>: <what and why>`), per `.sandcastle/CODING_STANDARDS.md` §
  Style and `docs/COMMENT-FORMAT.md`.

### Scope boundaries — what this issue does NOT do

- **Not selectable by configuration.** `server/providers/index.ts` still returns
  the same provider set for `local` and `azure` (U224 keeps passing unchanged);
  the `blob|github` knob, the per-workspace backend record, and repo-reachability
  startup validation are **#101**.
- Merge-on-save is **#102**; the BYO connection record, the human-readable
  repo layout and `.marky-mark/` metadata are **#103**; the wizard is **#104**;
  the hosting guide and delete-copy correction are **#106**; the e2e matrix is
  **#107**.
- No user-visible behaviour changes, `src/` is untouched, and `docs/MAP.md` (generated
  from `src/` and `tests/e2e/` only) needs no regeneration — `npm run map` is not
  part of this issue. `server/README.md` gains only what a new optional
  configuration surface actually requires.

### Verification

- Iteration used `npm run typecheck` and `npm run test:unit` (or a targeted
  `npx vitest run tests/unit/server-github-*.test.ts`) after each change — not
  the full gate after every edit, and no full-gate baseline at the start of the
  attempt. Baseline with the quick tier only if a baseline is wanted at all.
- `npm run validate:quick` has been run **ONCE**, at the end, in the
  implementer's session, and prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #100, naming the new
  module path, the new U numbers, the single-`api.github.com` grep result, and
  the gate result.

## Context

PRD 010 (`prd/010-github-repo-storage.md`, parent #97) adds GitHub as a peer of
Azure Blob behind the PRD 007 storage seam. #99 already landed
`server/providers/github/auth.ts` (App JWT → cached installation tokens,
`GITHUB_API_BASE` as the one host constant) and `server/providers/github/fake.ts`
(installations, contents GET/PUT/DELETE with SHA-conditional writes and 409s,
`git/ref/heads/<branch>`, `commits`, scripted rate-limit/5xx, request log,
deterministic git blob SHAs, injectable clock, usable both as a `fetch` and as a
`node:http` listener). This issue is the provider on top of that. Keep the blast
radius to `server/` + `tests/unit/`.

Files worth reading first:

- `server/providers/types.ts` — the `StorageProvider` contract, method by
  method, with the PRD 007 Req 20 rationale for `writeIfMatch`.
- `server/providers/azure/blob.ts` — the reference implementation of the same
  eight operations, including how it maps a conditional-write failure to `null`
  and how it fills `FileStat`.
- `tests/unit/server-workspaces.test.ts` lines 17–85 — the in-memory reference
  provider whose suite the GitHub provider must also pass.
- `server/workspaces.ts` — the callers: `FOLDER_PLACEHOLDER`, the 412 path
  around `writeIfMatch` (~line 770), the byte paths (`writeBytes`/`readBytes`),
  and `contentTypeFor` (a private helper; the provider needs an equivalent
  extension→media-type mapping and should share rather than duplicate it).
- `issue-specs/issue-99.md` — the conventions this issue continues (injected
  fetch, never-log rule, no PAT, `.ts` import extensions for server code).

Gotchas:

- The server runs under plain `node server/index.ts` (native type stripping), so
  new server imports keep the explicit `.ts` extension.
- The unit suite runs with `isolate: false` (`vitest.config.ts`): inject the
  fake, never monkey-patch `globalThis.fetch`, and do not leak global state
  between files.
- The fake's `RepoState.files` is `Map<string, string>` (utf8). Byte fidelity
  for pasted images requires moving it to bytes — do that before writing the
  `writeBytes` test, or the test will pass for the wrong reason.
- GitHub's Contents API returns no last-modified per file; deriving
  `FileStat.lastModified` from commit data is acceptable, and an empty string is
  acceptable where GitHub gives nothing, as long as the JSON stays well-formed
  (nothing in `src/` renders it today).
- A GitHub `DELETE` of contents requires the current SHA, so `delete` reads
  before it deletes; keep that from becoming an unconditional-overwrite path.
