# PRD 020: Shareable links and path-based URLs

**Status:** Draft
**Date:** 2026-09-03

Issue: #209.

## Problem

Nothing in a hosted deployment can be pointed at. The only URL shape is
`/?workspace=<uuid>` — opaque, workspace-deep at best, and nobody ever
"just sends" one. There is no way to hand a colleague a link to a file,
let alone to the exact section of a document a discussion is about, and
no affordance anywhere in the chrome that says "copy a link to this".

The owner wants both halves fixed: URLs worth sharing (GitHub-style
paths built from names people chose, not UUIDs), and one-click share
icons at the three depths that matter — workspace, file, heading.

## Goals

- Every workspace, file, and heading in a hosted deployment has a
  human-readable, copy-pasteable URL:
  `/<workspace-name>/<folders…>/<file>.md#<heading-slug>`.
- Workspaces are identified by a user-chosen unique name, GitHub-repo
  style; the UUID disappears from the user-facing surface.
- A single reusable copy-link affordance, placed at all three depths,
  that copies the URL and confirms inline — no dialogs.
- Opening a shared link lands the recipient exactly where the sender
  was looking: workspace open, file open, section scrolled into view.

## Non-goals

- **Desktop (Tauri), dev-shim, and single-file builds.** No share
  affordances and no path routing outside hosted deployments.
- **Rename redirects.** Renaming a workspace's unique name breaks old
  links (friendly 404); a GitHub-style rename-history redirect table is
  deliberately deferred.
- **Permission changes.** A link conveys no access. Recipients hit the
  existing sign-in and no-access semantics (PRD 007 Req 11, PRD 017);
  nothing here adds link-based grants, expiring links, or public pages.
- **Sharing from unsaved buffers.** An untitled buffer has no URL;
  its share affordance simply does not exist until first save.
- **Positional/immutable heading anchors.** Heading slugs come from
  text; links to headings that were reworded or deleted degrade
  gracefully (Req 19) rather than being version-pinned.
- **The type-then-share one-shot** (save + copy link in one click) from
  PRD 019's seed list — a natural follow-up once this ships.
- **Path-linking a root folder literally named `scratch`** inside a
  regular workspace — shadowed by the reserved word (Req 10); the
  shadowing is documented, not worked around.

## Requirements

### Workspace identity: names, not UUIDs

1. **Unique names, GitHub-style.** A workspace's identity is a
   user-chosen name of 1–100 characters from `[A-Za-z0-9._-]`, unique
   across the deployment case-insensitively. The server rejects
   creation (and rename, Req 4) that would collide, with an error the
   UI surfaces inline; it also rejects the reserved names of Req 11.
2. **Chosen at creation.** The New Workspace flow (PRD 007 Req 10)
   asks for the unique name up front — pre-validated as you type — and
   optionally a **friendly display name** (free text). The friendly
   name, when set, is what UI chrome shows, with the unique name shown
   alongside in URL contexts; unset, the unique name is the display.
3. **Existing workspaces migrate.** On upgrade, each existing
   workspace's display name is slugified into its unique name
   (lowercased, runs of unsafe characters → `-`), deduped with `-2`,
   `-3`… suffixes; the original display name is preserved as the
   friendly name. Migration is idempotent and logged.
4. **Rename.** A workspace Owner (the `workspace.settings` verb) can
   change the unique name and the friendly name in workspace settings.
   A unique-name change takes effect immediately; links to the old
   name thereafter 404 (Req 8). Friendly-name changes never affect
   URLs.

### Path-based URLs

5. **The canonical URL is a path.**
   `/<workspace-name>` opens the workspace;
   `/<workspace-name>/<path…>/<file>` opens that file in it;
   an appended `#<heading-slug>` scrolls to that heading (Req 18).
   File paths appear segment-per-segment, percent-encoded per segment.
   The server's SPA fallback already serves these; the hosted client
   resolves them (its path router, extending PRD 019 Req 1).
6. **The address bar always shows the canonical path.** Opening a
   workspace or file by any means rewrites the URL (the
   `history.replaceState` pattern, PRD 009 Req 6) to the Req 5 form —
   what you see in the bar is always what you would share.
7. **Legacy query URLs redirect.** `/?workspace=<uuid>` resolves the
   UUID and redirects to the path form; unknown UUIDs get Req 8's
   not-found page. The query form is emitted nowhere once this ships.
8. **Friendly not-found.** A path that matches no workspace (or no
   file within one) renders an in-app not-found page naming what was
   looked for, with a link to the user's workspace list — never a
   blank screen or a raw 404.
9. **Sign-in preserves the deep link.** An unauthenticated visit to
   any Req 5 URL goes through hosted sign-in and continues to the
   originally requested workspace/file/heading afterwards (extending
   PRD 019 Req 2 beyond `/scratchpad`).

### Scratch (amends PRD 019)

10. **Scratchpad becomes "scratch".** The PRD 019 feature is renamed:
    the per-user workspace's friendly name is "My scratch", and its
    canonical URL is `/<username>/scratch`. As a second path segment,
    `scratch` is a reserved word: `/<seg1>/scratch[/…]` always
    addresses user seg1's scratch workspace, never a folder. The old
    `/scratchpad` route is replaced, not kept.
11. **`/scratch` is the shortcut.** Visiting `/scratch` signed-in
    redirects to your own `/<username>/scratch` (creating the
    workspace on first use exactly as PRD 019 Reqs 5–7 specify).
    `scratch`, `scratchpad`, and the route words already in use
    (`api`, …) are reserved and rejected as workspace names (Req 1).
12. **Usernames.** Each user's URL segment is derived at first
    sign-in: the local part of their identity (AAD alias for members,
    email local part for guests), lowercased and slugified to Req 1's
    charset, deduped deployment-wide with `-2`, `-3`… suffixes, then
    stored in their per-user storage and never re-derived. The UI
    shows the user their username (and thus their scratch URL)
    wherever the signed-in identity is displayed.
13. **Scratch files share like any others.** Files saved in a scratch
    workspace get Req 5 URLs under `/<username>/scratch/…` and carry
    the same share affordances; recipients need access per the normal
    workspace model (scratch listing stays personal per PRD 019
    Req 8, but a member you add can follow links into it).

### The share affordance

14. **One primitive.** A single reusable copy-link control: a link
    icon with tooltip "Copy link"; clicking copies the target URL to
    the clipboard and the control itself briefly transforms to a
    confirmation state ("Link copied", ~2s, then reverts). The
    confirmation is announced to assistive tech (`aria-live`). No
    dialog, no toast stack. Styled per the chrome tokens
    (docs/STYLE-GUIDE.md).
15. **Hosted only.** The control renders only on the hosted platform;
    Tauri, dev-shim, and single-file builds show none of the three
    placements.
16. **Workspace share.** The control sits with the workspace's
    top-left icon cluster and copies `/<workspace-name>`.
17. **File share.** The control sits top-right above the open file
    and copies the file's Req 5 URL. It is absent for untitled
    buffers.
18. **Heading share.** In the rendered preview, hovering a heading
    reveals the control beside it; in the editor, a cursor resting on
    a heading line reveals it in the gutter. Both copy the file URL
    plus `#<slug>`, where the slug is GitHub-style: heading text
    lowercased, punctuation dropped, spaces → `-`, duplicate slugs
    deduped `-1`, `-2`… in document order (derived from the section
    model, `src/lib/sectionModel.ts` — never from scraping DOM).
19. **Opening a heading link.** Landing on `#<slug>` scrolls the
    opened file to that heading in the current view mode (the TOC's
    existing navigate-to-line machinery, PRD 012). If no heading
    matches, the file opens at the top with a brief dismissible
    notice ("That section wasn't found — it may have been renamed");
    the link is otherwise a normal Req 5 file link.

## Open questions

None — everything deferred is recorded under Non-goals.
