# PRD 024: Workspace rename redirects

**Status:** Draft
**Date:** 2026-09-06

Issue: #251. Amends PRD 020 (which deferred this under Non-goals).

## Problem

Rename a workspace's unique name in settings → Names and the save
succeeds, but the browser stays on the old `/<old-name>` URL. Worse: the
page's binding still holds the old name, so the next document switch
rewrites the address bar *back* to the old name, and a reload of that URL
lands on the not-found page. Every link anyone shared before the rename
(PRD 020 deep links to files and headings included) now dies with a
friendly 404.

Since PRD 020 made these URLs the thing people copy and paste, a rename
that silently breaks all of them feels broken. GitHub solved this for
repositories years ago and its rules are the ones users already know:
you land on the new URL, old URLs redirect, and a redirect lives until
someone reclaims the old name. This PRD mirrors that model and nothing
more.

**Build applicability: hosted (cloud) only.** Desktop (Tauri), dev-shim
and single-file builds have no path routing and are untouched.

## Goals

- After a unique-name rename, the renaming tab is on the new canonical
  URL immediately, with nothing else about its state disturbed.
- Every previously shared URL under a former name of a workspace keeps
  resolving, workspace, file and heading alike, and lands the visitor on
  the canonical URL.
- The behaviour is GitHub's, recognisably: redirects are permanent until
  the old name is reclaimed by another workspace, and reclaiming is
  ordinary creation or rename.
- No new storage, no new server lookup, no live channel: one server-owned
  field on the manifest and the existing client-side name match.

## Non-goals

- **Server-side name resolution.** No name-keyed API routes, no HTTP
  301/308 responses. Names resolve client-side against the workspace
  listing today (`src/lib/hostedPaths.ts` `findWorkspaceByUniqueName`),
  and former names resolve the same way. Nothing addressed by name ever
  reaches the server, so "301 versus transparent for the API" does not
  arise.
- **Hidden workspaces.** A name resolves only when the workspace appears
  in the visitor's listing (PRD 017 listing policy). Former names inherit
  exactly that rule: a redirect works wherever the direct link would have
  worked, and nowhere else.
- **Expiry by time.** No TTL. A redirect dies only when its name is
  reclaimed (Req 8) or its workspace is deleted (Req 10).
- **Reclaim warnings, blocking, or release controls.** Taking a former
  name is silent, as on GitHub. No "this name currently redirects to X"
  hint (it would leak friendly names of workspaces the user cannot see,
  and would appear inconsistently depending on listing visibility), no
  owner veto, no "release this name" button.
- **Landing notices.** A visitor arriving via a former name sees the
  canonical URL in the address bar and nothing else. No "this workspace
  was renamed" banner.
- **Moving other tabs and devices along.** There is no polling, SSE or
  WebSocket in the hosted client and this PRD adds none. Other open tabs
  keep working (every API call is UUID-keyed); if their address bar still
  shows the former name, that URL redirects on reload.
- **Retroactive history.** Workspaces renamed before this ships have no
  recorded former names. History starts empty for everyone; nothing is
  backfilled.
- **Friendly names.** A friendly-name change never touches URLs or
  history (PRD 020 Req 4, unchanged).
- **Usernames and scratchpad routes.** Usernames are never re-derived
  (PRD 020 Req 12), so `/<username>/scratchpad` has no rename and no
  redirect. The reserved words (`api`, `assets`, `scratch`,
  `scratchpad`) stay reserved and can never be former names either.
- **The legacy `/?workspace=<uuid>` form.** UUIDs are stable; PRD 020
  Req 7 keeps working unchanged.
- **A cap on former names.** None, as on GitHub.
- **Concurrency on the manifest write.** The rename is today an
  unconditional manifest write that can clobber a concurrent settings
  edit. Pre-existing, out of scope.
- **The taken-name fan-out.** Creation and rename read every manifest to
  check uniqueness (`server/workspaces.ts` `takenUniqueNames`). A per-name
  claim index would fix that and could also host redirects, but it is a
  separate performance issue; this PRD deliberately does not introduce
  it.
- **Admin surfaces.** Deployment admins (PRD 017) get no view or control
  over redirects.

## Requirements

### Former names on the manifest

1. **A server-owned `formerNames` field.** The workspace manifest carries
   `formerNames: string[]`, the unique names this workspace has given up.
   The field is optional on read (absent means empty, so pre-existing
   manifests validate unchanged) and is always written by the server.
   Any `formerNames` value a client sends on a manifest PUT is ignored;
   the stored value is computed server-side.
2. **A rename records the previous name.** When a manifest PUT changes
   the unique name to a different name (compared with the case-insensitive
   key of PRD 020 Req 1), the server appends the previous name to
   `formerNames`. A case-only change (`alpha` → `Alpha`) is not a rename
   for history purposes and records nothing.
3. **Renaming back reclaims your own name.** If the new name is one of
   this workspace's own former names, it leaves `formerNames` as it
   becomes current again, and the name just given up is appended. After
   `A → B → A`, the current name is `A` and `formerNames` is `[B]`.
4. **Chains are flat.** After `A → B → C`, `formerNames` is `[A, B]` and
   each entry resolves to the workspace in a single lookup; there is no
   chain to follow and no way to form a loop.
5. **Listing rows carry former names.** `GET /api/workspaces` rows
   include `formerNames` (empty array when none), under the same listing
   policy as the rest of the row.

### Reclaiming a former name (GitHub's rule)

6. **Former names never count as taken.** Creation, and rename, with a
   name that is currently a former name of some other workspace succeeds
   under exactly the rules that apply today (format, reserved words, and
   collision with a *current* name). No warning, no confirmation.
7. **Current beats former.** Name resolution matches current names first
   across the whole listing and only then former names. A stale former
   name that a race left behind on another workspace is therefore inert:
   it can never shadow a current name.
8. **Reclaiming ends the redirect.** When a creation or rename takes a
   name that is a former name of another workspace, the server removes
   that name from the other workspace's `formerNames` as part of the same
   request. Links to the name thereafter open the workspace that now
   holds it, exactly as GitHub's "redirect stops when the old name is
   reclaimed".
9. **Reserved words are never former names.** The reserved list of PRD
   020 Req 11 is refused on rename as today; nothing in this PRD lets a
   reserved word enter `formerNames`.
10. **Deletion takes the history with it.** Deleting a workspace removes
    its former names along with its manifest; links under any of its
    names then render the not-found page (Req 15). No tombstone.

### Landing on the new URL

11. **The renaming tab lands on the new URL without a reload.** On a
    successful unique-name save in settings → Names, the page binding's
    unique name is updated and the address bar is rewritten with
    `history.replaceState` (the PRD 020 Req 6 pattern) to
    `/<new-name>[/<path of the open file>]`, preserving any `#<heading>`
    fragment. The settings dialog, the open document and any unsaved
    editor state are untouched. Every later address-bar rewrite (document
    switches, PRD 020 Req 6) uses the new name; the old name is never
    written to the bar again by that tab.
12. **Friendly-name-only saves leave the bar alone.** A save that changes
    only the friendly name rewrites nothing and records no history.
13. **Reload after rename stays put.** Reloading the renaming tab after a
    rename opens the same workspace and file at `/<new-name>/…`, without
    passing through the not-found page.

### Redirecting old links

14. **A former-name URL resolves like a current one.** Visiting
    `/<former-name>`, `/<former-name>/<path…>/<file>`, or either with a
    `#<heading-slug>` opens the workspace, the file and the heading
    exactly as the equivalent current-name URL would (PRD 020 Reqs 5, 18
    and 19), and rewrites the address bar to the canonical URL with the
    file path and fragment preserved. The redirect is silent. Matching
    of former names is case-insensitive, like current names. An
    unauthenticated visit to a former-name URL goes through hosted
    sign-in and continues to the canonical URL afterwards (PRD 020 Req 9).
15. **The not-found hint no longer blames renames.** The not-found page
    of PRD 020 Req 8 currently hints "It may have been renamed, deleted,
    or shared by mistake." Since renames now redirect, the hint becomes
    "It may have been deleted or shared by mistake." Everything else on
    that page is unchanged.

### Settings UI

16. **The Names section lists former names, read-only.** When a
    workspace has former names, settings → Names shows them under the
    unique-name field as "Previous names: a, b. Links to these still open
    this workspace." The list is absent when there are none, and updates
    immediately after a rename in the same dialog. There is no control to
    remove a former name.

### Verification

17. **Unit coverage on the server** (`tests/unit/server-workspaces.test.ts`,
    alongside U1054): history append on rename; nothing recorded on a
    case-only rename; renaming back moves the name out of the history;
    client-supplied `formerNames` ignored; creation and rename with
    another workspace's former name succeed and strip it from that
    workspace; listing rows carry the field.
18. **Unit coverage on the client** (`tests/unit/hosted-paths.test.ts`,
    alongside U1060): the name match resolves former names
    case-insensitively and prefers a current name over a former name
    held by a different row.
19. **End-to-end coverage** (`tests/e2e/hosted.spec.ts`, new E-numbers):
    renaming via settings → Names lands the tab on `/<new-name>/<file>`
    with the document still open, and a reload stays there; opening the
    old workspace, file and heading URLs redirects to the canonical ones
    with file and heading honoured; creating a workspace under the old
    name makes the old link open the new workspace; E403 follows the
    Req 15 copy change. This is the first e2e test that drives the Names
    section.

## Open questions

None. Everything deferred is recorded under Non-goals.
