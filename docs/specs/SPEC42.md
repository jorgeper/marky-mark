# SPEC42: Marky Mark v42 — resize chips on every border and corner

Delta spec on top of SPEC.md–SPEC41.md as implemented. This file wins
on conflict; nothing may regress beyond the amendment named in §4. §5
is the goal condition.

**What ships:** the selected image widget grows a full ring of resize
chips — all four borders and all four corners — instead of SPEC41's
right/bottom/corner three. Same `.table-chip` circles with empty
faces, centered ON the borders; same persistence contract, applied
uniformly. SPEC41's out-of-scope line ("top/left chips") is
superseded by this spec.

The image is inline content, so its top-left stays anchored by layout:
every handle grows or shrinks the box from that anchor — dragging the
left border leftward makes the image wider, dragging the top border
upward makes it taller.

Out of scope: moving/repositioning the image (no drag-to-move);
per-handle anchoring (top-left always fixed); any change to the SPEC41
rewrite core, widget layer, caret-reveal, menu, or setting; new
dependencies; src-tauri changes.

---

## 1. The chip ring (FR-RING)

1. A selected widget shows **eight** chips, `.table-chip` circles with
   empty faces, centered ON the image's borders and corners:
   - Existing (ids unchanged): `image-resize-w` — right border middle
     (width); `image-resize-h` — bottom border middle (height);
     `image-resize-wh` — bottom-right corner (proportional).
   - New: `image-resize-l` — left border middle (width);
     `image-resize-t` — top border middle (height);
     `image-resize-tl` — top-left corner, `image-resize-tr` —
     top-right corner, `image-resize-bl` — bottom-left corner (all
     proportional, ratio locked).
2. Cursor affordances by direction: `ew-resize` (l, w), `ns-resize`
   (t, h), `nwse-resize` (tl, wh), `nesw-resize` (tr, bl).

## 2. Drag semantics (FR-DRAG)

1. **Border chips** resize one axis, outward-positive from the
   top-left anchor: right +dx, left −dx, bottom +dy, top −dy. Release
   persists the dragged dimension AND freezes the other at its current
   rendered value (the SPEC41 §3.2 box-freeze), via the same
   height-capable rewrite.
2. **Corner chips** are proportional and ratio-locked; the dominant
   outward axis drives (wh/tr: +dx; tl/bl: −dx). Release persists
   `width` only and REMOVES `height` (natural aspect), exactly like
   SPEC41's corner.
3. Uniform contract: both dimensions clamp to ≥ 40 px; each release is
   ONE `isolateHistory` undo step; a press without a real drag
   persists nothing; **double-click on ANY corner chip** clears width
   and height (natural size).

## 3. Docs (FR-DOCS)

README's images bullet says circles sit on every border and corner;
ARCHITECTURE.md's image-view chip paragraph describes the eight-chip
ring and the uniform corner contract.

## 4. Tests (amended: E117; no new tests, no other changes)

**E117** (the only permitted amendment, by name): click → exactly
EIGHT chips, each centered on its border/corner (geometry asserted for
the ring); a LEFT-border drag persists width (dragged) + height
(frozen); a TOP-LEFT corner drag persists width only, ratio kept, no
height; double-click a corner OTHER than bottom-right clears both;
the existing corner/right/clamp/one-⌘Z-each/preview-clean assertions
stay. Every other existing test (U1–U74, E1–E116, E118, W1–W11)
unmodified and unweakened.

## 5. Definition of Done

1. `npm run validate` exits 0 with complete output — U1–U74, E1–E41 +
   E45–E73 + E76–E118 (E74–E75 retired), W1–W11 — and
   `VALIDATION: ALL PASSED` printed.
2. `git diff src-tauri/` is EMPTY; no new dependencies; version files
   stay 0.4.0-alpha.1; no `.skip/.only/.todo`; the Windows
   reserved-name scan prints nothing; `git diff --stat docs/specs`
   limited to this file's addition.
3. README + ARCHITECTURE updated per §3.
