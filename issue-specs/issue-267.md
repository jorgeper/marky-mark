# Spec: Hosted: pasting an image fails with 401 (#267)

## Goal

All acceptance criteria in issue-specs/issue-267.md are satisfied for issue
#267, with evidence visible in the session: the hosted raw binary PUT that
lands a pasted image authenticates exactly like the JSON save path so a
pasting member with the write verb gets a stored workspace blob instead of a
401, a genuinely expired/rejected session on that path surfaces as a re-auth
prompt rather than a dead paste, a regression test that fails without the fix
covers it, `npm run validate:quick` passes, and a summary comment from the
implementer exists on issue #267.

## Acceptance criteria

- The root cause of the 401 on `PUT <api-path>?raw=1` is identified and named
  in the implementer's summary comment on #267 — which of the issue's three
  candidates it was (auth credential lost on this branch / route-verb mapping
  the member's role does not grant / token-expiry handling differing from the
  JSON routes), or the actual cause if it is a fourth. The fix addresses that
  cause; it is not a blind change.
- On the hosted build, pasting an image into a **saved** workspace document
  while signed in with a valid session stores the bytes as a workspace blob
  under the document's image folder and inserts the markdown reference at the
  cursor — no 401, no "Couldn't save the pasted image" notice. This is the
  PRD 007 Req 8 / SPEC20 §2 end state that `src/platform/hosted.ts`
  `writeBinaryFile` already aims at.
- The pasted blob renders for every member holding `doc.read` — the existing
  end-to-end promise in `tests/e2e/hosted.spec.ts` E332 still holds and that
  test is neither weakened nor skipped.
- The raw binary write authenticates by the same mechanism as an ordinary
  hosted document save: whatever credential/refresh/retry behaviour the JSON
  `PUT /api/workspaces/<id>/files/<path>` path carries, the `?raw=1` variant
  carries it too. If the divergence was client-side, the shared
  `api()`/fetch seam in `src/platform/hosted.ts` is the single place that
  behaviour lives — the raw PUT does not grow a private copy.
- Server-side, a raw PUT is gated by the same verb table as the JSON PUT
  (`fileRouteVerb` in `server/workspaces.ts`: `file.create` for a path that
  holds nothing yet, `doc.edit` for an overwrite) and a member who lacks the
  verb still gets the named 403, not a 401 and not a silent success. Owner and
  Admin can paste.
- A 401 reaching the hosted image-write path is surfaced to the user as a real
  session-expired / sign-in-again outcome (the hosted sign-in gate's existing
  wording and flow — see `src/components/HostedSignIn.tsx` and
  `src/lib/hostedGate.ts`), never as a bare `binary write failed (401)` toast
  that leaves the paste dead with nothing the user can act on. A 403 keeps its
  existing named-permission refusal.
- A regression test covers the fix and fails against the pre-fix code. The
  cheap tier is preferred where the cause allows it: a raw-PUT case in
  `tests/unit/server-workspaces.test.ts` (in-process HTTP + mock auth) for a
  server-side or verb-mapping cause, or a mocked-fetch unit test for a
  client-side credential/expiry cause; add or extend a `tests/e2e/hosted.spec.ts`
  case only where the behaviour cannot be proven below e2e. New tests take the
  next unused `U<n>`/`E<n>` id per `.sandcastle/CODING_STANDARDS.md`.
- Changed behaviour carries a citation comment naming the contract it
  implements (`PRD 007 Req 8` / `SPEC20 §2`, plus the auth requirement it
  leans on), matching the surrounding style.
- Scope stays hosted-only: the desktop (Tauri) and single-file web platforms
  are untouched, and #266's Insert Image feature is NOT implemented here —
  but the upload path this issue repairs is left reusable by it (no
  paste-only special case that Insert Image would have to duplicate).
- `docs/MAP.md` is regenerated with `npm run map` if the spec→code citation
  set changed; it is never hand-edited.
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (or `npx playwright test -g '<title>'` for a single behaviour), and ran the
  full quick gate `npm run validate:quick` ONCE, right before declaring the
  goal met — not after every change and not as a start-of-attempt baseline
  beyond the quick tier. That final run printed
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #267, stating the
  root cause, the fix, the tests added, and the gate result.

## Context

The paste chain is `src/App.tsx` `pasteImages` (SPEC20 §2, ~line 1530) →
`Platform.writeBinaryFile` → `src/platform/hosted.ts` `writeBinaryFile`
(~line 634), which calls the module-local `api()` helper (~line 125) with
`PUT <apiPathFor(target)>?raw=1` and
`Content-Type: application/octet-stream`. `api()` stamps
`Authorization: Bearer ${token()}` on every request, and `token()` reads
localStorage via `readStoredToken` (`src/lib/hostedGate.ts`). Server side,
`server/app.ts` applies the single 401 guard (`sessionToken` accepts the
bearer header always, and `?access_token=` for GET only — an `<img>` cannot
send a header), then `server/workspaces.ts` `handleWorkspaceApi` reads
`raw=1` and routes the PUT through `fileRouteVerb` →`requirePermission`
(403 with a named verb) before `storage.writeBytes`.

Note that on this branch the client, the auth guard and the verb table all
look correct at a glance, and E332 exercises the whole paste flow green under
the mock auth provider — so the interesting difference is likely what the
real deployment does that the harness does not. Two leads worth checking
first: (1) there is **no token refresh anywhere in the client** — an Entra
access token is stored at sign-in and used until it expires, and
`server/providers/azure/entra.ts` `validateToken` returns null (→ 401) for an
expired token, for a wrong audience, and for an id_token with no
`access_as_user` `scp` (issue #184); (2) nothing in `src/` handles a 401 from
an API call after mount, so any expiry lands as whatever toast the caller
writes. Reproduce before fixing.

Useful reading: PRD 007 Req 5 (auth) and Req 8 (pasted images as blobs) in
`prd/007-azure-hosted-workspaces.md`; `server/README.md` for the hosted
server's shape; `tests/unit/server-workspaces.test.ts` for the in-process
HTTP harness. Issue #266 (hosted Insert Image) is blocked on this fix and
will reuse the repaired upload path.
