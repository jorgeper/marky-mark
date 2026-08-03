# Launching the Marky Mark v34 build with /goal

Run from `~/src/marky-mark`. Prereq: review and approve
`docs/specs/SPEC34.md`. The new tiered loop applies: iterate with
`npm run tauri dev`, checkpoint with `/check`, gate with `/gate`,
dogfood with `/dogfood`.

```
/goal Implement docs/specs/SPEC34.md in full (delta on SPEC.md–SPEC33.md as implemented; SPEC34 wins on conflict; no regressions; SPEC8 stays unimplemented with E42–E44 reserved; SPEC28 withdrawn; SPEC31 stays spec-only). Use the tiered loop: iterate with npm run tauri dev and targeted vitest/playwright runs, checkpoint with npm run validate:quick, and run the FULL gate only when feature-complete. Deliverable: the folder sidebar exactly as SPEC34 prescribes: (1) §1 seam — OPTIONAL Platform.readDirEntries (name+isDir; tauri plugin-fs readDir, shim derived from virtual-fs prefixes, web undefined) and Platform.openFolderDialog (dialog directory:true; shim window.__mmfs.nextFolderPath hook; web undefined); ZERO src-tauri changes. (2) §2 state — pure src/lib/folderTree.ts (isMarkdownFile, compareEntries folders-first, visibleEntries dotfile filter, ancestorsOf, parse/serializeFolderState {version,root,expanded} cap 200, corruption-tolerant) persisted to <configDir>/foldertree.json; settings showFolders default false + folderWidth clamp 160–480 default 240; HotkeyMap toggleFolders default Mod+Shift+E with the Settings row. (3) §3 UI — panel left of the workspace in all modes gated on seam+setting; test ids folder-panel/folder-header/folder-sync/folder-close/folder-divider/folder-item(data-path)/folder-open-btn; lazy per-directory listing re-listed on every expansion; chevrons, # glyph on markdown rows (openDocGuarded, selected class on the open doc), grayed inert non-md rows (folder-item-dim); empty-state Open Folder… button; divider drag with the split-divider CSS-variable pattern persisting folderWidth; × / View checkbox / hotkey all flip persisted showFolders. (4) §4 commands — toggleFolders (View checkbox 'Folders' FIRST in View, accelerator from the hotkey) and openFolder (File → Open Folder… directly after Open Recent; picks a directory → persisted root, expanded reset, panel opens, NO file opens); web hamburger untouched. (5) §5 reveal — every successful real-path openDoc with the panel visible expands ancestorsOf and scrolls/selects the row; outside-root (or rootless) opens retarget the persisted root to the file's directory; hidden panel NEVER auto-opens; folder-sync re-reveals on demand (disabled with no doc); untitled clears selection. (6) §6 tests exactly U60–U61, E93–E95 as specified, with NO amendments to existing tests. (7) §7 docs — README bullet + ARCHITECTURE.md section. Done when: 'npm run validate' exits 0 with complete output — U1–U61, E1–E41 plus E45–E95, W1–W11, the single-file check, the static bundle scan, and 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run ship:local' exits 0 end-to-end with the debug build installed and relaunched (pgrep -lx marky-mark evidence printed) so the feature is immediately testable on this Mac, AND 'git diff src-tauri/' is empty, AND 'git diff --stat docs/specs/' is empty, AND no dependency or version-file changes, AND 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing, AND the Windows-reserved-name scan prints nothing. Constraints: the spec files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted additions are U60–U61, E93–E95; comment anchors, sidecar/trailer formats, SPEC11 isolation, SPEC12–33 behaviors, and the E13 hamburger count unchanged; the sidebar must never render on the web build; do NOT run release:prepare, push any tag, trigger any workflow, or touch version files — no release of any kind. Stop after 100 turns or 10 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part)

- `npm run tauri dev` → ⌘⇧E: empty state → Open Folder… on a real
  folder of notes; expand around; only `.md` files light up with the
  `#` glyph; everything else is dim and dead.
- Open a nested file from Open Recent — the tree should walk itself
  open to the file. Collapse everything, hit the sync button, watch it
  re-reveal.
- Open a file from OUTSIDE the root (Finder double-click) — the root
  should jump to that file's folder.
- Drag the divider; quit; relaunch — width, root, and expansion all
  remembered. Close with ×; reopen with ⌘⇧E.
- `/dogfood` when it feels right.
