# Launching the Marky Mark v41 build with /goal

Run from the worktree that owns `feat/table-edit`. Prereq: review and
approve `docs/specs/SPEC41.md` first — the goal implements exactly what
it prescribes.

```
/goal Implement docs/specs/SPEC41.md in full (delta on SPEC.md–SPEC40.md as implemented; SPEC41 wins on conflict; E42–E44 reserved; out of scope per SPEC41: per-image overrides, alt/src forms, top/left chips, widgets inside table grid spans, reference-style images; NO new dependencies, NO src-tauri changes). Deliverable: images render in the editor with one global view, per SPEC41 §1–§7. THE VIEW §1: Settings.inlineImages (boolean, default TRUE, persisted, per-key fallback) with a Settings → Editor checkbox (testid settings-inline-images); the smart menu gains Image ▸ directly below Table ▸ — toggle-images ("Show Raw Images"/"Show Rendered Images", always enabled, flips ALL images), insert-image (dispatches the existing insertImage command), delete-image and resize-image (enabled iff caret on an image; delete splices the reference in one undo step with reverse blank-line cleanup, resize selects it) — and the SPEC43 top-level resize-image stub is REMOVED; SmartMenuCtx gains imageView. RENDERED VIEW §2: every inline ![alt](src) and lone <img> reference displays as a widget rendering the actual image (local srcs through the platform asset seam; remote srcs NEVER load — the SPEC11 blocked-origin placeholder renders instead, the zero-network guarantee extending to the edit pane); CARET-REVEAL: a span strictly containing the selection head shows raw markdown in place, arrows out restore the picture; clicking a widget selects it (caret parked at the span START so the widget stays) and shows the chips, Esc/click-away/caret-move deselects; both views are pure decoration — no text, history, canonical, or dirty changes ever; images inside table grid spans stay raw. RESIZE §3: three .table-chip circles with empty faces centered ON the borders — image-resize-w (right, width), image-resize-h (bottom, height), image-resize-wh (corner, proportional) — live drag, released sizes persist via the SPEC20 rewrite extended with height: right writes width=drag + height=current, bottom mirrors, corner writes width only and REMOVES height; ≥40px clamp, one isolateHistory undo step per release; double-click the corner clears both. REMOVED §4: ImageResizer and its overlay leave BOTH preview panes (App drops both instances + rewriteImage plumbing); span stamping, schema, and the imageResize.ts splice core remain; E74–E75 retire (deleted, numbers reserved). PURE §5: allImageRefs(text) in imageResize.ts ({start,end,kind,src,alt,title?,width?,height?}, both forms, exact offsets, document order) and rewriteImageSpan grown with an optional height (width-only behavior byte-identical to SPEC20). Done when: 'npm run validate' exits 0 with complete output — U1–U75, E1–E41 plus E45–E73 plus E76–E123 (E74–E75 retired), W1–W11 — and final line 'VALIDATION: ALL PASSED' in the transcript, AND 'git diff src-tauri/' is EMPTY, AND version files stay 0.4.0-alpha.1, AND README's images bullet describes rendered-in-editor + chips + the global toggle and ARCHITECTURE.md gains the image-view section, AND 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing and the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing. Constraints: docs/specs files and this condition unmodified (SPEC41.md only ADDED, already committed); the ONLY permitted amendments to existing tests are SPEC41 §8's names — U65 (Image submenu below Table, top-level resize-image gone), E107 (image steps via the Image ▸ flyout), and E74–E75 retired — every other existing test unmodified and unweakened (U45–U46 and E71–E73 must keep passing untouched); only permitted additions U75 and E121–E123; no dependencies; SPEC11 network isolation (bundle scan clean, zero-request e2e assertions), sidecar/trailer formats, comment-anchor space, the SPEC40 grid machinery, and all web behavior unchanged. Stop after 80 turns or 8 hours even if incomplete and summarize remaining work.
```

## After it goes green (your part)

```bash
git log --oneline main..feat/table-edit   # review, then PR per your flow
```

Manual checks (the parts automation can't see):

- Paste a screenshot in edit mode: the PICTURE appears right there in
  the editor, not a line of syntax. Arrow up into it — the markdown
  reveals for editing; arrow away — the picture returns.
- Click the image: three little circles hug its right edge, bottom
  edge, and corner. Drag the corner — it scales smoothly, ratio held;
  drag the right edge — it stretches. Release, ⌘Z, ⌘Z — each drag was
  one step.
- Double-click the corner circle: back to natural size.
- Check the preview pane: the image is just an image — click it,
  nothing happens, no handles anywhere.
- ⌘. → Image ▸ Show Raw Images: every picture in the doc drops to
  syntax at once; Settings → Editor shows the checkbox off; relaunch —
  still raw. Flip back — pictures again. Dirty dot never blinked.
- Put an image reference inside a table cell: the grid keeps its
  perfect alignment (the image stays as text there).
- Try a remote http image: you get the blocked-origin note in the
  editor, same as the preview — the app still makes zero requests.
