# PRD 013: Tabs on top — the file tab strip

**Status:** Draft
**Date:** 2026-08-19
**Issue:** #139

## Problem

SPEC36 gave the desktop app true multi-buffer editing — an open set of
files with parked buffers, dirty flags, Ctrl+Tab cycling — but the only
place that set is *visible* is the folder sidebar. Close the sidebar and
the open files vanish from view; even with it open, the open set is
interleaved with the tree and easy to lose. Every mainstream editor
surfaces open files as a tab strip above the content; users reach for it
and it isn't there.

There is also an aesthetic opportunity the sidebar treatment set up: the
active file already reads as a tab extending from the workspace onto the
left pane (front plane, punch-through shadow). Mirroring that treatment
along the top edge completes the illusion — with the folder pane open,
the top-left corner of the editor/preview reads as a page in 3D with
tabs on the left *and* on top.

## Goals

- The open set is always visible and one click away, sidebar open or
  not, via a horizontal tab strip above the editor/preview pane.
- The strip is a **pure view** of the SPEC36 open-set model: same
  tree-ordered list, same active file, same dirty flags, same close
  semantics as the sidebar tabs. No new state of record beyond one
  visibility setting.
- The visual treatment mirrors the sidebar's plane system rotated to
  the top edge, so the two tab surfaces read as one coherent 3D object.

## Non-goals

- **Static web build changes** — the single-file web build keeps its
  behavior and W tests unchanged. *(Amended by issue #186: this
  non-goal originally said "desktop-only", written before the hosted
  backend existed. The hosted flavor runs SPEC36's open-set model in
  full and DOES get the strip, gated on the `multiFileSession`
  capability; only the static single-file build stays without it.)*
- **Drag-reordering of tabs** — the strip is always in tree order,
  like the sidebar list and Ctrl+Tab cycling (single source of truth).
- **Pinned tabs, MRU cycle order, per-tab edit/preview mode** — all
  remain out of scope exactly as SPEC36 declared them.
- **Changes to open semantics** — opens stay additive per the issue #64
  amendment to SPEC36 §3.2; the strip adds no new way for files to
  enter the open set.
- **A dedicated show/hide hotkey** — the View-menu item and setting
  suffice for v1.
- **Tab strips in aux windows** (Settings/About) or any multi-window
  coordination.

## Requirements

### Strip presence

1. Desktop builds render a horizontal tab strip spanning the top of the
   workspace (above the editor, preview, or split panes) whenever a
   document is open — a file from the open set or an untitled buffer —
   and the strip is enabled (R14). With ONE document open the strip
   still shows (a single tab). On the splash (no document) the strip
   does not render.
2. The strip renders independently of folder-pane visibility: sidebar
   hidden ⇒ strip still present.
3. Each open file in the SPEC36 open set renders as one tab, in the
   same tree order as the sidebar's open list; the active file's tab is
   visually distinct (R10). Clicking a tab activates that file through
   the existing SPEC36 activation path (park/restore); clicking the
   active tab is a no-op.

### Tab anatomy

4. A tab shows the file's basename. Tabs have a maximum width; a name
   that does not fit is cut off with an ellipsis, and hovering the tab
   reveals the full file name (tooltip). Duplicate basenames across
   folders are acceptable in v1 — the tooltip disambiguates.
5. Each tab carries the SPEC36 trailing slot: a dirty ● when the file's
   buffer (active or parked) is dirty, swapped for a ✕ on tab hover.
   The ✕ closes through the existing SPEC36 §3.4–3.5 path: clean ⇒
   remove; dirty ⇒ activate, then the unsaved-changes modal (Save /
   Don't Save / Cancel); closing the active tab activates
   `closeOpen(...).nextActive`; closing the last open file lands on the
   splash. The ✕'s pointer events do not activate the tab.
6. Middle-click on a tab closes it through the same path as its ✕.
7. Right-click on a tab opens a context menu with **Close**,
   **Close Others**, and **Close All**. Close Others / Close All close
   files one at a time through the R5 path — each dirty file activates
   and prompts in turn; Cancel stops the remaining sequence.
8. An untitled buffer (File → New) renders as an ephemeral active tab
   labeled "Untitled", with the dirty ● when edited and a ✕ that routes
   through the existing dirty-untitled guard. It never joins the
   persisted open set; on Save As, the tab is replaced by the saved
   file's real tab (the file joins the open set as active, per SPEC36).

### Overflow

9. When the tabs exceed the strip's width, left/right arrow buttons
   appear at the strip's ends and scroll the strip; horizontal
   trackpad/wheel scrolling over the strip scrolls it too. Each arrow
   is disabled (or hidden) at its end of the range. Activating a file
   (by any means: sidebar click, tab click, Ctrl+Tab cycling, boot
   restore) scrolls its tab into view.

### Visual treatment

10. The strip's background is the same surface shade as the folder
    pane, so with the pane open the two form one continuous L-shaped
    backdrop around the workspace's top-left corner. The tabs mirror
    the sidebar pill treatment rotated to the top edge: the ACTIVE tab
    sits on the front plane — the workspace's own surface, rounded top
    corners, flush bottom, a punch-through shadow that breaks the
    strip/workspace seam (the top-edge analogue of `.selected`) — and
    casts its shadow over neighboring tabs; open-but-inactive tabs sit
    on a middle plane one shade back with a softer lift (the analogue
    of `.folder-item.open`). Colors come from existing theme variables;
    no new required theme keys.
11. With the folder pane open, the sidebar's active tab and the strip's
    active tab describe the same 3D object: the workspace surface reads
    as a page with tabs extending off its left and top edges.
12. The treatment holds in both light and dark themes (surface tints
    and shadows derive from the same variables the sidebar planes use).

### Toggle & persistence

13. A **"File Tabs"** item in the View menu (checked when on) toggles
    the strip, backed by a persisted default-on setting. The setting
    only hides/shows the strip; it never alters the open set.
14. The setting persists across launches through the existing settings
    pipeline and is desktop-only (absent or inert on web).

### Fit with existing behavior

15. Ctrl+Tab / Ctrl+Shift+Tab cycling, the sidebar's open-file rows,
    the only-open-files mode, dirty tracking, file watch, rename/delete
    remapping (`remapOpen`/`pruneOpen`), and open-set persistence are
    unchanged; the strip reflects every such change immediately (a
    rename updates the tab label and its tree-order position; a delete
    prunes the tab).
16. `npm run validate:quick` passes; new e2e coverage exercises at
    least: strip presence/absence (splash, single file, toggle off),
    tab activation, ellipsis + tooltip, dirty ●/✕ swap, middle-click
    close, context-menu Close Others with a dirty file (Cancel stops
    the sequence), overflow arrows, and the untitled ephemeral tab.

## Open questions

- None — decisions above were settled with the owner on 2026-08-19
  (interview on issue #139).
