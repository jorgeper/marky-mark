# Launching the Marky Mark v36 build with /goal

Run from `~/src/mm-tabs` (the feat/tabs worktree). Prereq: review and
approve `docs/specs/SPEC36.md` first — the goal implements exactly what
it prescribes.

```
/goal Implement docs/specs/SPEC36.md in full — multiple open files as sidebar tabs. Delta on SPEC.md–SPEC35.md as implemented; SPEC36 wins on conflict; nothing may regress; SPEC31 stays spec-only; E42–E44 reserved. Out of scope per the SPEC36 header: web build/W tests, tab reordering, pinned tabs, MRU order, close-file hotkey, per-file mode, per-file crash drafts, toolbar tab strip, multi-window. Summary (SPEC36 §1–§9 prescribe details and win): Mod+click opens a markdown file IN ADDITION to the current one and activates it; plain click keeps today's replace-the-active-file-with-guard semantics (open count doesn't grow; clicking any open row just activates); plain Ctrl+click on mac stays the SPEC35 context menu. True multi-buffer: each open file keeps its buffer, dirty flag, comments, and undo history in an in-memory park map keyed by path while the active doc stays on the existing single-buffer pipeline unchanged; switching never prompts; a clean parked file reloads from disk when it changed underneath, a dirty parked buffer always wins. Open rows render as tab pills; ONLY the active one takes the front-plane .selected treatment breaking the panel/workspace seam; dirty rows show ● swapping to ✕ on hover (folder-tab-close) — dirty close prompts Save/Don't Save/Cancel, closing the active file activates its tree-order neighbor, closing the last lands on the splash. Only-open-files mode via header button folder-open-only + rebindable toggleOpenOnly (Mod+Shift+O) + View item "Only Open Files": flat list in tree order with tab styling, # filter disabled, folder-open-empty when empty, sync flips back to tree view and reveals; mode persists. nextFile/prevFile (Ctrl+Tab / Ctrl+Shift+Tab via the new strict-Ctrl token, §6.1) cycle in tree order with wrap and preventDefault in both modes. Quit/Close/Exit walks EVERY dirty file in tree order (dirty untitled last) through the existing close prompt; Cancel aborts the whole quit. Mechanism: pure src/lib/openFiles.ts per §1 (treeOrderCompare, addOpen, closeOpen, cycleOpen, remapOpen, pruneOpen; FolderState v1 + openFiles/activeFile/openOnly, OPEN_CAP=50); foldertree.json write-through covers the new fields; Settings gains restoreOpenFiles (default true, checkbox set-restore-open-files) restoring the set + active file at boot per §8; SPEC35 rename/delete remap/prune the open set and park map per §9. Done when: 'npm run validate' exits 0 with complete output — U1–U64, E1–E41 plus E45–E104, W1–W11 — and final line 'VALIDATION: ALL PASSED' in the transcript, AND 'git diff src-tauri/' prints nothing (frontend-only), AND the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing, AND README gains the tabs bullet and ARCHITECTURE.md documents the open-set model, park map + freshness rule, strict-Ctrl token, and new foldertree.json fields, AND 'git diff --stat docs/specs' is empty and 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing. Constraints: work only inside ~/src/mm-tabs on branch feat/tabs — commit there only, NEVER push, never merge or touch main, never read or run anything in ~/src/marky-mark or ~/src/mm-file-mgmt; before any e2e run or dev server check ports 4923 and 1420 are free and if busy STOP and ask instead of killing anything; the spec files and this condition must not be modified; existing tests may not be modified, weakened, stubbed, or deleted — the only permitted additions are U64 and E100–E104; no new dependencies; version files stay 0.4.0-alpha.1; SPEC11 network isolation, sidecar/trailer formats, comment-anchor coordinates, and all web behavior unchanged. Stop after 80 turns or 8 hours even if incomplete and summarize remaining work.
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
