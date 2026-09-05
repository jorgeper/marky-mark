# PRD 023: Scratch — always a fresh, specially-rendered buffer, named at save

**Status:** Draft
**Date:** 2026-09-05
**Issue:** #273 (amends PRD 019 Reqs 10 and 12; PRD 020 Req 11)

## Problem

Navigating to your scratch is meant to be the "give me a blank page now"
gesture (PRD 019). Three things blunt it today:

1. **Only the shortcut form is fresh.** `/scratch` boots a new buffer, but
   the canonical `/<username>/scratch` — which is exactly what the address
   bar shows one second later, and what a bookmark or a reload uses — just
   re-binds the workspace. The guard was deliberate (a reload should not
   pile up blank buffers) but it makes the same destination behave two
   ways, and picking "My scratch" in the Open Workspace dialog behaves a
   third way (no fresh buffer at all).
2. **The buffer looks like any untitled file.** It is labelled "Untitled"
   in the toolbar, the file tab and the browser tab, with nothing to say
   it is the special, prompt-exempt scratch buffer whose contents vanish
   on leave (PRD 019 Req 11).
3. **The first save guesses a name.** PRD 019 Req 12 pre-fills the Save
   picker from the first heading / first line / a timestamp. The owner
   wants the scratch buffer to be the mirror image of New File — type
   first, name at save — using the same Save experience New File has, not
   a content-derived guess.

Hosted (cloud) build only: scratch does not exist on the desktop (Tauri)
or single-file builds (PRD 019 Req 4).

## Goals

- Entering your own scratch workspace with no target file **always**
  starts a fresh blank buffer, whatever the route.
- The scratch buffer is **recognisably special** wherever a file name is
  shown, on every bundled theme.
- The first save of the scratch buffer asks for a name with **exactly the
  New File experience**.
- Nothing else about scratch changes: URL forms, workspace model, silent
  discard on leave, sharing.

## Non-goals

- **No change to the New File / right-click new-file flow** anywhere,
  including inside the scratch workspace: name first, `Untitled.md`
  pre-filled, as today (PRD 009 Reqs 13–14).
- **No change to ordinary untitled buffers.** A ⌘N buffer opened inside
  the scratch workspace is "Untitled", normally styled, with the normal
  unsaved-changes prompts (PRD 019 Req 11 already scopes the exemption to
  the boot's buffer).
- **No change to discard semantics.** PRD 019 Req 11 (silent discard on
  navigate/close, crash-safe draft still shadows it) stands as written.
- **No change to URL forms, resolution or sharing.** PRD 020 Reqs 10–13
  stand; `/<username>/scratch/<file>` still opens that file.
- **Someone else's scratch never boots a fresh buffer** — a visitor lands
  in the workspace (or its file) exactly as today.
- **No per-user styling choice.** The special treatment is fixed and
  token-driven; themes restyle it via the chrome token layer, users do not
  toggle it.
- **Desktop and single-file builds are untouched.**
- **Not a rename of the workspace.** "My scratch" (PRD 020 Req 10) stays;
  only the unsaved buffer gets the "Scratch file" label.

## Requirements

### Fresh on every entry

1. **Both bare URL forms boot fresh.** A signed-in visit to `/scratch`
   or to your own bare `/<username>/scratch` (no file segment) ends with
   the scratch workspace open and a fresh, empty scratch buffer focused in
   edit mode — on every visit, including a browser reload of the canonical
   bare URL. This amends PRD 019 Req 10 and removes the "reload just
   re-binds" guard in `HostedSignIn.tsx`'s scratch binding; PRD 020 Req 11
   (`/scratch` redirects to `/<username>/scratch`) is unchanged, so both
   forms now converge on one behaviour.
2. **A file URL opens the file.** `/<username>/scratch/<path>` opens that
   file and never boots a scratch buffer (PRD 020 Req 13 unchanged). A
   missing file still lands on the not-found page as today.
3. **In-app entry boots fresh too.** Choosing your own scratch workspace
   from the Open Workspace dialog (the "My scratch" row, PRD 019 Req 8)
   lands in a fresh scratch buffer with the same semantics as Req 1. The
   rule is "entering your scratch with no target file", not "arriving by
   URL".
4. **Re-entry replaces silently.** If a scratch buffer — dirty or not —
   is already open and the user re-enters the scratch workspace by any Req
   1 or Req 3 route, the existing scratch buffer is discarded without a
   prompt (PRD 019 Req 11's exemption) and a new empty one takes its
   place.
5. **Only your own scratch.** Visiting another user's scratch, with or
   without a file segment, boots no scratch buffer and applies none of
   Reqs 6–9.

### The buffer looks special

6. **Placeholder name.** The scratch buffer's display name is
   **"Scratch file"** everywhere a document name is shown: the toolbar's
   `<workspace> › <file>` name, its file tab in the tab strip, and the
   browser tab title. No name prompt is shown to start typing.
7. **Distinct treatment.** In the toolbar name and the file tab, the
   placeholder renders in the **accent colour and italic**, with the
   usual unsaved dot when dirty. Both properties come from a chrome token
   (per `docs/STYLE-GUIDE.md`) so every bundled theme restyles it without
   defining anything; the result stays readable on all 27 bundled themes
   (the existing theme contrast checks cover the new token).
8. **Scoped to the scratch buffer.** Reqs 6–7 apply only to the buffer
   the boot (Reqs 1, 3) opened. Every other untitled buffer keeps
   "Untitled" and normal styling, including ⌘N inside the scratch
   workspace.

### Name at save

9. **Save asks, with the New File experience.** ⌘S, the Save command and
   Save As… on the scratch buffer all open the in-workspace Save picker
   (PRD 009 Reqs 13–14) with the folder defaulted to the scratch
   workspace's root and the name pre-filled with a **free `Untitled.md`**
   (deduped via `uniqueChildName`, exactly as the sidebar's New File
   does). This **replaces PRD 019 Req 12**: no heading-, first-line- or
   timestamp-derived name is proposed. There is no silent save path for
   the scratch buffer.
10. **Cancel keeps the buffer.** Cancelling the picker returns to the
    scratch buffer unchanged — still named "Scratch file", still
    prompt-exempt on leave.
11. **An empty buffer still asks.** Saving with nothing typed opens the
    same picker; an empty file is a legitimate result.
12. **Saved means normal.** Once written, the file is an ordinary
    workspace file: its real name, normal styling, and the standard
    unsaved-changes prompts apply from then on (PRD 019 Req 13
    unchanged).

### Tests

13. **Hosted e2e coverage.** The hosted suite gains tests for: bare
    `/<username>/scratch` boots fresh on first visit and on reload (Req
    1); a file URL does not (Req 2); the Open Workspace row boots fresh
    (Req 3); re-entry over a dirty scratch buffer replaces it without a
    prompt (Req 4); "Scratch file" in toolbar, tab and title with the
    accent/italic treatment (Reqs 6–7) while a ⌘N buffer stays "Untitled"
    (Req 8); Save opens the picker pre-filled `Untitled.md` at the scratch
    root, Cancel keeps the buffer, and the saved file is normal (Reqs
    9–12). Existing tests asserting the heading-derived pre-fill are
    updated.

## Open questions

None — everything deferred is recorded under Non-goals.
