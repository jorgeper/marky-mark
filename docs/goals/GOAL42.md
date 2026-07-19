# Launching the Marky Mark v42 build with /goal

Run from the worktree that owns `feat/table-edit`. Prereq: review and
approve `docs/specs/SPEC42.md` first — the goal implements exactly what
it prescribes.

```
/goal Implement docs/specs/SPEC42.md in full (delta on SPEC.md–SPEC41.md as implemented; SPEC42 wins on conflict and supersedes SPEC41's "top/left chips" out-of-scope line; out of scope per SPEC42: drag-to-move, per-handle anchoring, changes to the rewrite core/widget layer/caret-reveal/menu/setting; NO new dependencies, NO src-tauri changes). Deliverable: the selected image widget shows a full RING of resize chips — every border and every corner. THE RING §1: eight .table-chip circles with empty faces centered ON the borders/corners — existing ids unchanged: image-resize-w (right, width), image-resize-h (bottom, height), image-resize-wh (bottom-right corner, proportional); new: image-resize-l (left, width), image-resize-t (top, height), image-resize-tl / image-resize-tr / image-resize-bl (corners, proportional ratio-locked). Cursors: ew-resize (l,w), ns-resize (t,h), nwse-resize (tl,wh), nesw-resize (tr,bl). DRAG §2: the image's top-left stays anchored by layout — border chips resize one axis outward-positive (right +dx, left −dx, bottom +dy, top −dy) and release persists the dragged dimension AND the other frozen at its current rendered value via the SPEC41 height-capable rewrite; corner chips are ratio-locked on the dominant outward axis (wh/tr +dx; tl/bl −dx) and release persists width only, REMOVING height (natural aspect); uniform contract everywhere — ≥40px clamp on both dimensions, ONE isolateHistory undo step per release, a press without a real drag persists nothing, and double-click on ANY corner chip clears width and height. DOCS §3: README's images bullet says circles sit on every border and corner; ARCHITECTURE.md's image-view chip paragraph describes the eight-chip ring and the uniform corner contract. Done when: 'npm run validate' exits 0 with complete output — U1–U74, E1–E41 plus E45–E73 plus E76–E118 (E74–E75 retired), W1–W11 — and final line 'VALIDATION: ALL PASSED' in the transcript, AND 'git diff src-tauri/' is EMPTY, AND version files stay 0.4.0-alpha.1, AND 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing and the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing. Constraints: docs/specs files and this condition unmodified (SPEC42.md only ADDED, already committed); the ONLY permitted amendment to existing tests is SPEC42 §4's name — E117 (exactly EIGHT chips with ring geometry asserted; a left-border drag persists width dragged + height frozen; a top-left corner drag persists width only, ratio kept, no height; double-click a corner other than bottom-right clears both; the existing corner/right/clamp/one-⌘Z-each/preview-clean assertions stay) — every other existing test (U1–U74, E1–E116, E118, W1–W11) unmodified and unweakened; NO new tests; no dependencies; SPEC11 network isolation, the SPEC40 grid machinery, the SPEC41 widget/reveal/menu/setting behavior, and all web behavior unchanged. Stop after 60 turns or 6 hours even if incomplete and summarize remaining work.
```

## After it goes green (your part)

Manual checks (the parts automation can't see):

- Click an image in edit mode: eight little circles ring it — middles
  of all four borders, all four corners.
- Drag the LEFT border chip leftward: the image widens in place (its
  top-left never moves). ⌘Z — one step.
- Drag the TOP-LEFT corner up-left: it scales smoothly, ratio held.
- Double-click any corner: back to natural size.
- The cursor changes direction per chip (↔ on left/right, ↕ on
  top/bottom, diagonals on the corners).
