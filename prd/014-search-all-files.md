# PRD 014: Search Across All Files

**Status:** Draft
**Date:** 2026-08-19

## Problem

Finding something in Marky Mark today stops at the edge of the open
document: `Mod+F` searches the current buffer, the heading palette jumps
within it, and the folder tree only browses names. Anyone working in a
folder of notes or specs — exactly the workspaces the sidebar was built
for — has to remember which file holds a phrase, or leave the app to grep.
The in-document find bar is also barer than it should be (issue #127): no
whole-word or regex options, and its hit/no-hit state is too quiet to
trust at a glance. This PRD adds workspace-wide search and brings the
in-file find bar up to the same option set.

## Goals

- A query typed once finds every occurrence across all files in the folder
  tree, grouped by file, one click from the match itself.
- The same query options everywhere: case sensitivity, whole word, and
  regex work identically in cross-file search and the in-file find bar.
- Search state is unmissable: match counts, highlighted hits, and a loud
  no-results state on both surfaces (issue #127's ask).
- Works wherever the folder sidebar works — desktop, browser virtual fs,
  and hosted workspaces — through the existing platform seams.

## Non-goals

- **No replace.** Neither in-file nor across files; bulk writes, dirty
  buffers, and cross-file undo make replace its own future effort.
- **No persistent index.** Every search is an on-demand scan; nothing is
  written to disk and no index is maintained between searches.
- **No non-markdown content.** Only the markdown files the folder tree
  shows are searched; binaries, images, sidecars, and dotfiles are not.
- **No search history or saved searches.** The query box is stateless
  between sessions.
- **No multi-query or filter syntax.** No `path:`/`file:` operators,
  include/exclude globs, or boolean operators in v1.

## Requirements

Numbered, testable statements. Each becomes acceptance criteria on an issue.

1. The sidebar gains a **Search** view alongside Folders and TOC, following
   PRD 012's mutually-exclusive-views pattern: exactly one view renders at
   a time, and switching to Search and back loses no folder-tree or TOC
   state.
2. A Search toolbar button sits beside the folders and TOC buttons with the
   same semantics: pressing it shows the sidebar in Search view (opening
   the sidebar if hidden and focusing the query box); pressing it while
   Search is showing hides the sidebar; the button indicates when its view
   is active.
3. A `searchAllFiles` hotkey (default `Mod+Shift+F`) performs exactly the
   toolbar button's action. It is a standard entry in the existing hotkeys
   map — remappable in settings, persisted, conflict-checked like every
   other binding.
4. The search scope is the markdown files visible in the folder tree:
   every root, dotfiles and dot-directories excluded, on any platform that
   provides the folder seams (`readDirEntries`/`readTextFile`). With no
   folder root open, the Search view states that plainly instead of
   showing an empty result list.
5. Files currently open with unsaved edits are searched in their in-memory
   buffer content, not their stale on-disk content.
6. The default query is a case-insensitive literal substring. Three toggles
   on the query box modify it: case-sensitive, whole-word, and regular
   expression. Toggle states combine (e.g. case-sensitive regex) and are
   reflected in the results live. An invalid regex shows an inline error on
   the query box and searches nothing — it never throws or silently falls
   back to literal matching.
7. Results update live as the user types (debounced) and are grouped by
   file: filename matches (files whose name matches the query) list first,
   then content matches — each file showing its match count and its
   matching lines with the hit highlighted in context. File groups
   collapse and expand.
8. Clicking a content match opens that file, scrolls to the match, and
   highlights it in the pane it opens in; clicking a filename match opens
   the file. Opening a result never loses the result list — the Search
   view keeps its query and results until the user changes them.
9. The Search view's state is unmissable: a total match count (files and
   matches) while results exist, a visually loud no-results state when the
   query matches nothing, and a scanning indicator while a search is in
   flight. Searching never blocks the UI; typing, navigation, and editing
   stay responsive during a scan, and a superseded query's late results
   never overwrite a newer query's.
10. The in-file find bar (`Mod+F`) gains the same three toggles —
    case-sensitive, whole-word, regex — with identical semantics to the
    Search view's, closing issue #127's options ask.
11. The in-file find bar's hit state stands out (issue #127): a current/
    total match counter, high-contrast highlighting of all matches with
    the current one distinct, and an unmistakable no-match state on the
    bar itself.
12. The search logic — query compilation from the toggle states, per-file
    match extraction with line context, result grouping and ordering — is
    a pure, unit-tested `src/lib/` module shared by both surfaces, so an
    option behaving one way in the find bar and another in the Search view
    is a test failure, not a review catch. E2e coverage exercises a
    multi-file search, each toggle, the no-results state, and
    click-to-open on both filename and content matches.

## Open questions

- None.
