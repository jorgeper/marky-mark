# Launching the Marky Mark v36 build with /goal

Run from `~/src/mm-tabs` (the feat/tabs worktree). Prereq: review and
approve `docs/specs/SPEC36.md` first — the goal implements exactly what
it prescribes.

```
/goal Implement docs/specs/SPEC36.md in full (delta on SPEC.md–SPEC35.md as implemented; SPEC36 wins on conflict, no regressions; SPEC31 stays spec-only, E42–E44 reserved; out of scope: the web build and all W tests, tab drag-reordering, pinned tabs, MRU cycle order, a close-file hotkey, per-file edit/preview mode, per-file crash drafts, a toolbar tab strip, multi-window). The deliverable is multiple open files as sidebar tabs: Mod+click (⌘ mac / Ctrl elsewhere; plain Ctrl+click on mac stays the SPEC35 context menu) opens a markdown file IN ADDITION to the current one and activates it, plain click keeps today's replace-the-active-file semantics through the unsaved-changes guard (open count doesn't grow; clicking any open row just activates it), and each open file keeps its own buffer, dirty flag, comments, and undo history in memory — switching never prompts, any number of files may be dirty, a parked clean file reloads from disk when it changed underneath, a parked dirty buffer always wins. Open rows render as tab pills; only the active one takes the existing front-plane .selected treatment that breaks the panel/workspace seam — inactive open rows stay on the panel plane with the workspace's inset shadow running over them; dirty open rows show a ● that row-hover swaps for a ✕ (span role=button, folder-tab-close, stopPropagation) which closes the file — dirty ⇒ activate + the close prompt (Save / Don't Save / Cancel), closing the active file activates its tree-order neighbor, closing the last lands on the splash. A new header button (folder-open-only, stacked-tabs icon, accent when on, between title and # filter), the rebindable hotkey toggleOpenOnly (Mod+Shift+O), and a View menu item "Only Open Files" (checked, after Folders) toggle only-open-files mode: the tree becomes a flat list of open files in tree order (no chevrons/indent, tab styling, hover ✕), # filter disabled, "No open files" (folder-open-empty) when the set is empty, sync flips back to tree view and reveals the active file, and the mode persists. Rebindable nextFile/prevFile (Ctrl+Tab / Ctrl+Shift+Tab via a new strict-Ctrl token in hotkeys.ts — ctrl/control parse to a ctrl flag distinct from Mod, eventMatches requires ctrlKey with mod then matching metaKey alone, displayCombo shows ⌃ on mac, comboFromEvent unchanged) cycle the open set in tree order with wrap and preventDefault in both modes. Quit/Close/Exit walks EVERY dirty open file in tree order (dirty untitled last), activating each behind the existing close prompt — Save writes and continues, Don't Save continues, Cancel aborts the whole quit. Mechanism per SPEC36 §1–§2: a pure src/lib/openFiles.ts (treeOrderCompare with the folders-first component rule matching compareEntries, addOpen keeping tree order, closeOpen with neighbor, cycleOpen with wrap, remapOpen, pruneOpen, FolderState v1 gaining openFiles/activeFile/openOnly with OPEN_CAP=50 at persistence) plus an in-memory park map path→{buffer,savedText,comments,editorHistory} in App — the active document stays on the existing single-buffer pipeline unchanged. foldertree.json write-through covers the three new fields; Settings gains restoreOpenFiles (default true, General checkbox set-restore-open-files, settings migration fills missing hotkeys/fields): on boot with the setting on and a non-empty persisted set, restore it (drop vanished paths silently, background files load lazily on first activation), open activeFile (fallback first) in place of reopen-last-doc, explicit CLI/#open boot opens still join the set as active per the SPEC30 race rules; setting off ⇒ today's boot exactly, persisted set ignored but not cleared. SPEC35 integration: rename remaps open set + park keys + activeFile via remapPath (buffers/dirty/undo survive), delete prunes them (active pruned ⇒ neighbor else splash); untitled buffers stay outside the set and keep the guard. Done when: 'npm run validate' exits 0 with its complete output — U1–U64, E1–E41 plus E45–E104, W1–W11 — and the final line 'VALIDATION: ALL PASSED' printed in the transcript, AND 'git diff src-tauri/' prints nothing (frontend-only feature), AND the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing, AND README gains the tabs bullet under Folders and ARCHITECTURE.md documents the open-set model, park map + freshness rule, strict-Ctrl token, and the new foldertree.json fields, AND 'git diff --stat docs/specs' is empty and 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing. Constraints: work only inside ~/src/mm-tabs on branch feat/tabs — commit there only, NEVER push, never merge or touch main, never read or run anything in ~/src/marky-mark or ~/src/mm-file-mgmt; before running the e2e suite or any dev server check ports 4923 and 1420 are free (lsof -iTCP:4923 -sTCP:LISTEN; lsof -iTCP:1420 -sTCP:LISTEN) and if either is busy STOP and ask instead of killing anything; the spec files and this condition must not be modified; existing tests may not be modified, weakened, stubbed, or deleted — the only permitted test additions are U64 and E100–E104; no new dependencies; version files stay at 0.4.0-alpha.1; the SPEC11 network-isolation guarantee, sidecar/trailer formats, comment-anchor coordinate space, and all existing web behavior are unchanged. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part)

```bash
cd ~/src/mm-tabs
git log --oneline -5     # review the commits on feat/tabs
# review, then merge/push YOURSELF when satisfied — the agent never pushes
```

Manual checks (the parts automation can't see):

- ⌘-click three files. The clicked one always jumps to the front —
  only IT breaks the panel edge; the others sit behind as pills with
  the shadow running over them.
- Edit two of them without saving. Flip between all three — no
  prompts, each keeps its text, its undo stack (⌘Z after returning),
  and its scroll position; the ● shows on both dirty rows.
- Ctrl+Tab with the editor focused — it cycles (top-to-bottom as the
  tree lists them, wrapping) and never inserts a tab character.
- Toggle Only Open Files (button and ⌘⇧O): folders vanish, just your
  tabs; hover a row — the ● becomes ✕; close the active one — its
  neighbor takes the front. Close all — splash, "No open files".
- Rename an open dirty file via the SPEC35 context menu — the tab
  follows, still dirty, still front; ⌘S writes the new name.
- Quit with two dirty files: two prompts in order, each file visible
  behind its prompt; Cancel on the second — nothing closed, nothing
  lost.
- Relaunch: same tabs, same front file. Turn "Reopen open files at
  launch" off, relaunch — back to single-file reopen behavior.
- On mac: plain Ctrl+click still opens the context menu, never a tab.
