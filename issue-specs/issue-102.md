# Spec: Merge-on-save: three-way merge for stale conditional saves on git-backed workspaces (#102)

## Goal

All acceptance criteria in issue-specs/issue-102.md are satisfied for issue
#102, with evidence visible in the session: a pure three-way line merge that a
stale conditional save runs through **only** on git-backed workspaces — a clean
merge commits the merged text conditionally against the head it merged from and
answers 200 carrying the merged text and its new version token, a conflicting
one answers today's 412 and the unchanged Cancel/Overwrite/Reload dialog; a
merged save leaves the editor showing the merged text, clean (saved), cursor
preserved best-effort, with a non-blocking notice that someone else's changes
were merged in and no dialog; blob-backed workspaces behave verbatim as today
(every stale conditional save → 412 → dialog), pinned by the existing hosted
save-conflict tests staying green unchanged; `npm run validate:quick` passes in
the implementer's session; and a summary comment from the implementer exists on
issue #102.

## Acceptance criteria

### The merge itself — a pure function (Req 12)

- A three-way line merge exists as a **pure module** (suggested:
  `server/merge.ts`) — no I/O, no provider imports, no GitHub knowledge —
  taking `base` (the version the client loaded), `ours` (the client's text) and
  `theirs` (the current head) and answering either a clean merged text or "this
  conflicts". Req 22 (#107) names exactly this as the piece that must be
  testable as a pure function; write it so it is.
- **No new runtime dependency.** `diff-match-patch` is already in
  `dependencies` and `src/lib/diffLines.ts` is the in-repo precedent for a
  hand-rolled line diff — use one of those, do not add a package.
- Behaviour pinned by unit tests:
  - Edits to **non-overlapping line regions** merge clean, and the merged text
    contains both sides' changes.
  - `ours === theirs` (both saved the same text) is clean and yields that text.
  - `base === ours` (the client changed nothing) is clean and yields `theirs`.
  - The **same line region changed differently** on both sides conflicts.
  - One side **deleting** a region the other **edited** conflicts.
  - Newline fidelity: a file with no trailing newline stays without one, and a
    merge never rewrites line endings that neither side touched.
  - **Decision symmetry:** swapping `ours` and `theirs` never flips clean ↔
    conflict.

### Where the merge is reachable from — a storage capability, not a backend check (Req 12, Req 14)

- `StorageProvider` (`server/providers/types.ts`) gains **one optional member**
  for this, documented the way `asUser?` already is: a provider that omits it
  has no merge capability, and every caller behaves exactly as today. The
  capability must let the server obtain **the base content for an opaque
  version token** — that is the whole reason merge is a git-backend capability:
  a git blob is content-addressed, so the etag the client loaded still names
  retrievable bytes, and a blob-store ETag does not.
- The **Azure blob provider and the in-memory reference provider do not
  implement it.** `describeStorageContract` (`tests/unit/storage-contract.ts`)
  runs unchanged against both existing callers and their U-blocks stay green;
  request handling decides "can this workspace merge?" purely by whether the
  provider resolved for that workspace (via `WorkspaceBackends.forWorkspace`,
  `server/backends.ts`) offers the capability — **never** by branching on a
  backend name or `kind` string.
- The GitHub implementation (`server/providers/github/storage.ts`) resolves the
  base by its opaque etag through the git blobs API and answers **null** when
  the token names nothing it can resolve — a null base is a 412, never a guess.
  It adds **no new GitHub host string**: `api.github.com` still appears exactly
  once (in `GITHUB_API_BASE`) so **U370 stays green**. State that grep result in
  the issue comment.
- The head read that feeds a merge obeys Req 10: it is never served from a
  cache that the subsequent commit would not have detected — the same rule the
  conditional write already follows.
- GitHub rate limits and transient failures during a merge surface through the
  **existing failure vocabulary** (Req 11, the one introduced in #100) — never
  as a silent 412 and never as a hung save.

### The save route's decision (Req 12)

- In `server/workspaces.ts`, the conditional-save branch (today: `writeIfMatch`
  → null → `sendJson(res, 412, …)`) gains the merge attempt **between** those
  two steps, and only there. On a clean merge the server commits the merged
  text and answers **200** with today's fields plus a flag that the content was
  merged, the merged text, and its new version token.
- The merged commit is itself **conditional on the head version the merge was
  computed from**. If that write loses a further race the whole read-merge-write
  is retried a small bounded number of times (name the bound in the code) and
  then answers 412. **Never** an unconditional overwrite, and never a retry that
  could clobber the save that won.
- The merge does **not** run for: the raw-bytes route (`?raw`), writes with no
  `If-Match` (deliberate overwrites, including the user's Overwrite choice), or
  a provider without the capability. Each of those keeps its current code path
  byte-for-byte.
- **Structured-file guard:** a line merge can be clean and still structurally
  invalid. A clean merge for a `.json` path (the comment sidecars,
  `src/lib/sidecar.ts`) that does not `JSON.parse` is **refused → 412**, not
  committed. Carry a citation comment saying why.
- A merged save is one commit like any other mutation (Req 7): authored by the
  saving user, message naming the action and the path.
- On conflict the 412 response body is **unchanged** — same `error` string, same
  `path` — so the client's existing dialog path is untouched.

### The client's handling of a merged save (Req 13)

- `Platform.writeTextFile` (`src/platform/types.ts`) can report that the save was
  merged and carry the merged text. The signature stays compatible with callers
  that ignore the result, and `tauri.ts` / `browser.ts` / `web.ts` are unchanged
  in behaviour.
- `src/platform/hosted.ts`: a 200 carrying merged content re-arms the tracked
  etag from the response and reports the merged text upward; a 412 still throws
  `SaveConflictError`. No other response handling changes.
- After a merged save the in-app document state is **what a fresh open of the
  merged file would produce** — comments parsed per the active comment-storage
  mode, an embedded trailer handled the way `openDoc` handles it — and the
  buffer is **clean (saved)** at the merged state. No conflict dialog appears.
- Cursor/selection is preserved **best effort**: the caret is not reset to the
  top of the document, and a merged text shorter than the buffer clamps rather
  than throws. Exactness is explicitly not required.
- A **non-blocking** notice tells the user that changes from someone else were
  merged in, through the existing transient notice (`showNotice` /
  `data-testid="notice"`, `src/App.tsx`) so #107's e2e has a stable hook. It
  blocks nothing and self-dismisses.
- The decision "what a merged save does to the buffer, the saved marker and the
  notice" is expressed as a **pure function**, unit tested without a DOM, in the
  spirit of `planSaveConflict` (`src/lib/saveConflict.ts`) — `App.tsx` dispatches
  it rather than re-deciding inline.

### Blob-backed workspaces, verbatim (Req 14)

- No protocol change for blob: on a blob-backed workspace every stale
  conditional save is still a plain 412 with today's body, and the merged flag
  never appears in any response. Pinned by a route test driven through the
  in-memory reference provider.
- The existing hosted save-conflict e2e tests (Cancel / Reload / Overwrite in
  `tests/e2e/hosted.spec.ts`) pass **unchanged and unrenumbered**, and
  `src/lib/saveConflict.ts`'s existing three-choice plan keeps its current
  semantics.

### Tests, docs and verification

- New unit test ids continue the repo's block from the current maximum
  (**U414**) — next free is **U415**. No existing id is reused, renamed or
  renumbered. Cover at minimum: the pure merge cases listed above; the route
  answering a merged 200 over the GitHub fake (`server/providers/github/fake.ts`)
  and a 412 on a conflicting merge; the route answering a plain 412 with a
  capability-less provider; the `.json` guard; the bounded-retry-then-412 race;
  `hosted.ts` handling a merged response and re-arming the etag; and the pure
  client-side merged-save plan.
- **E2e for the merged and conflicting concurrent saves is #107's scope** (Req
  22) — do not add those specs here. No existing e2e may regress.
- Every new or changed behaviour carries a citation comment naming its contract
  (`PRD 010 Req 12` / `Req 13` / `Req 14`), per `.sandcastle/CODING_STANDARDS.md`.
- `server/README.md`'s storage section states the one-line difference: on a
  github-backed workspace a stale conditional save is merged when it can be and
  412s when it cannot; on blob it always 412s. The operator walkthrough is #106
  and is **not** in scope here.
- **Test economy.** Iterate with `npm run typecheck` and `npm run test:unit`
  (or a targeted `npx vitest run tests/unit/<file>` while working on one
  module). Baseline with the quick tier only. Run the full gate
  `npm run validate:quick` **once**, right before declaring the goal met — it
  must print `QUICK VALIDATION: ALL PASSED`. Do not run it after every change,
  and do not run `npm run validate` (release evidence only).
- A summary comment from the implementer exists on issue #102, naming what
  landed, the `api.github.com` grep result, and the quick-gate result.

## Context

The seam is already in place from #100 and #101: `server/providers/types.ts`
defines `StorageProvider` (note `asUser?` — the house pattern for an optional
capability), `server/providers/github/storage.ts` implements it against a repo
branch with `writeIfMatch` returning null on a lost race (its comment explicitly
defers merging to this issue), `server/providers/github/fake.ts` is the local
GitHub API fake every test drives, and `server/backends.ts` resolves which
provider backs a given workspace. The save route is the `PUT` branch near
`server/workspaces.ts:772-800`; the client half is
`src/platform/hosted.ts:277-293` (the 412 → `SaveConflictError` throw),
`src/lib/saveConflict.ts` (the pure three-choice plan), and `saveDoc` /
`resolveSaveConflict` / the dialog in `src/App.tsx` (~2930-3000 and ~5523).
Never read `App.tsx` whole — grep for `saveConflict` and `showNotice`.

Constraints worth re-reading before coding: PRD 010 Reqs 7-14 in
`prd/010-github-repo-storage.md`; the non-goal "**an in-app merge editor**" —
true conflicts keep the existing three-choice dialog, no conflict markers, no
pick-mine/pick-theirs UI; and SPEC11's client fetch allowlist, which forbids any
GitHub call from the client. `issue-specs/issue-100.md` and
`issue-specs/issue-101.md` show the expected level of detail and the citation
style for PRD-010 work.
