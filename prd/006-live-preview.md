# PRD 006: Live preview — inline rendering in the edit pane

**Status:** Draft
**Date:** 2026-08-03

## Problem

Editing markdown in Marky Mark means either staring at raw syntax in the
edit pane or splitting the window to see the rendered result beside it.
Writers who live in Obsidian or Typora expect the document to *look*
formatted while they type — bold text bold, headings big, links clickable —
with raw syntax appearing only where they are actively editing. Issue #41
asks for a prototype of that experience.

The edit pane is already partway there: tables render as grids (SPEC40),
images render inline (SPEC41), and markdown syntax gets highlighted
(SPEC23). What's missing is the rest of the live-preview illusion: hiding
the markers and painting the formatting for text-level and block-level
constructs.

## Goals

- An Obsidian-style Live Preview mode for the existing CodeMirror edit
  pane: markdown renders in place, raw syntax reveals on the active line.
- Shipped as an experimental opt-in so the prototype can land without
  destabilizing the editor everyone uses today.
- Zero regression to the editor with the toggle off, and no breakage of
  edit-adjacent features (split view, scroll sync, mirrored selection,
  vim nav, comments, find) with it on.

## Non-goals

- **Typora-style WYSIWYG.** No collapsing of edit/view into a single
  mode; the view mode, edit mode, and split view all remain as they are.
- **An editable preview pane.** The rendered preview stays read-only; we
  do not round-trip HTML back to markdown.
- **Making live preview the default.** Promotion out of experimental is a
  separate future decision with its own issue.
- **Interactive widgets beyond the two chosen probes.** No link-editing
  popovers, heading folding, drag handles, or slash menus. Task-list
  checkboxes and cmd/ctrl-click on links are the only interactions.
- **Per-token reveal.** The prototype reveals whole lines (or enclosing
  multi-line constructs), not individual constructs under the cursor.
  Obsidian-grade token-level reveal is future polish.
- **New markdown syntax.** Only constructs the preview pane already
  renders are in scope; no math, footnotes, or embeds.

## Requirements

1. Settings gains a **"Live preview (experimental)"** toggle, **off by
   default**, persisted alongside the other editor settings.
2. With the toggle **off**, the edit pane behaves exactly as it does
   today — including the SPEC23 markdown-highlighting setting. All
   existing editor e2e tests pass unchanged.
3. With the toggle **on**, inline formatting renders in place with its
   markers hidden: bold, italic, strikethrough, and inline code display
   styled, without the `**` / `*` / `~~` / `` ` `` characters.
4. Headings render at their heading size/weight with the leading `#`
   markers hidden.
5. Links display their link text styled as a link with the `[text](url)`
   syntax hidden; **cmd/ctrl-click opens the URL** the same way links open
   from the preview pane.
6. Block elements render: blockquotes show the quote bar styling with `>`
   markers hidden, list items show bullets/numbers, horizontal rules draw
   as rules, and code fences hide the ` ``` ` fence lines while the code
   body keeps its highlighting.
7. Task-list items render as real checkboxes; **clicking a checkbox
   toggles `[ ]`/`[x]` in the source** as a single undoable edit. This is
   the only widget interaction besides link cmd/ctrl-click; clicking any
   other rendered construct simply places the cursor there.
8. **Reveal rule:** the line containing the cursor shows its raw
   markdown; for multi-line constructs (code fences, and any construct
   that cannot reveal line-by-line) the whole construct reveals when the
   cursor is inside it. A selection reveals every line it touches.
9. Rendering is **presentation-only**: the document text remains the
   markdown source. Typing, undo/redo, find, selection offsets, and file
   contents are unaffected by what is hidden or painted.
10. Live preview styling uses the current theme's tokens so the rendered
    constructs match the preview pane's look in both light and dark
    themes.
11. With the toggle on, the edit-adjacent features keep working: split
    view and its scroll sync, mirrored selection, vim nav, comments, and
    find. Any interaction broken by live preview is a bug, not a known
    limitation.
12. While live preview is on, the SPEC23 markdown-highlighting setting is
    superseded: it has no additional effect, and revealed (raw) lines use
    the existing highlight styling.
13. Typing latency stays acceptable on large documents: decorations are
    computed for the viewport, not the whole document, and editing the
    largest fixture document shows no perceptible lag with the toggle on.

## Open questions

_None — resolved during the PRD interview (2026-08-03)._
