# SPEC41: Marky Mark v41 — images render in the editor: one global view, chips to resize

Delta spec on top of SPEC.md–SPEC40.md as implemented. This file wins on
conflict; nothing may regress beyond the amendments named in §8. §9 is
the goal condition.

**What ships:** images get the SPEC40 treatment. **Every image
reference renders as the actual image, inline in the edit pane** —
paste or insert an image and you see the picture, not the syntax. One
**global setting** — `inlineImages`, default ON — switches ALL images
between rendered and raw markdown, from Settings and from a new
**Image ▸** submenu (right below Table ▸): view toggle, Insert Image…,
Delete Image, Resize Image. **Resizing moves to the edit pane**:
clicking a rendered image shows three circular chips (the table-chip
family) — right border for width, bottom border for height, bottom-right
corner for proportional — drag to resize, released sizes persist into
the source exactly as SPEC20 did (the `<img …>` form). **The
preview-pane resizer is REMOVED**: no more handles in the preview,
which becomes a pure reading surface for images.

Unlike tables, the rendered view changes NO text — it is decoration
only. There is no canonical machinery, no history transparency, no
guard: the buffer, saves, drafts, dirty, and the preview are untouched
by construction in both views.

Out of scope: per-image view overrides; editing alt/src through a form
(the caret-reveal rule below IS the editor); top/left resize chips
(right, bottom, and corner only — the image's top-left stays put);
images inside table grid spans render RAW there (a widget would wreck
the grid's alignment); reference-style `![alt][ref]` images (span
detection covers inline `![alt](src)` and lone `<img>` tags — the two
forms the app itself writes); any new dependency or src-tauri change.

---

## 1. The setting and the Image ▸ submenu (FR-VIEW)

1. `Settings.inlineImages: boolean`, default **true**; persisted,
   standard per-key parse fallback. UI: a checkbox in Settings →
   Editor's Images section — "Show images in the editor" (test id
   `settings-inline-images`).
2. The smart menu gains **`image` ▸** directly below Table ▸ (always
   present): `toggle-images` — "Show Raw Images" while on, "Show
   Rendered Images" while off, always enabled, flips the setting for
   ALL images; `insert-image` "Insert Image…" — dispatches the existing
   `insertImage` command (the SPEC20 picker flow), always enabled;
   `delete-image` "Delete Image" and `resize-image` "Resize Image" —
   enabled iff the caret is on an image reference. The SPEC36 top-level
   contextual `resize-image` stub is REMOVED (this submenu replaces
   it). `SmartMenuCtx` gains `imageView: boolean`.
3. `delete-image` splices the image reference out of the source (one
   undo step; a reference alone on its line takes the line's blank-line
   cleanup with it, insertHr-style in reverse). `resize-image` selects
   the caret's image (its chips appear) — pointer-free entry to §3.

## 2. The rendered view (FR-INLINE)

1. With the view on, every image reference — inline `![alt](src)` and
   lone `<img …>` tags (the SPEC20 persisted form) — displays as a
   widget rendering the actual image, replacing its span in the edit
   pane. Local sources resolve through the existing platform asset
   seam (the same resolution the preview uses); **remote sources
   (http/https/protocol-relative) NEVER load** — the widget shows the
   SPEC11 blocked-origin placeholder text instead. SPEC11's
   zero-network guarantee extends to the edit pane unchanged.
2. **Caret-reveal**: an image whose span strictly contains the
   selection head shows its raw markdown instead of the widget — arrow
   into an image to edit its source in place, arrow out and the
   picture returns. Clicking a widget SELECTS it (the caret parks at
   the span start — boundary, so the widget stays) and shows the
   resize chips; Esc, clicking elsewhere, or moving the caret clears
   the selection.
3. Both views are pure decoration — flipping the setting (either
   switch) re-renders instantly, changes no text, and never touches
   history or the dirty dot.
4. Images inside a table grid span stay raw (§out-of-scope) — the
   grid's alignment owns those lines.

## 3. Resize chips (FR-RESIZE)

1. A selected widget shows three chips, the `.table-chip` circles with
   empty faces, centered ON the image's borders: right border middle
   (`image-resize-w`) — width; bottom border middle (`image-resize-h`)
   — height; bottom-right corner (`image-resize-wh`) — proportional,
   ratio locked. The image's top-left corner never moves.
2. Dragging resizes the widget live. Release persists via the SPEC20
   rewrite machinery extended with height: the right chip writes
   `width` = dragged and `height` = current rendered height (freezing
   the box); the bottom chip mirrors that (height dragged, width
   frozen); the corner chip writes `width` only and REMOVES any
   `height` (natural aspect at the new width). Markdown syntax
   converts to the `<img>` form exactly as SPEC20 §4.2 prescribed;
   both dimensions clamp to ≥ 40 px. Each release is ONE undo step.
3. Double-clicking the corner chip clears width and height (natural
   size) — the SPEC20 double-click parity.

## 4. Removed surface (FR-GONE)

`ImageResizer` and its overlay/styles leave both preview panes — the
preview renders images with no selection or handles at all. Tests
E74–E75 (which drove those handles) RETIRE: deleted, their numbers
reserved like E42–E44. The SPEC20 span stamping, sanitize schema, and
`imageResize.ts` splice core all REMAIN (the rewrite engine §3 runs on
them); U45–U46 stand untouched.

## 5. Pure additions (FR-PURE)

1. `allImageRefs(text)` (in `imageResize.ts`) — every image reference
   in document order: `{start, end, kind: 'md' | 'html', src, alt,
   title?, width?, height?}`, exact offsets, both forms, escaped
   brackets tolerated; DOM-free.
2. The rewrite core grows height: `rewriteImageSpan(spanText, parts,
   width, height?)` — height written/removed alongside width with the
   same idempotence rules (U45/U46 semantics unchanged when height is
   absent).

## 6. Editor integration (FR-EDITOR)

The widget layer is a decoration field computed from the doc, the
`inlineImages` prop, the SPEC40 grid set (§2.4 exclusion), and the
selection (§2.2 reveal); the chips are overlay UI in `.editor-wrap`
(the table-chip layer pattern) positioned from the widget's rendered
rect. The Editor receives the resolved-src function and the setting as
props; resize splices dispatch with `isolateHistory('full')`. App
drops the two `ImageResizer` instances and its `rewriteImage`
plumbing.

## 7. Interactions confirmed

Paste (E71–E73) is untouched — it still writes the file and inserts
markdown at the caret, which now renders immediately. Tables and
images coexist (mutual exclusion per §2.4). Comments, anchors, scroll
sync, find, vim, export, and the web build are unaffected; the web
build ships the identical feature.

## 8. Tests (added: U74, E116–E118; amended: U64, E102; retired: E74–E75)

Amendments, by name: **U64** — the menu snapshot gains the always-
present `image` submenu below `table` (children + labels per
`imageView`, enabled flags per `ctx.image`); the top-level contextual
`resize-image` entry is gone. **E102** — the image-context steps use
the Image ▸ flyout (enabled flags) instead of the removed top-level
stub. **E74–E75** — retired (§4). No other existing test may be
modified, weakened, skipped, or deleted; E42–E44 stay reserved.

1. **U74** — `allImageRefs` (both forms, multiple per line, offsets,
   attrs parsed, non-images skipped); `rewriteImageSpan` height
   variants (set both, height alone, corner-clears-height, removal
   idempotence; width-only behavior byte-identical to SPEC20).
2. **E116** — the rendered view: a doc with a pasted-style local image
   shows the WIDGET in the edit pane (real pixels via the shim's data:
   URI), dirty off; caret-reveal shows the raw syntax and arrows back
   to the picture; the two switches flip all images raw/rendered and
   persist; a remote-src image renders the blocked placeholder, and
   the run's zero-request assertion holds.
3. **E117** — resize: click → exactly three chips on the right/bottom/
   corner borders; corner drag persists `<img … width>` (no height,
   ratio kept); right drag persists width AND height; double-click the
   corner clears both; 40 px clamp; each release one ⌘Z step; the
   preview shows the resized image with NO overlay or handles.
4. **E118** — the menu: Image ▸ labels and enabled flags by context;
   Insert Image… dispatches the picker flow (shim-observable); Delete
   Image removes the reference (one undo step restores); an image
   inside a table grid stays raw and un-widgeted.

## 9. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U74, E1–E41 +
   E45–E73 + E76–E118 (E74–E75 retired), W1–W11 — and
   `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` is EMPTY; no new dependencies; version files
   stay 0.4.0-alpha.1; no `.skip/.only/.todo`; the reserved-name scan
   prints nothing; `git diff --stat docs/specs` limited to this file's
   addition.
3. README's images bullet describes rendered-in-editor + chips + the
   global toggle (preview resize gone). ARCHITECTURE.md: the image
   view section (decoration-only design, caret-reveal, chip resize,
   SPEC11 extension to the widget, the removed preview resizer).
