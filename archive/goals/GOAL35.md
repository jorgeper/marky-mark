# Launching the Marky Mark v35 build with /goal

Run from `~/src/marky-mark`. Prereq: review and approve
`docs/specs/SPEC35.md` first — the goal implements exactly what it
prescribes.

```
/goal Implement docs/specs/SPEC35.md in full (delta on SPEC.md–SPEC34.md as implemented; SPEC35 wins on conflict, no regressions; SPEC31 stays spec-only, E42–E44 reserved; out of scope: web build, root rename/delete from the sidebar, drag-and-drop moves, copy/cut/paste of entries, multi-select, undo of file operations, keyboard-only menu invocation). The deliverable is file & folder management on the folder sidebar via a right-click context menu: directory rows offer New File and New Folder created as children of that directory, Rename, Delete, Reveal in Finder (Windows: Reveal in File Explorer), Copy Path and Copy Relative Path; file rows (markdown and dim non-markdown alike) offer Reveal, Rename, Delete, Copy Path and Copy Relative Path; the panel's empty area offers New File / New Folder against the root plus Reveal and Copy Path. Creation drops the new row straight into in-place rename (stem preselected, Enter commits, Esc cancels, blur commits) and a new markdown file then opens through the unsaved-changes guard; rename is the same in-place input with per-keystroke validation (separators, dotfiles, trailing dot/space, length, case-insensitive sibling collisions, and Windows-reserved basenames aux/con/prn/nul/com1-9/lpt1-9 all refused with an invalid class and title error) and on commit every state that referenced the old path remaps — open docPath and window title (buffer, dirty flag, undo, comments untouched; next save writes the new path), tree selection, expanded set, recents MRU, foldertree.json; delete asks an in-app confirm ("Move 'NAME' to the Trash?", noting unsaved changes when applicable, Enter confirms, Esc cancels) then moves the entry recursively to the OS Trash, re-lists, prunes expanded/recents/draft, and closes the open document to the splash if it was inside. Mechanism per SPEC35 §1–§2: four optional Platform seams (renameEntry via plugin-fs rename; trashEntry via ONE new Rust command on the trash crate — the only permitted dependency; revealPath via plugin-opener revealItemInDir; copyText via navigator.clipboard) each recorded by the shim on __mmTrash/__mmReveals/__mmClipboard for e2e, and a pure src/lib/folderOps.ts (validateEntryName, uniqueChildName, remapPath, relativePath, folderContextMenu as the single menu-model source with capability-flag omission). Done when: 'npm run validate' exits 0 with its complete output — U1–U63, E1–E41 plus E45–E99, W1–W11 — and the final line 'VALIDATION: ALL PASSED' printed in the transcript, AND 'git diff src-tauri/' is limited to the trash-crate dependency + command + registration and (only if previously missing) opener revealItemInDir / fs rename permissions, AND the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing, AND README gains the file-management bullet and ARCHITECTURE.md documents the four seams and the remap rules, AND 'git diff --stat docs/specs' is empty and 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing. Constraints: the spec files and this condition must not be modified; existing tests may not be modified, weakened, stubbed, or deleted — the only permitted test additions are U63 and E96–E99; no dependencies beyond the trash crate; version files stay at 0.4.0-alpha.1; the SPEC11 network-isolation guarantee, sidecar/trailer formats, comment-anchor coordinate space, and all existing web behavior are unchanged. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part)

```bash
cd ~/src/marky-mark
! git push                                # ship sidebar file management
# optionally cut the next alpha per docs/RELEASING.md
```

Manual checks (the parts automation can't see):

- Right-click a folder → New File: the row appears in place, already
  editing; type a name, Enter — the file opens. Do it again: the
  placeholder numbers itself (`Untitled 2.md`).
- Rename the file you have open **while dirty** — the title bar follows,
  your text and the dirty dot survive, ⌘S writes to the new name, and
  Open Recent shows only the new path.
- Rename a folder above the open file — the tree stays expanded, the
  selection pill stays put, and the app still knows where the doc lives.
- Delete a file → the confirm names it; confirm → it's in the macOS
  Trash (⌘Z in Finder brings it back). Delete the folder of the open
  doc → the app lands on the splash, no stale recents.
- Reveal in Finder on a deep file — Finder opens with it selected.
- Copy Relative Path on a nested file, paste — separators and casing
  match the tree exactly.
- Try to rename a file to `con.md` or `notes/` — the input refuses,
  the tooltip explains why.
