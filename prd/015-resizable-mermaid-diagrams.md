# PRD 015: Resizable Mermaid Diagrams

**Status:** Draft
**Date:** 2026-08-20

Issue: #166.

## Problem

A ```mermaid fence renders as its diagram (PRD 013) at whatever width
mermaid lays out — capped to the pane and otherwise untouchable. Images
got the opposite treatment in SPEC20: click one in the preview, drag a
corner handle, and the size persists into the document as portable
`width`. Readers who lay out a document with both now meet two rules for
one idea: a picture you can size and a diagram you cannot. The owner
wants diagrams to "behave like images" — handles on click, the drawing
stays a drawing (no drop to the raw fence), the size survives a save.

## Goals

- In the preview pane, a rendered mermaid diagram is selected on click
  and resized by dragging corner handles — the same overlay, gesture and
  feedback the SPEC20 image resize already gives.
- The chosen width persists **in the document**, in-band and portable:
  GitHub and every CommonMark renderer still draw the diagram, and a
  document never grows a sidecar or a private syntax.
- Every surface that draws the diagram honors the persisted width — the
  preview and the edit-pane widget alike.
- Nothing else moves: comment anchors, the sanitize schema, the mermaid
  render cost and the fence's own text are all exactly what they are today.

## Non-goals

- **No diagram editing.** Selection never exposes the fence text; reaching
  it is still a switch to edit mode (PRD 013 Req 5's widget yields to the
  caret there as before). No node inspector, no in-diagram drag.
- **No `height`, no free-form stretch.** One number, aspect locked, like
  images. A `height=` token is never written and never read.
- **No enlarging past natural size.** The vector would stay crisp, but a
  persisted "zoom" is a view feature, not a document size; the bounds are
  the image bounds (Req 6). Pan/zoom of diagrams is a separate effort.
- **No handles in the edit pane.** Mirrors SPEC20 §4.2 ("not the
  split-edit pane"); the editor widget draws the width but offers no
  handles.
- **No session-only resize on read-only documents.** Where the document
  cannot be edited (a PRD 007 viewer role), there is nothing to click.
- **No export/print change.** Exports keep mermaid fences as code (PRD 013
  non-goal); the width token rides along in the fence line untouched.
- **No other fence languages.** The width token is defined for fences with
  a registered renderer; with mermaid the only registration, that is
  mermaid. A future registration inherits it for free but is not tested
  here.
- **No new setting.** Resizability is always on where the image resize is.

## Requirements

Numbered, testable statements. Each becomes acceptance criteria on an issue.

1. **The size lives in the fence info string.** A diagram's width is the
   token `width=N` (N a positive integer, CSS px) in the opening fence's
   info string after the language word: ```` ```mermaid width=500 ````.
   The language word stays first (`fenceLanguage()` already reads
   first-word-is-language, rest-is-meta), so GitHub and CommonMark
   renderers still detect `mermaid`. No sidecar, no HTML wrapper, no
   comment marker.
2. **Meta is edited surgically.** Rewriting a width replaces an existing
   `width=…` token wherever it sits among the meta tokens, or appends one
   when absent; every other token — and the fence's indentation, fence
   character and length — is preserved verbatim. Removing the width
   deletes only that token (and the single space before it). A pure
   `src/lib/` module owns this surgery (the `imageResize.ts` shape) and is
   unit-tested on: no meta, meta without width, width among other tokens,
   width first/last, tilde fences, indented fences.
3. **Tolerant reading.** A `width` token that is missing, non-numeric,
   zero or negative is ignored: the diagram renders at natural size with
   no error badge and no rewrite of the fence. Reading never mutates the
   document.
4. **Both surfaces honor the width.** The preview diagram host
   (`fenceDiagrams.ts`) and the edit-pane widget (`diagramView.ts`) draw
   an SVG whose rendered width is N CSS px with height following the
   drawing's aspect ratio — the whole drawing scales, nothing crops. CSS
   still caps display at the pane width (the PRD 013 Req 9 scroll
   fallback is unchanged for anything wider).
5. **Selection, preview only.** In the preview pane, clicking a rendered
   diagram selects it: outline, four corner handles and a `W × H` size
   badge, reusing the SPEC20 image-resize overlay so the two look and
   behave identically. Click elsewhere or Escape deselects. Selection is
   overlay-only: it adds no text nodes and mutates no document text.
   Clicking a diagram in the edit pane keeps today's PRD 013 behaviour
   (reveal the fence source at the caret) — no handles there.
6. **Drag = aspect-locked resize, image bounds.** Dragging a corner handle
   rescales the drawing live, width clamped to 40 px minimum and the
   diagram's natural layout width maximum (mermaid's own `viewBox`
   width); the badge tracks the live size.
7. **Release persists; the SVG rescales, mermaid does not re-run.** On
   release the opening fence line is rewritten per Req 2 through the same
   buffer path as typing (dirty dot, ⌘S, autosave-on-toggle). The already
   rendered SVG is rescaled in place — no mermaid re-render, no flicker;
   mermaid re-runs only when the fence **body** changes, exactly as today.
   A release at the current width writes nothing.
8. **Double-click resets.** Double-clicking a selected diagram removes the
   width token (Req 2) and the drawing returns to natural size. A diagram
   with no width token is a no-op on double-click.
9. **Comment anchors are untouched.** Resizing, resetting, selecting and
   deselecting never change the rendered-text coordinate space (PRD 013
   Req 3 still holds: the diagram contributes zero text nodes; the info
   string is not rendered text). Every sidecar comment in a document that
   carries diagrams keeps resolving to the same target before and after a
   resize — an e2e test places a comment below a diagram and verifies its
   anchor survives a resize and a reset.
10. **Editability gate.** Handles appear only when the document may be
    edited — the same grant that enables Edit mode (`docGrants.edit`).
    On a read-only document (hosted viewer role, PRD 007) a click on a
    diagram does nothing; no overlay, no badge.
11. **Error and pending states are inert.** A diagram in the `pending` or
    `error` state (PRD 013 Reqs 10–11) is not selectable; the code block
    and failure badge behave exactly as today.
12. **Parity and posture.** The feature works identically on desktop and
    the single-file web build; the sanitize schema does not widen; mermaid
    still runs at its strictest security level; no new setting, menu item
    or platform seam is added.
13. **Tests.** Unit: the meta surgery (Req 2) and the tolerant parse
    (Req 3). E2e: in the desktop shim — click selects with handles and
    badge; drag persists `width=N` into the buffer with the dirty dot and
    the edit-pane widget draws it; double-click resets; Escape deselects;
    a read-only document shows no handles; the comment-anchor case (Req 9).
    Web: one guard that the resize persists in the single-file build.

## Open questions

- None. (Decisions settled in the owner interview of 2026-08-20: info
  string over comment/HTML/none; preview-only handles with the editor
  honoring the width; aspect-locked scale; image-identical bounds and
  double-click reset; surgical meta edit; overlay reuse; no re-render on
  resize; anchor invariance; the editability gate.)
