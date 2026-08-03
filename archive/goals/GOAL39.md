# Launching the Marky Mark v39 build with /goal

Run from the worktree that owns `feat/table-edit`. Prereq: review and
approve `docs/specs/SPEC39.md` first — the goal implements exactly what
it prescribes.

```
/goal Implement docs/specs/SPEC39.md in full (delta on SPEC.md–SPEC38.md as implemented; SPEC39 wins on conflict; E42–E44 reserved; out of scope: everything SPEC38 excluded, rectangular multi-cell selection, the SPEC38 foreign-change break-exit stays unchanged; NO new dependencies, NO src-tauri changes). Deliverable: three table-mode fixes per SPEC39 §1–§4. LIVE RE-FIT §1: while the mode is active, any editor geometry change (window resize, split divider, sidebar) re-measures the width budget on a ~150ms debounce and re-lays-out the grid in place via an UNRECORDED transaction (addToHistory:false, mode effect with new span+width, cursor kept at its logical cell/content-offset) — the grid always fits the pane. CELL CONFINEMENT §2 (Prec.highest keymap + the transactionFilter, only while active; foreign transactions keep SPEC38 handling): selections with head inside the span clamp both endpoints to the head's cell content (anchor-inside/head-outside clamps to the anchor's cell; both-outside allowed as the SPEC38 escape hatch); ⌘A with the caret in the grid selects the current cell's content; a space insertion that trimming would delete becomes a caret advance within the cell clamped at its inner edge (typing 'hello world' lands both words; interior spaces normal); Enter/Shift+Enter move to the same column next/previous row (header→first body row, no-op at ends), Tab/Shift+Tab move cells row-major, none ever insert; Backspace at cell-content start and Delete at its end are consumed; every insertion into a cell passes pure sanitizeCellInsert (newlines/CR→spaces, unescaped | → \|, typing a pipe yields its escaped form); edits targeting separator lines, pipes, or gutters are consumed. MODE CHROME §3: a TABLE pill pinned to the editor pane (vim-badge family) with a Done button (testid table-mode-done, title mentioning Esc) that collapses+exits exactly like Esc; the Table ▸ item reads "Exit Table Mode" while active (id edit-table, enabled regardless of cursor position while active) and "Edit Table…" when off; SmartMenuCtx gains tableMode:boolean fed from the field at menu-open. PURE §4 in src/lib/tableEdit.ts: sanitizeCellInsert and cellNavTarget(parsed,map,loc,dir) ('up'|'down'|'next'|'prev', null at ends, row-major, header included). Done when: 'npm run validate' exits 0 with complete output — U1–U73, E1–E41 plus E45–E118, W1–W11 — and final line 'VALIDATION: ALL PASSED' in the transcript, AND 'git diff src-tauri/' is EMPTY, AND version files stay 0.4.0-alpha.1, AND README's table sentence mentions the confined mode + Done exit and ARCHITECTURE.md's table section gains re-fit/confinement/chrome, AND 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing and the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing. Constraints: docs/specs files and this condition unmodified (SPEC39.md only ADDED, already committed); the ONLY permitted amendments to existing tests are SPEC39 §5's names — U65 (SmartMenuCtx.tableMode + Exit Table Mode label/enabled) and E110 (the manual delimiter-mangling step becomes its confinement counterpart: keystrokes consumed, grid survives) — every other existing test unmodified and unweakened; only permitted additions U73 and E115–E118; no dependencies; SPEC11 network isolation, sidecar/trailer formats, comment-anchor space, the SPEC38 canonical-view rule and round-trip guard, vim/Esc ordering, and all web behavior unchanged. Stop after 80 turns or 8 hours even if incomplete and summarize remaining work.
```

## After it goes green (your part)

```bash
git log --oneline main..feat/table-edit   # review, then PR per your flow
```

Manual checks (the parts automation can't see):

- Enter table mode, then grab the window edge and squeeze it — the
  grid breathes down to fit, live, never once showing pipe soup. Drag
  the split divider: same. Let go, widen: the columns relax back.
- Type a sentence with spaces into a cell. Every word lands. Try to
  hold space at the cell edge — the caret parks at the border and
  nothing breaks.
- Look at the pane: the TABLE pill tells you you're in the mode.
  Click Done — clean compact table. ⌘. → Table ▸ now says
  "Exit Table Mode" while you're in it.
- Try to break it from inside: Enter (hops down a row), Tab (next
  cell), Backspace at a cell's left edge (nothing), type | (comes out
  escaped), ⌘A (selects just the cell), paste a paragraph with
  newlines (flattens into the cell), type on a separator line
  (nothing). The grid should be unbreakable from within.
- Undo still works for real edits — and a window resize never shows
  up as an undo step.
