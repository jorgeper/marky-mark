# Launching the Marky Mark v38 build with /goal

Run from the worktree that owns `feat/table-edit`. Prereq: review and
approve `docs/specs/SPEC38.md` first — the goal implements exactly what
it prescribes.

```
/goal Implement docs/specs/SPEC38.md in full (delta on SPEC.md–SPEC37.md as implemented; SPEC38 wins on conflict; E42–E44 reserved; out of scope per SPEC38: resize re-flow mid-session, intra-cell whitespace preservation, CJK display-width padding, plus everything SPEC37 excluded; NO new dependencies, NO src-tauri changes). Deliverable: the table mode becomes a TRANSIENT WRAPPED GRID per SPEC38 §1–§7. Display grammar EXACTLY per §1: a bordered character grid fitted to the editor pane — column widths natural, shrunk widest-first to the width budget with an 8-char floor, long cell content word-wrapped (hard-break for over-long words) into pipe-aligned continuation lines, separator lines between EVERY pair of logical rows (the first carries the real GFM alignment markers), whitespace inside cells normalizing to single spaces. Pure layer per §2 in src/lib/tableEdit.ts: serializeCompactTable (the canonical one-line-per-row single-space form — insertTableAt/deleteTableAt/starter and every collapse use it), layoutTable(model,widthBudget) returning {text,map} with exported displayCellAt/displayPosOf, parseDisplay (grammar parser, null on violation), and the ROUND-TRIP GUARD: display text is trusted only if layoutTable(parseDisplay(region),width).text equals the region byte-for-byte (a plain GFM table fails it — that is what makes resync safe). Mode per §3 in src/components/tableMode.ts: entry measures the width budget from editor geometry, splices the grid (one isolateHistory event, cursor mapped to its logical cell/offset), field {span,width}; the transactionFilter (IME and undo/redo skipped) verifies the PRE-edit region passes the guard, then parses the post-edit display leniently, re-lays-out, folds the fix-up into the same transaction with the cursor kept at its logical (cell,content-offset) — one undo step, the grid re-wraps as cells grow/shrink; resync on undo/redo/foreign changes = map span then apply the guard (pass ⇒ continue, fail ⇒ exit leaving the text — history walks back through coherent states); EVERY deliberate exit (Esc, menu toggle, unmount, doc switch) collapses to serializeCompactTable in one isolateHistory event (unparseable display ⇒ just clear the field); chips unchanged, driven by the display map, separator lines behaving like the delimiter row. Canonical view per §3.5: SmartEditHandle gains canonicalText(text) (identity when off; display region collapsed when on) routed through the split-preview render, save/Save As, the draft writer, and the dirty comparison + diff tint; saving mid-mode writes the compact table WITHOUT exiting; the display form never escapes the editor. Done when: 'npm run validate' exits 0 with complete output — U1–U72, E1–E41 plus E45–E114, W1–W11 — and final line 'VALIDATION: ALL PASSED' in the transcript, AND 'git diff src-tauri/' is EMPTY, AND version files stay 0.4.0-alpha.1, AND README's table sentence reflects the transient wrapped grid and ARCHITECTURE.md's table section covers the grammar + round-trip guard + canonical-view rule, AND 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing and the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing. Constraints: docs/specs files and this condition unmodified (SPEC38.md only ADDED, already committed); the ONLY permitted amendments to existing tests are SPEC38 §8's names — E107 (grid entry; Esc leaves the COMPACT table, no padding persists) and E109–E112 (rewritten against the bordered transient display, same lifecycle/live-alignment/column-chip/row-chip coverage) — every other existing test unmodified and unweakened; only permitted additions U71–U72 and E113–E114; no dependencies; SPEC11 network isolation, sidecar/trailer formats, comment-anchor space, parked undo, SPEC25 selection carry, vim/Esc ordering, and all web behavior unchanged. Stop after 80 turns or 8 hours even if incomplete and summarize remaining work.
```

## After it goes green (your part)

```bash
git log --oneline main..feat/table-edit   # review, then PR per your flow
```

Manual checks (the parts automation can't see):

- Open a table WIDER than the window → Edit Table…: the grid fits the
  pane — long cells wrap inside their columns, separator lines box
  every row, and nothing ever soft-wraps into pipe soup (the attached
  screenshot's failure must be unreproducible).
- Type a paragraph into one cell — watch it wrap and re-wrap inside
  its column, borders never moving out of line.
- Esc: the grid vanishes — the buffer holds a clean compact
  one-line-per-row table. Enter/Esc without editing: byte-identical
  buffer, no dirty dot.
- With the mode ON and a cell mid-edit, ⌘S: the saved file (open it
  elsewhere) has the compact table; the split preview shows a real
  rendered table the whole time; the mode never blinked.
- Undo past the entry transform — the mode exits gracefully; keep
  undoing to your original text.
- Kill the window with the mode on (unmount collapse): reopen — no
  grid artifacts anywhere in the file.
