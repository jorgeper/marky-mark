# Spec: Rename "Scratch" to "Scratchpad" (#244)

## Goal

All acceptance criteria in issue-specs/issue-244.md are satisfied for issue
#244, with evidence visible in the session: on the hosted build the per-user
quick-capture workspace is called **Scratchpad** in every user-visible string,
its canonical URLs are `/scratchpad`, `/<username>/scratchpad[/<file…>]` and
`GET /api/scratchpad/<username>`, every old `/scratch` URL form still resolves
and normalizes to its `/scratchpad` equivalent (no dead bookmarks), tests cover
both the canonical and the legacy forms, `npm run validate:quick` passes, and a
summary comment from the implementer exists on issue #244.

## Acceptance criteria

- **The route word is `scratchpad`.** `SCRATCH_SEGMENT` in
  `src/lib/hostedPaths.ts` (and everything built on it — `buildScratchPath`,
  `parseAppPath`, the not-found page's "what was looked for" string) yields the
  canonical forms `/scratchpad` (the own-scratchpad shortcut, PRD 020 Req 11)
  and `/<username>/scratchpad[/<file…>]` (PRD 020 Req 10+13). Matching stays
  case-insensitive via `uniqueNameKey`, as today.
- **The old forms keep working.** A signed-in visit to `/scratch` behaves
  exactly as `/scratchpad` does, and `/<username>/scratch[/<file…>]` exactly as
  `/<username>/scratchpad[/<file…>]` — same workspace bound, same file opened,
  same PRD 023 fresh-buffer decision (`scratchBootsFresh`) — and the address bar
  ends on the canonical `/scratchpad` form via the existing
  `history.replaceState` normalization in `resolveHostedVisit`
  (`src/components/HostedSignIn.tsx`). The unauthenticated case also holds: the
  visit intent stored across the sign-in redirect (PRD 020 Req 9) carries a
  legacy `/scratch` path through sign-in and lands on the canonical URL.
- **A legacy segment never resolves as something else.** Both `scratch` and
  `scratchpad` stay in `RESERVED_WORKSPACE_NAMES`
  (`src/lib/workspaceNames.ts`) and therefore stay unavailable as workspace
  unique names and as derived usernames (`deriveUsername`), so neither word can
  be shadowed by a real workspace or user.
- **The API endpoint is renamed.** `GET /api/scratchpad/<username>` answers
  what `GET /api/scratch/<username>` answers today (PRD 020 Req 13: `{id,
  owner}` or the one indistinguishable 404), and the client calls the new path.
  `POST /api/me/scratchpad` is already correctly named and is unchanged. The
  old `GET /api/scratch/<username>` is app-internal and never bookmarked, so
  removing it is acceptable; if it is kept as an alias it must answer
  identically, including the 404 shape.
- **Every user-visible string reads "Scratchpad".** At minimum: the workspace's
  friendly name `SCRATCHPAD_NAME` in `server/workspaces.ts` becomes
  `My scratchpad`; the Open-dialog badge from `scratchBadge`
  (`src/lib/workspaceLifecycle.ts`) reads `My scratchpad`; the identity line in
  `src/components/WorkspaceSwitcher.tsx` reads "your scratchpad lives at …"
  followed by the canonical `/<handle>/scratchpad` path; and the fresh-buffer
  placeholder `SCRATCH_NAME` in `src/lib/docName.ts` reads `Scratchpad file` in
  the toolbar, the file tab and the window/browser-tab title. No user-visible
  surface still calls the feature "Scratch".
- **Existing deployments converge on the new name.** The startup rename pass
  `migrateScratchNames` (`server/workspaces.ts`, run from `server/index.ts`)
  renames a scratchpad-flagged manifest carrying *either* legacy name —
  PRD 019's `Scratchpad` or PRD 020's `My scratch` — to `My scratchpad`, stays
  idempotent (a second run renames nothing, logs nothing), and still skips a
  manifest a user renamed by hand to anything else.
- **Internal identifiers are free to stay.** Variable/function names, stored
  blob keys (`users/<id>/scratchpad.json`, the manifest `scratchpad` flag), CSS
  class and token names (`.badge.scratchpad`, `--mm-scratch-name`) and
  `data-testid`s may keep their current spelling; renaming them is optional and
  must not be mistaken for the contract. Storage keys in particular MUST NOT
  change — a rename there would strand existing users' scratchpads.
- **Hosted-only.** Desktop (Tauri) and single-file web builds are untouched:
  no new platform branching, and their behaviour and tests are unchanged.
- **Tests cover both spellings.** Unit tests in `tests/unit/hosted-paths.test.ts`
  (route parsing/building, the legacy alias, `isOwnScratch`,
  `scratchBootsFresh`), `tests/unit/workspace-lifecycle.test.ts` (the badge),
  `tests/unit/doc-name.test.ts` (the placeholder) and
  `tests/unit/server-scratchpad.test.ts` (the friendly name, the widened
  migration and its idempotency) are updated/added; the hosted e2e suite
  (`tests/e2e/hosted.spec.ts`, E397/E398 and neighbours) asserts the canonical
  `/scratchpad` landing URL, and at least one case proves a legacy `/scratch`
  visit lands on the canonical `/<username>/scratchpad` URL with the same
  buffer. New tests take the next unused `U<n>`/`E<n>` ids per
  `.sandcastle/CODING_STANDARDS.md`; no existing test is deleted or weakened to
  make the rename pass, and the `E2E_TEST_FLOOR` in `scripts/validate.mjs`
  (a minimum, currently 479) still holds.
- **Docs and citations match the shipped names.** Citation comments describing
  the route words (`src/lib/hostedPaths.ts`, `src/components/HostedSignIn.tsx`,
  `server/app.ts`, `server/workspaces.ts`) state the new canonical words and the
  legacy alias; `server/README.md`'s route table lists
  `GET /api/scratchpad/<username>` and the `My scratchpad` name;
  `docs/STYLE-GUIDE.md`'s `--mm-scratch-name` row describes the
  `Scratchpad file` placeholder. PRD text is history and is NOT rewritten:
  `prd/019-personal-scratchpad.md`, `prd/020-shareable-links.md` (Reqs 10–13)
  and `prd/023-scratch-fresh-buffer.md` each get the repo's dated amendment
  blockquote — `> **Amended (issue #244, 2026-09-06):** …` — placed after the
  paragraph it annotates with a blank line on both sides (the issue #258
  precedent in `prd/003-pane-chevrons-and-slide-animations.md`).
- **The map is current.** `docs/MAP.md` is regenerated with `npm run map` if the
  `SPEC<n>` citation set changed; it is never hand-edited.
- The implementer iterated with `npm run typecheck` and `npm run test:unit` (or
  a single case via `npx playwright test -g '<title>'`), and ran the full quick
  gate `npm run validate:quick` ONCE, right before declaring the goal met — not
  after every change and not as a start-of-attempt baseline beyond the quick
  tier. That final run printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #244, naming the
  renamed surfaces, how legacy `/scratch` URLs are honoured, the migration
  behaviour, the tests added, and the gate result.

## Context

This is largely a revert of PRD 020 Req 10's rename back toward PRD 019's own
`/scratchpad` naming, plus a legacy alias PRD 020 explicitly did not keep
("The old `/scratchpad` route is replaced, not kept").

The whole route vocabulary is one constant and three pure functions in
`src/lib/hostedPaths.ts`: `SCRATCH_SEGMENT`, `isScratchSegment`,
`parseAppPath`/`buildScratchPath` and `isOwnScratch`/`scratchBootsFresh`.
Making `isScratchSegment` accept both words while `buildScratchPath` emits only
`scratchpad` is the cheapest way to satisfy the redirect criterion:
`resolveHostedVisit`'s `bindScratch` (`src/components/HostedSignIn.tsx`, ~line
137) already rewrites the address bar to `buildScratchPath(...)` on every
scratch landing, so old URLs normalize for free — verify that, don't assume it.

Server side, the two routes live in `server/app.ts` (~lines 144–163) and their
handlers (`handleScratchVisit`, `handleScratchpadResolve`, `SCRATCHPAD_NAME`,
`migrateScratchNames`) in `server/workspaces.ts` (~lines 450–610).
`tests/unit/server-scratchpad.test.ts` has the in-process HTTP + mock-auth
harness for all of it, including the existing migration test U1072.

Scope is hosted (cloud) only. Grep breadth to expect: ~223 `scratch` mentions
across `src/` and `server/` (`src/App.tsx`, `HostedSignIn.tsx`,
`hostedPaths.ts` and `server/workspaces.ts` hold most of them), most of which
are comments and internal identifiers that the criteria above deliberately do
not force you to touch.
