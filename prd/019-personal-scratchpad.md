# PRD 019: Personal scratchpad

**Status:** Draft
**Date:** 2026-09-02

Issue: #211.

## Problem

Getting something out of your head (or clipboard) and into Marky Mark takes
too many steps: sign in, open the workspace switcher, pick or create a
workspace, create a file — and only then can you type. For the most common
micro-task of all ("I need to paste/jot this *right now*, and maybe share
it a minute later") that friction is fatal: people reach for whatever text
box is closest instead.

The hosted deployment already has everything the fix needs — per-user
identity from the validated token, per-user server storage, real
workspaces with roles — but no fast path that composes them.

## Goals

- A memorable URL — `<base URL>/scratchpad` — that lands a signed-in user
  in a blinking-cursor empty Markdown buffer in one step, with zero setup.
- The scratchpad is provisioned automatically, exactly once per user; the
  user never creates or configures it.
- Scratch content that graduates (gets saved) lives in a real workspace,
  so everything a workspace can do — sharing, members, links (issue #209)
  — works on it immediately.
- True scratch semantics: nothing is kept unless the user says so, and
  nothing nags on the way out.

## Non-goals

Recorded here as seeds for later PRDs, per the owner's brainstorm — not
requirements of this one:

- **Desktop (Tauri) and single-file builds.** No scratchpad concept
  outside hosted deployments in this PRD. A later "desktop scratchpad
  parity" effort could give the Tauri app the same muscle memory against a
  well-known local folder.
- **Type-then-share one-shot.** A share action in the scratch buffer that
  saves the file *and* copies a share link in one click — the pastebin
  flow. Depends on issue #209's link scheme; a natural follow-up.
- **Send-to-scratchpad ingestion.** Pushing text in from outside:
  `/scratchpad?text=…`, a bookmarklet, a PWA share target.
- **Image + code pastebin.** Pasting images and code straight into a
  scratch file (fenced code blocks; image storage). Pasted-image storage
  is new surface for the hosted file layer, so it needs its own PRD.
- **`/today` daily note** and other dated-file patterns.
- **Generalizing first-line save naming** (Req 12) to all untitled
  buffers everywhere — deliberately scoped to the scratch buffer here.
- **Retention/cleanup.** The scratchpad accumulates like any workspace;
  no auto-expiry in this PRD.

## Requirements

### The URL

1. **`/scratchpad` is a reserved path on hosted deployments.** A signed-in
   GET of `<base URL>/scratchpad` ends with the user's scratchpad
   workspace open and a fresh untitled buffer focused in edit mode. (The
   server's SPA fallback already serves the app for this path —
   `server/app.ts`; the hosted client must now recognize the path, its
   first path-based route: today it reads only `?workspace=` —
   `src/lib/hostedPaths.ts`, PRD 007 Req 2.)
2. **Sign-in is preserved, not broken.** An unauthenticated visit to
   `/scratchpad` goes through the normal hosted sign-in flow and continues
   to the scratchpad afterwards — the intent survives the OAuth
   round-trip.
3. **The address bar normalizes after resolution.** Once the scratchpad
   workspace is open, the URL is rewritten via `history.replaceState` to
   the canonical `/?workspace=<id>` form (the PRD 009 Req 6 pattern), so
   reload, existing workspace binding, and future share links (#209) see
   one canonical URL shape.
4. **Non-hosted platforms are untouched.** Tauri, the dev shim, and the
   single-file build have no `/scratchpad` behavior; their platform code
   paths do not change.

### The workspace

5. **Resolve-or-create, idempotent, keyed by token identity.** The server
   exposes a scratchpad-resolution operation for the calling user (the
   identity from the validated token — `oid`, never the URL, matching
   `server/userFiles.ts`). First call creates the workspace and records
   its id in the user's per-user storage (`users/<id>/…`); every later
   call returns the same id. Two concurrent first visits still yield
   exactly one scratchpad.
6. **It is a real workspace.** Creation goes through the existing
   workspace-creation path: opaque server-generated UUID id (PRD 007
   Req 7), a normal manifest, the user as sole Owner. Its display name is
   `Scratchpad`.
7. **Auto-creation bypasses the deployment creation policy.** Scratchpad
   provisioning succeeds even when PRD 017's creation policy
   (`members`/`restricted`) would deny the user a New Workspace — every
   signed-in user, guests included, gets one. The policy continues to
   govern regular creation.
8. **Personal in every listing.** A scratchpad workspace never appears in
   another user's workspace listing, regardless of the deployment listing
   policy (PRD 007 Req 11 / PRD 017). The owner's own listing includes
   it, flagged so the Open Workspace dialog can label it distinctly
   ("My scratchpad", with a distinguishing icon or badge).
9. **Full workspace powers, minus delete.** Members, roles, sharing, and
   every other verb behave as in any workspace the user Owns. Deleting a
   scratchpad workspace is refused server-side (the existing
   `workspace.delete` route rejects it), and the UI hides the delete
   affordance for it — a deleted scratchpad would only be silently
   recreated, so the action is not offered.

### The buffer

10. **Every visit starts fresh.** Opening `/scratchpad` always starts a
    new untitled buffer (SPEC22), whether the workspace is empty or
    already holds files. Existing files stay visible and reachable in the
    sidebar as usual.
11. **Leaving discards silently.** The scratch buffer auto-opened by
    `/scratchpad` is exempt from the unsaved-changes three-way prompt
    (SPEC36 §2.6) and the close guard: navigating away, opening another
    file, or closing the tab discards it without a dialog. The crash-safe
    draft mechanism (SPEC30 §3) still shadows it, so a crash — as opposed
    to a deliberate exit — can still offer restore. The existing dirty
    indicator remains the only "unsaved" signal.
12. **Saving names itself sensibly.** The first save of the scratch
    buffer routes to Save As (SPEC22) with the name pre-filled from the
    buffer's first Markdown heading, else its first non-empty line
    (sanitized for a filename), falling back to a timestamp
    (`YYYY-MM-DD HH.mm`) for unnamed pastes; `.md` is appended when
    missing and collisions dedupe via the existing `uniqueChildName`
    behavior (`src/lib/savePicker.ts`). Default folder is the
    scratchpad's root.
13. **Saved means normal.** Once saved, the file is an ordinary workspace
    file with no residual scratch semantics — the SPEC36 prompt and all
    standard behaviors apply to it from then on.

## Open questions

None — everything deferred is recorded under Non-goals.
