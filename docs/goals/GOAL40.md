# Launching the Marky Mark v40 build with /goal

Run from the worktree that owns `feat/table-edit`. Prereq: review and
approve `docs/specs/SPEC40.md` first — the goal implements exactly what
it prescribes.

```
/goal Implement docs/specs/SPEC40.md in full (delta on SPEC.md–SPEC39.md as implemented; SPEC40 wins on conflict; E42–E44 reserved; out of scope: per-table view overrides, everything SPEC38/39 excluded; NO new dependencies, NO src-tauri changes). Deliverable: the table grid stops being a mode and becomes THE default editor view for ALL tables, per SPEC40 §1–§5. THE SETTING §1: Settings.tableGridView (boolean, default TRUE, persisted, per-key parse fallback) with a Settings → Editor checkbox (testid settings-table-grid, "Show tables as grids in the editor"); the Table ▸ submenu replaces edit-table with toggle-grid — labeled "Show Raw Tables" while on and "Show Table Grid" while off, always enabled, flipping the setting for ALL tables; SmartMenuCtx.tableMode becomes gridView; both flip directions are history-transparent (addToHistory:false) with the cursor kept at its logical cell/offset. GRID-FOR-ALL §2: the field becomes the grid SET {spans:[{from,to}], width} — one shared width budget, spans mapped through every transaction, the SPEC38 filter/guard/watcher logic applied PER SPAN (a foreign change failing one span's guard drops that span to raw, leaving the others); detection transforms any untracked valid top-level GFM table to a grid at editor mount and after any transaction that leaves one in the document (a hand-typed table snaps to grid when its delimiter row completes; a raw-dropped span re-grids when it parses again), all history-transparent, with the canonical dirty comparison keeping the dot OFF on open; unmount/doc switch collapses every grid and reports the canonical buffer; canonicalText collapses ALL spans (the five SPEC38 §3.5 App call sites unchanged in shape); re-fit re-lays-out every grid; confinement, chips, Enter/Tab nav, space rules, and separator read-onlyness apply within whichever grid holds the caret (chips for the caret's table only). REMOVED §3: the TABLE pill, table-mode-done, the Esc exit handler, and user-facing enter/exit — Esc passes to the vim layer directly again. PURE §4: allTableRegions(text) — every top-level GFM table region in document order. Done when: 'npm run validate' exits 0 with complete output — U1–U73, E1–E41 plus E45–E115, W1–W11 — and final line 'VALIDATION: ALL PASSED' in the transcript, AND 'git diff src-tauri/' is EMPTY, AND version files stay 0.4.0-alpha.1, AND README's table passage describes the default grid view + global toggle and ARCHITECTURE.md's table section covers the grid set/detection/removed mode, AND 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing and the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing. Constraints: docs/specs files and this condition unmodified (SPEC40.md only ADDED, already committed); the ONLY permitted amendments to existing tests are SPEC40 §6's names — U64 (Table submenu pins toggle-grid/insert-table/delete-table with gridView labels), E102 (table-context steps use the always-on grid, no entry click), and E104–E113 (rewritten to the global-view world preserving their coverage: E104 becomes view-flip lifecycle, E105–E111/E113 enter via the DEFAULT grid, E112's chrome coverage becomes the two toggles) — every other existing test unmodified and unweakened; only permitted additions U73 and E114–E115; no dependencies; SPEC11 network isolation, sidecar/trailer formats, comment-anchor space, the SPEC38 canonical-view rule and round-trip guard, and all web behavior unchanged. Stop after 80 turns or 8 hours even if incomplete and summarize remaining work.
```

## After it goes green (your part)

```bash
git log --oneline main..feat/table-edit   # review, then PR per your flow
```

Manual checks (the parts automation can't see):

- Open any document with tables and hit ⌘E: every table is already a
  clean bordered grid — no clicks, no mode, no pill. The dirty dot is
  off; ⌘S writes the file you'd expect (compact tables).
- Type a brand-new table by hand: the instant you finish the
  `| --- | --- |` line, it snaps into a grid under your fingers.
- Two tables in one doc: edit one, resize the window — both re-fit;
  chips follow your caret between them.
- ⌘. → Table ▸ "Show Raw Tables": the whole document's tables drop to
  compact markdown at once; the label flips; Settings → Editor shows
  the checkbox off; quit and relaunch — still raw. Flip it back and
  the grids return. Neither flip dirtied the file or ate an undo step.
- Esc now does exactly what it did before tables existed (vim nav if
  you use it; nothing otherwise).
