# Spec: Scratchpad server API: idempotent per-user resolve-or-create (#213)

## Goal

All acceptance criteria in issue-specs/issue-213.md are satisfied for issue
#213, with evidence visible in the session: a server scratchpad-resolution
endpoint exists that is keyed solely by the validated token identity and
returns the same workspace id on every call (creating it exactly once, even
under concurrent first calls); the created scratchpad is a real workspace —
opaque UUID id, normal manifest, caller as sole Owner, display name
`Scratchpad`; resolution succeeds even under a `members`/`restricted`
deployment creation policy while regular creation stays gated; and
`npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- (PRD 019 Req 5) A scratchpad-resolution endpoint exists under `/api/`
  behind the standard auth guard in `server/app.ts`. The user it resolves
  for comes only from the validated token (`auth.user.id`) — never from the
  URL, query, or body — matching the `server/userFiles.ts` pattern.
- (PRD 019 Req 5) The operation is resolve-or-create and idempotent: the
  first call creates the scratchpad workspace and records its id in the
  caller's per-user storage (`users/<id>/…`, via `userPrefix`); every
  subsequent call returns the same workspace id. A unit test proves that
  two sequential calls return one identical id and that exactly one
  workspace manifest exists afterwards.
- (PRD 019 Req 5) Two concurrent first calls yield exactly one scratchpad:
  a unit test drives overlapping resolves for the same user against the
  mock provider and asserts both return the same id and only one workspace
  was created (no orphan manifest left behind by the loser).
- (PRD 019 Req 6) The scratchpad is a real workspace created through the
  existing creation path in `server/workspaces.ts` (manifest built by
  `buildNewWorkspaceManifest`, opaque `randomUUID()` id, manifest written
  to the standard `workspaces/<id>/manifest.json` blob): the calling user
  is its sole Owner and its display name is `Scratchpad`. A unit test
  asserts the manifest shape (name, sole-Owner member, opaque id).
- (PRD 019 Req 7) Resolution succeeds for a caller whom the deployment
  creation policy (`members`/`restricted`, `deployment.creationFor`) would
  deny a New Workspace — a unit test shows a policy-denied user (e.g. a
  guest under `members`) still gets a scratchpad, while a regular
  `POST /api/workspaces` from the same caller still answers 403.
- No client wiring is part of this issue: no changes under `src/` are
  required, and hosted client behavior is unchanged.
- New server behavior carries citation comments in the file's existing
  style (`PRD 019 Req <n>: …`), per `.sandcastle/CODING_STANDARDS.md`.
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (or tests targeted at the changed code) after each change, and ran
  `npm run validate:quick` ONCE, right before declaring the goal met — not
  after every small change and not as a full-suite baseline at the start.
  It prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #213.

## Context

PRD: `prd/019-personal-scratchpad.md` (this issue is Reqs 5–7; the URL,
routing, listing, delete-refusal, and buffer behavior are other issues —
do not implement them). Parent: #211.

Key files: `server/workspaces.ts` (creation path — see the
`POST /api/workspaces` branch in `handleWorkspaceApi` for the
policy-gated flow this must reuse-but-bypass; `buildNewWorkspaceManifest`
is defined in `src/lib/hostedWorkspace.ts`), `server/userFiles.ts`
(`userPrefix`, the token-scoped per-user prefix), `server/app.ts` (route
registration and the auth guard), `server/deployment.ts`
(`creationFor`). Server unit tests live in `tests/unit/server-*.test.ts`;
`tests/unit/server-workspaces.test.ts` shows how to exercise handlers
against the mock providers (`server/providers/mock`).

Concurrency note: the `StorageProvider` seam (`server/providers/types.ts`)
has `write` and etag-conditional `writeIfMatch` but no create-if-absent.
Pick a strategy that guarantees one winner — e.g. add a conditional
create-if-absent to the seam (Azure blob supports `If-None-Match: *`;
implement it in both the azure and mock providers), or write-then-re-read
reconciliation where the loser deletes its orphan and adopts the recorded
id. The recorded-pointer blob under `users/<id>/…` is the source of truth
for "already provisioned".
