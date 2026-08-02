# PRD 003: Pane chevrons and slide animations

**Status:** Draft
**Date:** 2026-08-02

## Problem

Closing a side pane is easy; getting it back is not.

The folder pane's header carries an X (`data-testid="folder-close"`,
`FolderPanel.tsx`). Clicking it unmounts the pane completely — nothing
remains on the left edge — so reopening requires the View → Folders menu,
the `Mod+Shift+E` hotkey, or knowing that the setting exists at all. The
close affordance and the open affordance live in different places.

The split preview is worse: it has no close control at all. Hiding it means
flipping the Split Edit setting via menu, hotkey (`Mod+\`), or the Settings
panel checkbox.

The owner wants a single, always-visible toggle per pane: a chevron that
points toward the edge the pane collapses into when the pane is open, and
points back into the window when it is closed — click to close, click to
reopen, always in the same place. And when a pane opens or closes it should
slide, like the toolbar already does, instead of popping in and out.

## Goals

- Each side pane (folder pane on the left, split preview on the right) has a
  chevron toggle that is visible in both the open and the closed state, so
  opening and closing is one click in one place.
- The chevron's direction always communicates what clicking does: it points
  in the direction the pane edge will move.
- Panes slide open and closed with the app's existing motion language (the
  toolbar's 180ms ease transform) instead of appearing/disappearing
  instantly.
- All existing ways of toggling the panes (menu items, hotkeys, Settings
  checkbox) keep working and stay in sync — the chevrons are a new surface
  over the same state, not a new state.

## Non-goals

- No new persisted settings or state keys. The chevrons flip the existing
  `showFolders` and `splitEdit` settings (both machine-scope `M`), with the
  same persistence to `settings.json` as today.
- No changes to the View → Folders / View → Split Edit menu items, the
  `Mod+Shift+E` / `Mod+\` hotkeys, or the Settings panel's Split Edit
  checkbox — they remain and stay in sync.
- No change to the other folder-pane header buttons (open-files-only,
  filter, sync) or to pane resizing (`folderWidth` drag, `splitRatio` drag
  and double-click reset).
- No folder chevron outside workspace mode, and none in the web build —
  the web build has no folder seam and must keep zero folder-pane DOM
  (web e2e W12 stays green).
- No preview chevron outside edit mode: full preview mode (`mode ===
  'preview'`) is a different surface, not a "closed preview", and gets no
  chevron.
- No animation work beyond these two panes: the toolbar slide, the
  preview/edit mode swap, the comments panel, and everything else are
  unchanged.
- No icon library. Chevrons are hand-written inline SVGs like the existing
  `Chevron` component in `FolderPanel.tsx` (which gains a left-pointing
  variant or a rotation).

## Requirements

### Folder pane (left)

1. The folder pane header's X close button is replaced, in the same header
   slot, by a left-pointing chevron button that closes the pane
   (`showFolders → false`). It carries `data-testid="folder-collapse"`, a
   tooltip, and an `aria-label` (e.g. "Hide the folder panel").
2. When the folder pane is closed — in workspace mode, on platforms that
   have the folder seam (desktop and the dev/e2e shim) — a right-pointing
   chevron button stays pinned at the top-left edge of the workspace,
   vertically aligned with where the pane header sits when open. Clicking
   it reopens the pane (`showFolders → true`). It carries
   `data-testid="folder-expand"`, a tooltip, and an `aria-label` (e.g.
   "Show the folder panel").
3. The closed-state chevron does not overlap or obscure document content
   beyond its own compact hit target (comparable to the existing header
   buttons' hit area), and renders correctly in both light and dark themes.
4. The chevrons flip only `settings.showFolders`; the View → Folders
   checkmark, `Mod+Shift+E`, and reload persistence all reflect chevron
   clicks (extends e2e E94), and a pane closed via chevron stays closed
   until explicitly reopened (extends e2e E95).
5. In the web build there is no folder chevron in either state, and outside
   workspace mode (splash, single-file) neither folder chevron renders.

### Split preview (right)

6. When the split preview is open (`mode === 'edit'` and
   `settings.splitEdit`), a right-pointing chevron button sits at the
   preview's top-right corner and closes the preview (`splitEdit → false`,
   i.e. today's full-screen editor). It carries
   `data-testid="preview-collapse"`, a tooltip, and an `aria-label` (e.g.
   "Hide the preview pane").
7. When the preview is closed (`mode === 'edit'`, `splitEdit` off), a
   left-pointing chevron button stays pinned at the top-right edge of the
   full-screen editor and reopens the split (`splitEdit → true`). It
   carries `data-testid="preview-expand"`, a tooltip, and an `aria-label`
   (e.g. "Show the preview pane").
8. The preview chevrons flip only `settings.splitEdit`; the View → Split
   Edit menu item, `Mod+\`, and the Settings panel checkbox
   (`set-split-edit`) all stay in sync with chevron clicks (extends e2e
   E84).

### Slide animations

9. Opening and closing the folder pane animates as a horizontal slide from
   / toward the left edge, using the app's existing motion language: a
   transform transition of ~180ms ease with `will-change: transform`, as
   `.toolbar-shell` does. The workspace content follows without visual
   tearing. (Implementation note: the pane currently unmounts when hidden;
   it must remain in the DOM for the duration of the exit transition, or an
   equivalent technique, for the slide to be visible.)
10. Opening and closing the split preview animates as a horizontal slide
    from / toward the right edge with the same duration and easing.
11. When `prefers-reduced-motion: reduce` is set, both panes switch
    instantly with no slide. (First use of this media query in the app —
    apply it to these transitions only.)
12. Toggling a pane via any surface (chevron, menu, hotkey, Settings
    checkbox) produces the same animation; end state and persistence are
    identical to an instant toggle.

### Test coverage

13. E2e tests cover: chevron close + edge-chevron reopen for both panes;
    tooltip/aria labels (extends E93's tooltip sweep); menu/hotkey/settings
    sync (E94, E84); the animation observable via a polled `transform`
    interpolation as E25 does for the toolbar; and W12 confirming the web
    build stays chevron-free. Existing tests targeting the removed
    `folder-close` testid are updated to the new controls.

## Open questions

None — placement (edge tabs at top-left / top-right), animation scope
(included, both panes), and state model (reuse `showFolders` / `splitEdit`)
were settled with the owner during the PRD interview.
