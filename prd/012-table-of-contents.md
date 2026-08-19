# PRD 012: Table of Contents

**Status:** Draft
**Date:** 2026-08-19

## Problem

Navigating a long document today means either scrolling or knowing what you
are looking for: the heading palette (SPEC16, `Mod+K`) is fast but blind —
you must already have a heading name in mind, and it shows nothing of the
document's shape. There is no persistent, glanceable view of a document's
structure, and no way to jump around a large file while keeping that
structure in sight. Users reading or editing long Markdown files (specs,
PRDs, books) want the sidebar to double as an outline: see the heading
hierarchy, expand and collapse it like folders, and click to navigate.

## Goals

- A Table of Contents (TOC) view of the current document's headings lives in
  the existing sidebar pane, switchable with the folder tree.
- One click jumps to any heading, in view mode and edit mode alike.
- The TOC tracks the reader: the section currently in view is highlighted as
  the document scrolls.
- The whole feature is keyboard-reachable via a remappable hotkey, exactly
  like the folders pane today.

## Non-goals

- **No depth-limit setting.** The TOC always shows all heading levels H1–H6.
- **No insert-TOC command.** This PRD never writes a TOC into the document
  text; it is chrome, not content.
- **No filter/search box in the TOC.** Fuzzy heading search already exists
  (heading palette, `Mod+K`); the TOC does not duplicate it.
- **No multi-file TOC.** The TOC reflects the single active document only.
- **No export integration.** Exported/printed documents are unchanged.
- **No new persistence file.** Collapse state is session memory only —
  nothing like `foldertree.json` is written for the TOC.
- **No side-by-side panes.** Folders and TOC are mutually exclusive views of
  the one sidebar; they never show simultaneously.

## Requirements

Numbered, testable statements. Each becomes acceptance criteria on an issue.

1. The sidebar pane has two mutually exclusive views: **Folders** (the
   existing SPEC34/SPEC36 tree, unchanged) and **TOC**. Exactly one view
   renders at a time; switching views never loses folder-tree state (roots,
   expansion, selection survive a round-trip through the TOC view).
2. The TOC view shows the heading tree of the active document: every H1–H6,
   in document order, each child indented under its nearest shallower
   heading. The tree is derived from the section model
   (`src/lib/sectionModel.ts`) — the same mdast parse the app already runs —
   never from scraping rendered HTML. Headings inside fenced code blocks
   therefore do not appear.
3. Two headings with identical text are distinct TOC entries (positional
   identity, as the section model already provides); clicking each navigates
   to its own occurrence.
4. TOC entries with child headings expand and collapse like folder rows
   (same disclosure interaction). Entries default to expanded. Manual
   collapse state is remembered per file for the app session only and is
   discarded on restart.
5. Clicking a TOC entry in view mode scrolls the document so that heading is
   at the top of the viewport, using the same scroll path the heading
   palette uses today.
6. Clicking a TOC entry in edit mode scrolls the editor to the heading's
   source line and places the cursor on it.
7. The TOC highlights the entry for the section currently at the top of the
   viewport, updating as the user scrolls, in both view and edit modes. When
   the active section's entry is hidden inside a collapsed ancestor, the
   ancestors auto-expand to reveal it.
8. While editing, the TOC re-derives from the buffer (debounced) so new,
   renamed, or deleted headings appear without saving. A document with no
   headings shows an empty-state message in the TOC view, not a blank pane.
9. A TOC toolbar button sits next to the existing folders button. Pressing
   it shows the sidebar in TOC view (opening the sidebar if hidden);
   pressing it while the TOC is already showing hides the sidebar. The
   folders button behaves symmetrically for its view. Each button indicates
   when its view is the one showing.
10. A `toggleToc` hotkey (default `Mod+Shift+T`) performs exactly the action
    of the TOC toolbar button. It is a standard entry in the existing
    hotkeys map — remappable in settings, persisted, and conflict-checked
    like every other binding. `Mod+Shift+E` keeps its existing meaning for
    the folders view.
11. Which view the sidebar last showed (folders or TOC) is a persisted
    setting; on restart the sidebar reopens in that view. Sidebar
    visibility and width keep their existing SPEC34 persistence unchanged.
12. The TOC view works with no folder root open and on every platform
    (desktop and web): it depends only on the active document, never on the
    folder-tree seams.
13. The TOC's pure logic (tree derivation from section nodes, collapse-set
    handling, active-section resolution from a scroll position) lives in a
    unit-tested `src/lib/` module; the React component stays a pure view in
    the FolderPanel mold.

## Open questions

- None.
