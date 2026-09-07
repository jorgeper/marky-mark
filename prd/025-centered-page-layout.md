# PRD 025: Centered page layout

**Status:** Draft
**Date:** 2026-09-07
**Issue:** #326

## Problem

The document surface (the editor, or editor + preview) stretches to the
full window width. On a wide monitor that leaves a broad expanse of the
page colour on either side of the text, and the eye has nowhere to rest:
the text column floats inside a white field with no visible edge. The
sidebar and the comments column are pinned to the window edges, so the
wider the window, the further they drift from the text they serve.

Two secondary irritations compound it. The open-file rows in the folder
tree carry a three-plane "lifted tab" treatment (SPEC36 §4.1): every open
file gets a raised pill with a shadow, so a tree with six open files reads
as six tabs stacked on the left. And the split preview slides in from the
right on a 180 ms transform (SPEC7 §5, PRD 003 Reqs 10–11), which makes
the preview read as a second sheet laid on top of the page rather than as
the other half of the same page.

The mockups agreed for this PRD live in
`prd/images/025-centered-page-layout/` and are referenced throughout.
`mockup.html` in that folder is the throwaway sketch they were rendered
from (`?preview=1`, `?collapsed=1` switch states); it is a sketch, not an
implementation reference, and its pixel sizes are placeholders.

| # | State | Image |
|---|---|---|
| 1 | Editor only, wide window | [01-editor-wide.png](images/025-centered-page-layout/01-editor-wide.png) |
| 2 | Preview open, wide window | [02-preview-wide.png](images/025-centered-page-layout/02-preview-wide.png) |
| 3 | Editor only, narrow window | [03-editor-narrow.png](images/025-centered-page-layout/03-editor-narrow.png) |
| 4 | Both side panes collapsed, editor only | [04-panes-collapsed-editor.png](images/025-centered-page-layout/04-panes-collapsed-editor.png) |
| 5 | Both side panes collapsed, preview open | [05-panes-collapsed-preview.png](images/025-centered-page-layout/05-panes-collapsed-preview.png) |

## Goals

- The page — the surface carrying the editor (and the preview when open),
  with the file tab strip above it — is a horizontally centered, max-width
  object. Surplus window width shows as the chrome ground at the far left
  and right of the window, never between a side pane and the page.
- The folder sidebar and the comments column hug the page: sidebar
  immediately left of it, comments immediately right of it.
- The page's width is driven by the existing **Margins** setting (the
  `--mm-content-width` token), so one setting governs both the text column
  and the page that holds it. No new width setting.
- The folder sidebar reads as one flat surface: the header row loses its
  rule, and open files lose the lifted-tab planes. Only the active file is
  highlighted, with a flat theme-derived tint.
- The split preview is part of the page: it appears instantly beside the
  editor, separated by the existing divider, with no slide, no transform,
  no shadow of its own.
- No pane motion anywhere: sidebar, comments column and preview toggle
  instantly. The `prefers-reduced-motion` carve-outs for those slides
  become moot and are removed.
- The edit/preview mode toggle moves from the toolbar into the page-level
  control group at the right end of the tab strip, next to the surface it
  changes.

## Non-goals

- **A new width or "centered" setting.** The page keys off `margins`
  (`--mm-content-width`) and `paneMinWidth` (`--mm-pane-min`); neither
  gains new values or UI.
- **Changing the Margins setting's values or its effect on the text
  column.** The text column inside the page keeps its current max width;
  the page grows to fit it, not the other way round.
- **Changing the top bar.** The breadcrumb toolbar keeps its own tinted
  plane and bottom rule (a flat top bar was tried in the sketches and
  rejected). On the desktop build it keeps its height as the window drag
  region (SPEC12).
- **Changing the tab strip's contents, order, or overflow behaviour.** The
  strip keeps PRD 013's scroll rail with end arrows, fixed height,
  per-tab ellipsis, tree ordering and visibility setting. It simply sits
  above the page and moves with it.
- **Sidebar views.** The sidebar's three views (folders / outline /
  search, `sidebarView`) are untouched. Mockup 1 draws the outline under
  the tree for illustration only; the outline remains its own view.
- **Sidebar and comments widths.** `folderWidth` (drag-resizable,
  160–480 px) and the fixed 300 px comments column stay exactly as they
  are. Neither pane gains breakpoints or auto-collapse at narrow widths.
- **Removing the open-file affordances in the tree.** The trailing dirty
  dot / close button on open rows (SPEC36 §3.4/§3.6) stay; only their
  lift, shadow and background go.
- **The corner stack.** The word-count chip, comment navigator and zoom
  control stay fixed to the window corner (SPEC16 §5). Mockups draw the
  chip inside the page; that is incidental.
- **Print output.** Print keeps its current rules; the ground, shadow and
  centering are screen-only.
- **New chrome colours.** Every colour in this PRD resolves through
  existing tokens (`--mm-bg`, `--mm-bg-elevated`, `--mm-border`,
  `--mm-hover`, `--mm-panel-shadow`); themes need no changes.
- **Anything about tables, images, diagrams or the editor's internal
  layout.** The page's inner content is out of scope; only its frame
  moves.

## Requirements

### A. The page

1. The page is one surface comprising the file tab strip (when shown),
   the editor pane, and the preview pane (when open). Its background is
   `--mm-bg`; the body row behind it (the ground) is `--mm-bg-elevated`.
   The folder panel and the comments pane already paint
   `--mm-bg-elevated`, so ground and panes are one continuous plane.
2. The page is horizontally centered in the space left after the open
   side panes take their widths. When the window is wider than the
   cluster (open sidebar + page at its max + open comments column), the
   surplus appears as ground **outside** the cluster, split equally left
   and right. There is never ground between a side pane and the page.
3. **Editor-only max width.** The page's inner width (excluding its own
   horizontal padding) is `max(var(--mm-content-width), var(--mm-pane-min))`.
   Changing the Margins setting changes the page width live, exactly as
   it changes the text column today.
4. **Preview-open max width.** With the split preview open the page's
   inner width is `2 × max(var(--mm-content-width), var(--mm-pane-min))`
   plus the divider's width. Each half floors at `--mm-pane-min` as today.
5. **Shrinking.** When the window cannot fit the cluster at the page's
   max width, the page gives up width first, down to `--mm-pane-min`
   (`2 × --mm-pane-min` + divider with preview open). Side panes keep their
   widths. Below that floor the workspace scrolls horizontally, exactly
   as it does today; no new breakpoints.
6. When any side pane is open the page has a top-left and top-right
   radius of `--mm-radius-small` and casts `--mm-panel-shadow` onto the
   ground. The `.workspace-stack::after` "seam painted once" overlay
   (PRD 013 Reqs 10–12 / SPEC36 §4.1), which today paints an L-shaped
   shadow onto the strip, sidebar and comments pane, is removed; the
   page's own shadow replaces it.
7. **Both side panes closed** (or absent, as in the static web build):
   the page spans the full window width below the tab strip, with no
   radius and no shadow. The text column stays centered at
   `--mm-content-width` inside it, exactly as the workspace centers `.doc`
   today (mockups 4 and 5).
8. **One pane open, one closed:** the same rule as Req 2 with one fewer
   member — the open pane and the page form the cluster, centered as a
   unit, page keeps its radius and shadow. No special case.
9. The page's width changes take effect instantly on toggle and on window
   resize. No width, transform or opacity transition is applied to the
   page, the sidebar, the comments column or the preview pane.

### B. Side panes hug the page

10. The folder sidebar (all three views) is the cluster's left member: its
    right edge touches the page's left edge (the existing `--mm-folders`
    width and drag divider unchanged). Its header row and tree therefore
    sit immediately left of the page, not at the window's left edge.
11. The comments column is the cluster's right member: its left edge
    touches the page's right edge. It keeps its fixed 300 px width and is
    present whenever `showComments` is on, regardless of how many comments
    the document has, so the page does not shift when the first comment is
    added. Cards keep their line anchoring inside the column.
12. The sidebar and comments-column toggles (edge chevrons, View menu
    rows, hotkeys) keep working; the pane appears or disappears instantly
    (Req 9). The `.folder-slide` / `.comments-slide` 180 ms width and
    transform transitions and their `preview-sliding`-style phase classes
    are removed, along with the `prefers-reduced-motion` rules that existed
    only to skip them.

### C. Sidebar simplification

13. The sidebar header row (`.folder-header`, and its outline and search
    equivalents) loses its `border-bottom`. It keeps its height, padding,
    controls and its `--mm-bg-elevated` background, so it reads as the
    icons sitting directly above the tree on the same ground.
14. The three-plane treatment for open files is removed: `.folder-item.open`
    gets no background, no `box-shadow`, no `z-index` and no pill
    geometry (no left margin, no radius, no min-width). The
    `--mm-lift-row` / `--mm-lift-row-active` tokens go with it.
15. The active file (`.folder-item.selected`) is the only highlighted row:
    a flat full-width background of `--mm-hover`'s tint at selection
    strength (`color-mix(in srgb, var(--mm-accent) 14%, transparent)`,
    declared once as an internal token), `--mm-radius-small` corners, bold
    label, no shadow. Hover on other rows stays `--mm-hover`.
16. Open rows keep their trailing slot (dirty dot / close button) and the
    outline and search views keep their current row styling.

### D. Tab strip and page controls

17. The file tab strip sits on the ground directly above the page,
    left-aligned to the page's left edge and spanning the page's width.
    The active tab is joined to the page: same `--mm-bg`, no bottom edge
    between tab and page. Inactive tabs are flat quiet pills on the ground
    (`--mm-bg-elevated` with a `--mm-border` outline), no lift shadow. The
    `--mm-lift-tab` / `--mm-lift-tab-active` tokens are removed.
18. The strip's look is identical in every state, including both panes
    closed (mockups 4 and 5), where it simply spans the full width.
19. The existing page-level control group at the strip's right end stays
    where it is. The edit/preview **mode** toggle (`edit-toggle`, the
    "Preview ⌘E" / "Edit ⌘E" button) moves from the toolbar into that
    group as its last member, keeping its label, hotkey, testid and
    behaviour, styled as a quiet button (`.btn-quiet`). The toolbar no
    longer renders it.
20. In builds without the strip (no `multiFileSession`), the mode toggle
    still leaves the toolbar and renders in a page-level control row at the
    page's top-right, so the toggle's position is the same across builds.
21. When both side panes are closed, the sidebar's reopen chevron and the
    comments' reopen chevron remain reachable at the page edges as today;
    the strip's control group does not absorb them.

### E. Preview in-plane

22. Toggling the split preview mounts or unmounts `.split-preview` in
    place with no `preview-sliding` / `preview-out` / `preview-pre`
    phases, no `transform`, no `transition` and no `will-change`. The
    editor's width changes in the same frame.
23. The divider between editor and preview is the existing
    `.split-divider` (its 1 px `--mm-border` hairline and hover accent
    stay). The `--mm-split-edge-shade` inset shade is removed so the two
    halves read as one plane.
24. Each half keeps its own scrollbar and the existing sync-scroll
    behaviour.
25. Dragging the divider keeps working within the page (`--mm-split`,
    ratio clamped 0.2–0.8, double-click resets). The page's width does not
    change with the ratio; only the split point moves.
26. `paneMinWidth` keeps its meaning: each half's content floors at
    `--mm-pane-min` and the pane scrolls horizontally below it.

### F. Builds and themes

27. Desktop and hosted builds get every requirement. The static
    single-file web build, which has no sidebar and no tab strip, gets
    A, E, the comments-column placement in B, and Req 20; its page is
    therefore always in the both-panes-closed form unless comments are
    open.
28. All colours, radii and shadows introduced or changed resolve through
    chrome tokens per PRD 018; the style lint passes with no new literal
    colours outside a token definition. Every bundled theme renders the
    ground / page contrast without theme edits (dark themes get their own
    darker `--mm-bg-elevated` ground automatically).

### G. Spec amendments and test updates

29. The following are amended by this PRD and their citations updated:
    SPEC7 §5 (split slide), PRD 003 Reqs 10–11 (pane slides), SPEC34
    (sidebar header rule), SPEC36 §4.1 and PRD 013 Reqs 10–12 (three
    planes, the seam), PRD 023 §14–15 (comments column placement).
30. E2E tests that assert the removed behaviour are rewritten to assert
    the new one, not deleted: the plane assertions in `file-tabs.spec.ts`
    (E353, E306) and `folder-tree.spec.ts`; the slide assertions in
    `split-view.spec.ts`, `shell-and-menus.spec.ts` and `comments.spec.ts`.
    New tests cover: the page centered with equal ground on both sides at
    a wide viewport; page width tracking the Margins setting (editor-only
    and ×2 with preview); the both-panes-closed full-width form; the
    absence of transitions on toggle; the mode toggle rendered in the
    strip's control group and absent from the toolbar; the active-file
    row being the only tinted row in the tree.

## Open questions

- None. Decisions taken during grilling: widths derive from the existing
  Margins setting (editor-only = content width, preview = ×2); one pane
  open keeps the cluster rule; comments column always reserves its width
  when on; open-file affordances stay; mode toggle keeps its label; no
  motion anywhere; all three builds for the surfaces they have; ground
  and page colours come from theme tokens.
