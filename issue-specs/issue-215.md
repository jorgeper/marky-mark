# Spec: Client /scratchpad route: one-step landing in a fresh scratch buffer (#215)

## Goal

All acceptance criteria in issue-specs/issue-215.md are satisfied for issue
#215, with evidence visible in the session: on a hosted deployment a
signed-in visit to `<base URL>/scratchpad` ends with the user's scratchpad
workspace open, a fresh untitled buffer focused in edit mode, and the
address bar rewritten via `history.replaceState` to the canonical
`/?workspace=<id>` form; an unauthenticated visit goes through the normal
hosted sign-in flow and still arrives there afterwards; the auto-opened
scratch buffer is exempt from the unsaved-changes prompt and close guard
(deliberate exits discard silently, crash drafts still shadow it); non-hosted
platforms are untouched; and `npm run validate:quick` passes in the
implementer's session.

## Acceptance criteria

- (PRD 019 Req 1) **`/scratchpad` lands in the scratchpad.** On a hosted
  deployment, a signed-in GET of `<base URL>/scratchpad` ends with the
  user's scratchpad workspace open (resolved via the existing
  `POST /api/me/scratchpad` from #213 — do not add server routes; the SPA
  fallback in `server/app.ts` already serves the app for this path) and a
  fresh untitled buffer focused in edit mode. The path recognition is the
  hosted client's first path-based route: today it reads only
  `?workspace=` (`src/lib/hostedPaths.ts`). The pure path-recognition
  logic is unit-tested in the `hostedPaths` style (no DOM, no I/O).
- (PRD 019 Req 2) **Sign-in is preserved.** An unauthenticated visit to
  `/scratchpad` shows the normal hosted sign-in gate and, after sign-in
  completes, continues to the scratchpad. This holds for local dev mode
  (no navigation — the pathname survives naturally) AND for the azure
  Entra redirect flow, where the redirect URI is the origin root
  (`src/components/HostedSignIn.tsx`): the scratchpad intent must be
  recorded across the OAuth round-trip (e.g. alongside the pending
  sign-in record in `src/lib/hostedGate.ts`) and honored after the token
  exchange. Covered by a unit test of the intent store/replay logic
  and/or the e2e below.
- (PRD 019 Req 3) **The URL normalizes.** Once the scratchpad workspace
  is open, the address bar reads the canonical `/?workspace=<id>` form,
  rewritten via `history.replaceState` (the PRD 009 Req 6 pattern —
  see `unbind()` in `src/platform/hostedWorkspaces.ts`), so a reload
  boots as a normal workspace binding. Note `createHostedPlatform()`
  reads `window.location.search` once at creation
  (`src/platform/hosted.ts:90`) — the rewrite must land before the
  platform binds, or the binding must be resolved another way that
  leaves a reload correct.
- (PRD 019 Req 4) **Non-hosted platforms untouched.** No `/scratchpad`
  behavior exists in Tauri, the dev shim, or the single-file web build:
  the new routing lives only in hosted-gated code (the hosted marker
  path — `HostedShell` in `src/main.tsx` — and/or `src/platform/hosted*`,
  `src/lib/hostedPaths.ts`/`hostedGate.ts`). No changes to
  `src/platform/tauri*`, `src/platform/web*`, or non-hosted branches.
- (PRD 019 Req 10) **Every visit starts fresh.** Opening `/scratchpad`
  always starts a new untitled buffer (the SPEC22 File → New path),
  whether the scratchpad workspace is empty or already holds files;
  existing files remain visible and reachable in the sidebar as usual.
- (PRD 019 Req 11) **Leaving discards silently.** The scratch buffer
  auto-opened by `/scratchpad` — and only that buffer — is exempt from
  the SPEC36 §2.6 unsaved-changes three-way prompt and the close guard:
  opening another file, navigating away, or closing the tab discards it
  without a dialog even when dirty. The SPEC30 §3 crash-draft shadow
  still covers it (a crash can still offer restore). The dirty indicator
  remains the only "unsaved" signal. Saving it (or replacing it with a
  real document) ends the exemption — an ordinary untitled buffer's
  prompts are unchanged. Covered by unit tests of the exemption logic
  and/or e2e.
- An e2e test (or tests) in `tests/e2e/hosted.spec.ts` — numbered with
  the next free `E<n>`; last used is E388 — drives the flow for real:
  signed-in visit to `/scratchpad` lands in the scratchpad workspace
  with an untitled buffer in edit mode and a `/?workspace=<id>` URL, and
  a repeat visit reuses the same workspace id.
- New behavior carries citation comments in the existing style
  (`PRD 019 Req <n>: …`), per `.sandcastle/CODING_STANDARDS.md`.
- The implementer iterated with `npm run typecheck` and
  `npm run test:unit` (or tests targeted at the changed code) after each
  change, and ran `npm run validate:quick` ONCE, right before declaring
  the goal met — not after every small change and not as a full-suite
  baseline at the start. It prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #215.

## Context

PRD: `prd/019-personal-scratchpad.md` (this issue is Reqs 1–4, 10, 11).
Parent: #211. Blockers #213 and #214 are already on this branch:
`POST /api/me/scratchpad` (`handleScratchpadResolve`,
`server/workspaces.ts`) idempotently answers `{ id }` for the calling
user, and listing/delete semantics are done — this issue is client-only
wiring plus the buffer semantics; save-time naming (Reqs 12–13) is
another issue, do not implement it.

Key seams: `src/lib/hostedPaths.ts` (pure URL mapping — put path
recognition here for unit-testability); `src/components/HostedSignIn.tsx`
(`HostedShell` gates sign-in, then renders `<App/>` — a natural place to
resolve the scratchpad and rewrite the URL before the platform reads it);
`src/lib/hostedGate.ts` (`storePendingSignIn`/`takePendingSignIn`, the
sessionStorage record that already survives the Entra round-trip);
`src/platform/hosted.ts` (`onOpenFile` feeds the bound workspace file to
App; `workspaceId` is read once at platform creation). The untitled-buffer
machinery is in `src/App.tsx` — grep `SPEC22` (File → New, ~line 3679),
`SPEC36 §2.6` (the prompt/close-guard sites), `SPEC30 §3` (drafts); the
scratch exemption needs a way for the hosted boot to tell App the buffer
is scratch (a Platform capability/flag or startup signal — keep App
flavor-blind per PRD 007 Req 2: capability checks, never `kind ===
'hosted'`). Unit tests: `tests/unit/hosted-*.test.ts`; e2e:
`tests/e2e/hosted.spec.ts` (helpers in `tests/e2e/helpers.ts`).
