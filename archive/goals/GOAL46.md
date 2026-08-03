# Launching the Marky Mark v46 build with /goal

Run from the feature worktree. Prereq: review and approve
`docs/specs/SPEC46.md` first — the goal implements exactly what it
prescribes. The statement below is kept under 4,000 characters; the
spec's numbered sections carry the item-level detail.

```
/goal Implement docs/specs/SPEC46.md in full (delta on SPEC.md–SPEC45.md as implemented; SPEC46 wins on conflict; no regressions). SPEC46 ships ZERO user-visible change — a work-reduction contract: byte-identical rendered HTML, canonical text, saved files, sidecars, drafts, and settings; every SPEC1–SPEC45 debounce, ordering, and tolerance contract frozen per §0; §7's deferred items (split-preview block diffing, injection-effect split, FindBar-local state, batched list_dirs) are out of scope and may not be smuggled in. Implement every item of §2 (typing hot path: scoped table detection, the three one-slot identity-keyed caches, single-pass canonicalizeAll, alignFilter reorder + parse reuse, Set separators, parseFrontMatter early-out, value-sync echo skip, decoration/chips caching, compiled hotkeys, word-count gating), §3 (React: margin-card layout index + deps + panel ResizeObserver, selectionchange bail, dirty fast path, memoized comment lists and FolderPanel, applyThemeCss guard, cue/mirror caches, hygiene), §4 (scroll sync: per-rebuild buildTable with lineAtOffset/offsetForLine kept as wrappers, cached cue element with live rects, previewLeads no-op guard + write-scoped quiet stamp, per-direction rAF coalescing), §5 (startup/IPC: Promise.all boot with SPEC30 order intact, exists-preflights removed, ≤50ms post-drain reopen, unchanged-line position-write skip + cached anchor sweep, one-tree Menu.new + spec-identity skip + fmOverride dep fix, async trash_entry), and §6 (bundle: lazy App/AuxWindow split, dynamic rehype-highlight with grammars NOT subsetted, welcome.md raw import with FIXTURES moved to the shim chunk, panic="abort" + rlib-only crate-type, web saveConfig skip-identical), plus the §1 seam: new pure src/lib/perfCount.ts, no-op in production, shim-enabled as window.__mmPerf with §1's named counters, observability only. Done when: 'npm run validate' exits 0 with its complete output — U1–U80, E1–E41 plus E45–E133, W1–W11 — ending 'VALIDATION: ALL PASSED' in the transcript, AND E129–E133/U77–U80 assert exactly the §8 contracts (work counts and byte-equivalence; no wall-clock assertion anywhere in the diff), AND 'git diff src-tauri/' touches only the Cargo.toml profile/crate-type lines and the trash_entry async attribute, AND the sanitize-schema diff is empty, AND the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing, AND ARCHITECTURE.md documents perfCount and its measured-performance table is re-measured with cold launch, large-file open, theme switch, and mode toggle at or below their current printed values, AND 'git diff --stat docs/specs' is empty and 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing. Constraints: the spec files and this condition must not be modified; existing tests may not be modified, weakened, stubbed, or deleted — the only permitted test additions are U77–U80 and E129–E133; no new dependencies (a dynamic import of already-shipped rehype-highlight is fine); version files stay 0.4.0-alpha.3; SPEC11 network isolation, sidecar/trailer formats, the comment-anchor coordinate space, and all web behavior unchanged; every new cache is one slot keyed on an immutable input's identity (§0.4). Stop after 80 turns or 8 hours even if incomplete and summarize remaining work.
```

## After it goes green (your part)

Manual checks (the parts automation can't see):

- **§5.3 gate (required):** quit the app, double-click a `.md` file in
  Finder on a cold launch — the double-clicked file must open, not the
  reopened last document; repeat a few times (it's a race).
- Type fast in a large document containing a table (grid view on) —
  keystrokes should feel immediate; arrow through the table and watch
  the chips keep up while scrolling.
- Long momentum scroll in split mode on a big doc — both panes track
  without stutter; near the caret the cue alignment still locks on.
- Open Settings (⌘,) — the window should appear noticeably faster than
  before; flip toggles rapidly and watch the main window stay smooth.
- Add, resolve, and delete comments on a large doc — cards reposition
  exactly as before, no lag, no misplaced card after a reply edit.
- Trash a large folder from the sidebar — the UI must not freeze while
  the OS moves it to the Trash.
- Compare `du -h` of the built .app against the current release — it
  should be equal or smaller.
