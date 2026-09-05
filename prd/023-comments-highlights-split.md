# PRD 023: Comments & highlights split

**Status:** Draft
**Date:** 2026-09-05

## Problem

PRD 022 shipped highlights as an extension of comments: one record type, one
selection popup, a note is what makes a highlight a "comment". In practice the
two are different tools — a comment is a text note you want to read and reply
to; a highlight is a color mark you want to see and nothing more — and the
merged model forces awkward UX everywhere: the selection popup crowds every
selection with swatches, edit mode bounces the user into preview to author a
note (SPEC25 carry), comments have no home in plain edit mode at all, and the
comment aside lives *inside* the preview surface instead of being a first-class
pane. The owner wants the features split, the popup killed, entry points moved
into the Marky Mark smart-edit menu, and a dedicated comments pane
(issue #276).

Marky Mark is unreleased, so backwards compatibility carries no weight: the
comment format may break freely.

This PRD supersedes the interaction model of PRD 022 (Reqs 1–4, 6, 8–9 and the
blue marker) while keeping its anchoring, decoration, and copy-link machinery.

## Goals

- Comments and Highlights are two distinct features with distinct storage,
  rendering, and management surfaces.
- One consistent authoring UX in every mode — editor, preview, and split — with
  no mode bouncing, reachable from the Marky Mark menu, hotkeys, and a preview
  selection button.
- Comments live in a dedicated third pane with the same chevron/slide idiom as
  the existing panes.
- Comments reach copy-link parity with highlights.

## Non-goals

- **No migration of 1.x comment stores.** Pre-2.0 sidecar/embedded data is not
  upgraded; those files' annotations are simply unavailable (they must never
  crash the app).
- **No grandfathering of blue highlights.** Blue leaves the highlight
  vocabulary entirely; it is not parsed, rendered, or offered.
- **No `==markdown==` highlight syntax** (unchanged from PRD 022).
- **No custom colors** beyond the four fixed marker colors; no per-color
  hotkeys.
- **No resizable or responsive comments pane** — fixed width, no
  window-width breakpoints; narrow windows scroll as today.
- **No highlights in the comments pane** — no standing cards, no transient
  cards, no "add note to a highlight" flow (a note near a highlight is a
  separate comment).
- **No type-to-comment** — pressing a printable key over a selection no longer
  opens a composer.
- **No preview text-editing entries** — the preview selection button offers
  annotation entries only, never Table/Image/formatting.

## Requirements

### Data model

1. The comment format bumps to **2.0.0**. Every record carries an explicit
   `kind` field: `"comment"` or `"highlight"`. Comment records carry
   `body`/`thread`/`resolved` and **no color field**; highlight records carry
   `color` and no `body`/`thread`/`resolved`. Anchor schema, byte-stable key
   order, and the writer/reader rules of PRD 004 (lowest-representative-version
   stamping, frozen-store behavior for newer MAJOR) are retained.
   `docs/COMMENT-FORMAT.md` documents the new schema with a changelog entry.
2. The highlight color vocabulary is exactly **yellow, green, orange, pink**.
   `blue` is invalid at parse (record dropped, not crashed). Marker tint
   tokens gain orange and drop blue, meeting WCAG AA in bundled themes as
   PRD 022 Req 13 required.
3. Comments always render in one fixed **blue** tint, defined as
   theme-overridable tokens in the document-rendering region of `styles.css`
   (distinct from the four marker colors).
4. Opening a document whose store predates 2.0.0 shows no annotations and no
   error dialog; the app never crashes on legacy or malformed stores. Saving
   new annotations writes a 2.0.0 store.
5. A comment and a highlight may overlap the same or intersecting ranges as
   independent layers; both render, and activating one never mutates the
   other.

### Killing the popup

6. The selection popup is removed in both surfaces: no `marker-popup` in
   preview, no `marker-popup-edit` in edit mode, and no SPEC25 carry-into-
   preview bounce for comment authoring. Type-to-comment (printable key over a
   selection opening the composer) is removed with it.

### Marky Mark menu entry points

7. The smart-edit menu (SPEC43) gains two entries below **Diagram**:
   **Comment** and **Highlight**, present in both desktop and hosted builds,
   gated by the same authoring conditions as today's affordance
   (`commentsEnabled`, not frozen, `canWrite`).
8. **Comment** is a context-aware submenu: with a selection (or a word under
   the caret) it offers **Insert Comment** showing its hotkey; with the caret
   on an existing comment's range it offers **Delete Comment**. Insert Comment
   creates the comment and opens it in the comments pane with the composer
   focused, ready to type — never switching modes.
9. **Highlight** is a submenu of the four marker colors. With a selection,
   picking a color inserts a highlight in that color (**selection always wins**
   over caret context). With no selection and the caret on an existing
   highlight, the same submenu recolors that highlight, and an additional
   **Remove Highlight** entry deletes it.
10. In the editor, when nothing is selected, both Insert Comment and the color
    entries anchor to the **word under the caret**; with no selection and no
    word (empty line), the entries are disabled.
11. The last-used marker color remains a user-scoped setting (PRD 022 Req 4
    semantics) and is the color applied by the highlight hotkey.

### Hotkeys

12. Two new rebindable hotkeys with defaults **`Mod+Alt+M`** (Insert Comment)
    and **`Mod+Alt+H`** (Highlight in last-used color), registered in the
    hotkey map, Settings → Hotkeys recorder, and shown in the menu rows via
    the standard `displayCombo` rendering. They work in the editor (with the
    word-under-caret fallback of Req 10) and in the preview (selection
    required there).

### Preview authoring

13. In the preview pane, selecting text shows the blue Marky Mark button to
    the left of the selection. Clicking it opens a menu offering **only** the
    Comment and Highlight entries of Reqs 8–9 (no text-editing entries). It
    dismisses on Esc, outside pointerdown, scroll, and selection collapse.

### The comments pane

14. A third pane on the right of the workspace hosts all comments. A second
    chevron, to the right of the preview pane's chevron, opens and closes it
    with the PRD 003 slide idiom (180 ms slide, reduced-motion skip). It gets
    the folder pane's second-plane treatment: `--mm-bg-elevated` background
    layer with the workspace cast-shadow seam, resolved through existing
    style-guide tokens.
15. The pane is **closed by default**; its open/closed state persists across
    sessions. Inserting a comment auto-opens it. It is fixed at 300 px wide
    and hidden in print.
16. The pane is the single home for comments in **all** modes — plain edit,
    full preview, and split — and the PRD 022-era in-preview comment aside is
    removed. Cards keep today's flow behavior (Word-style balloon flow,
    active-card accent, resolved section) but lose their recolor swatches;
    they retain note editing, reply/resolve threads, remove, and copy-link.
17. `Mod+Shift+C` and View → Comments now toggle the comments pane. The
    comment navigator (pill + `Mod+Alt+ArrowUp/Down`) and the
    `commentsEnabled` master switch keep their current meaning; with comments
    disabled the pane, chevron, marks, and menu entries are absent.

### Rendering and sync

18. Commented ranges render a subtle blue mark in **both** editor and preview;
    highlight ranges render their marker color in both. Clicking a comment
    mark opens the pane (if closed) and activates that card; activating a card
    scrolls the text to its anchor — two-way sync. Clicking a highlight has no
    pane effect.
19. Editor-side authoring maps the editor selection/caret to rendered-text
    anchors; where the mapping is ambiguous the entries are disabled rather
    than mis-anchored (the PRD 022 Req 12 skip rule, extended to authoring).

### Links

20. Comment cards gain the copy-link affordance using the existing `#hl-`
    fragment namespace and landing behavior (scroll + flash, miss notice).
    Copy-link remains **hosted-only** (PRD 020 Req 15); everything else in
    this PRD applies to desktop and hosted builds alike.

### Verification

21. Unit coverage for the 2.0.0 format (parse/serialize/kind rules/blue
    rejection) and menu context model; e2e coverage for pane
    open/close/persist, menu insert/delete/recolor/remove flows in editor and
    preview, hotkeys, overlap rendering, two-way sync, and comment copy-link.
    Existing comment/highlight suites are updated to the new UX rather than
    deleted wholesale; `docs/MAP.md` is regenerated after citation moves.

## Open questions

- None — all decisions above were settled in the grilling session on
  issue #276 (2026-09-05).
