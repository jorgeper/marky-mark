# Launching the Marky Mark v37 build with /goal

Run from the worktree that owns `feat/table-edit`. Prereq: review and
approve `docs/specs/SPEC37.md` first — the goal implements exactly what
it prescribes. (This is the ALIGNED-EDITOR table editing spec; the
preview-overlay alternative is parked on `feat/table-edit-preview-overlay`.)

```
/goal Implement docs/specs/SPEC37.md in full (delta on SPEC.md–SPEC43.md as implemented; SPEC37 wins on conflict; SPEC31 spec-only, E42–E44 reserved; out of scope per SPEC37: intra-cell wrapping — columns GROW, one source line per row always — plus CJK display-width padding, alignment editing, un-padding on exit, nested tables, Resize Image… stays the SPEC43 stub, no new web tests, NO new dependencies, NO src-tauri changes). Deliverable: aligned table editing in the EDITOR pane per SPEC37 §1–§8. The smart menu's contextual section becomes an always-present Table ▸ submenu (ids table/edit-table/insert-table/delete-table, testids smart-edit-<id>; edit-table enabled iff cursor in a pipe table, insert-table iff not, delete-table iff so): Insert Table splices starterTable() with blank-line management (selection lands on Column 1), Delete Table splices the region plus one separating blank line, and Edit Table… toggles aligned table mode. Pure model in new src/lib/tableEdit.ts EXACTLY per §1: tableRegionAt extracted from detectContext (which now calls it), parseTable/serializeTable (unescaped-pipe splitting, \| preserved, columns padded to the widest cell), the §1.4 ops with {text,start,end} returns and header/1-column guards, and the aligned-mode helpers normalizeTable (null when aligned), cellAt (delimiter row maps to header, padding clamps), normalizeWithCursor (cursor kept at its logical cell content offset). Aligned mode per §3 lives IN the Editor (pure CodeMirror): entry = one normalizeWithCursor splice with isolateHistory('full'); the span is tracked through every transaction via changeset position mapping; while active a transactionFilter FOLDS re-normalization into any user transaction touching the span (buffer aligned after every keystroke/paste, cursor logically mapped, ONE undo step for edit+re-pad, IME composition never interrupted); table lines carry the mm-table-mode-line decoration; Esc exits via a Prec.highest keydown AHEAD of the vim layer (first Esc exits mode, next enters nav), the region ceasing to parse exits, re-invoking Edit Table… exits, unmount exits; padding persists after exit — real valid GFM. Chips EXACTLY per §4 (testids table-add-col-left/right, table-del-col disabled at 1 column, table-add-row-above/below, table-del-row; header row: no above-insert/delete; delimiter = header for column ops, no row chips), shown only while the cursor is inside the table, positioned from CM coordinates in an .editor-wrap overlay tracking cursor/edits/scroll/resize; chip ops land the cursor in the new column/row's first cell (clamped after deletes), one splice/undo step each. Styling §6 in styles.css on --mm-* variables only; render pipeline untouched. Done when: 'npm run validate' exits 0 with complete output — U1–U70, E1–E41 plus E45–E112, W1–W11 — and final line 'VALIDATION: ALL PASSED' in the transcript, AND 'git diff src-tauri/' is EMPTY, AND version files stay 0.4.0-alpha.1, AND README's Smart Edit bullet describes aligned table editing and ARCHITECTURE.md gains the aligned-table-mode section, AND 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing and the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing. Constraints: docs/specs files and this condition unmodified (SPEC37.md only ADDED, already committed); the ONLY permitted amendments to existing tests are SPEC37 §9's two names — U65 (contextual section = Table submenu) and E107 (open the Table flyout; Edit Table… now enters aligned mode, buffer changes only by normalization padding) — every other existing test unmodified and unweakened; only permitted additions U69–U70 and E109–E112; no dependencies; SPEC11 network isolation, sidecar/trailer formats, comment-anchor space, parked undo, SPEC25 selection carry, and all web behavior unchanged. Stop after 80 turns or 8 hours even if incomplete and summarize remaining work.
```

## After it goes green (your part)

```bash
git log --oneline main..feat/table-edit   # review, then PR per your flow
```

Manual checks (the parts automation can't see):

- Put the caret in a messy, unpadded table → ⌘. → Table ▸ Edit
  Table…: the source snaps into a perfect character grid, every pipe
  aligned, your caret still in its cell. One ⌘Z undoes the alignment.
- Type in a short cell — nothing else moves. Keep typing past the
  column edge — the whole column breathes wider, every row at once,
  and one ⌘Z takes back the character AND the re-pad.
- The chips follow your caret cell to cell: ⊕⊕✕ above the column,
  ⊕⊕✕ on the left margin. Add a column — the caret lands in the new
  empty cell, ready to type. Header row: no delete, no add-above.
- Esc once: chips and wash gone, the alignment stays in the file.
  With vim nav on: Esc leaves table mode first, Esc again goes NAV.
- Save and open the file in another editor — the table is just
  beautifully padded markdown. GitHub renders it identically.
- Break the table on purpose (delete a delimiter dash) — the mode
  exits quietly instead of fighting you.
- Type CJK or emoji in a cell — alignment may drift (known limit,
  UTF-16 padding); plain text stays perfect.
