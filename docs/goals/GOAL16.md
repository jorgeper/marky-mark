# Launching the Marky Mark v16 build with /goal

Run from `~/src/marky-mark`. Prereq: review and approve
`docs/specs/SPEC16.md` first — the goal implements exactly what it
prescribes.

```
/goal Implement docs/specs/SPEC16.md in full (delta on SPEC.md–SPEC15.md as implemented; SPEC16 wins on conflict, no regressions; SPEC8 stays unimplemented with E42–E44 reserved; out of scope: exporting from the web build, word-level diff colouring, cross-device position sync, palette body-text search, per-heading counts, diff-toggle persistence). Five deliverables. (1) Export Review Bundle: File → Export Review Bundle… (command exportReview, after Save As…, present iff canExportReview) writes, via the existing save dialog (suggested <basename>.review.html), the single-file web viewer with the document embedded — a <script type="application/json" id="mm-review-doc"> before </head> carrying {name, markdown} where markdown is the buffer with the comment trailer attached regardless of storage setting, JSON-escaped so </script> can't break out; the web build boots such a payload as an in-memory document; pure src/lib/reviewBundle.ts buildReviewBundle/extractReviewPayload shared by exporter, web boot, and tests; Platform.reviewTemplate?() — tauri embeds dist-web/index.html via import.meta.glob raw degrading to null in dev, tauri.conf.json beforeBuildCommand becomes 'npm run build:web && npm run build' (the only tauri.conf change, CSP untouched), shim returns a stub template, web undefined. (2) Changes Since Save: command toggleDiff, View checkbox listed only in edit modes, default off, resets per doc, not persisted; changed/inserted buffer lines tinted and deletion gutter markers, via pure src/lib/diffLines.ts diffLineSets(saved, current) on the existing diff-match-patch line mode, recompute debounced ≤250ms, decorations through an Editor diff prop and CodeMirror compartment, colors on optional --mm-diff-changed-bg/--mm-diff-removed vars with fallbacks. (3) Reading position memory: every doc reopens at the source line last at the viewport top (block-anchored via SPEC15 machinery), captured on debounced scroll/doc-switch/mode-toggle, restored after first preview render; positions.json in the config dir {version:1, entries:[{path,line,at}]} LRU-capped at 200 via pure src/lib/readingPositions.ts; works on desktop, shim, and web. (4) Heading palette: rebindable hotkey headingPalette default Mod+K (Hotkeys tab label 'Go to heading'), View item Go to Heading… after the comment-nav items; centered overlay with input heading-palette-input listing h1–h6 (depth-indented, from rendered DOM + data-mm-line), fuzzy-filtered via pure src/lib/fuzzy.ts (subsequence, word-start ranking), ↑/↓/Enter/click/Esc; preview jumps heading to top, edit modes scroll the editor to that line. (5) Word count chip: fixed bottom-left chip word-chip whenever a doc is open, '1,234 words · 6 min' at 220wpm ceiling min 1, selection-aware in preview, buffer-based in edit, debounced ≤250ms, via pure src/lib/wordCount.ts countWords. MenuState gains canExportReview and showDiff; HotkeyMap gains only headingPalette. Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U34, desktop e2e E1–E41 plus E45–E63, web e2e W1–W6, the single-file check, the static bundle scan line, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' (macOS) exits 0 with the app path and size printed and the web viewer embedded, AND the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing, AND 'git diff src-tauri/tauri.conf.json' shows only the beforeBuildCommand change with no CSP or sanitize-schema change, AND README gains the five feature mentions with the size claim kept accurate, AND 'git diff --stat docs/specs' is empty and 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing. Constraints: the spec files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted test additions are U29–U34, E60–E63, and W6, and the only permitted amendment is U19/U20's File-menu lists gaining exportReview (all other existing tests unchanged); no new runtime dependencies; the sidecar/trailer formats, theme format, comment-anchor coordinate space, SPEC11 network-isolation guarantee (the exported bundle inherits the web build's zero-network behavior — W6 asserts it), SPEC13 aux-window protocol, SPEC14 navigation, SPEC15 scroll sync, and all existing user-visible web behavior beyond the review-boot path are unchanged; the version files stay at 0.2.0-alpha.3. Stop after 100 turns or 10 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part)

```bash
cd ~/src/marky-mark
! git push                                # ship v16's five features
# cut 0.2.0-alpha.4 per docs/RELEASING.md — this is a headline release
```

Manual checks (the parts automation can't see):

- **Review bundle:** comment on a doc, File → Export Review Bundle…, open
  the exported .html in Safari/Chrome — document + comment threads there,
  replies work, Save downloads; devtools network tab shows zero requests.
- **Diff:** edit a few lines in split mode, View → Changes Since Save —
  edited lines tint, a deletion shows its gutter dot; save → marks clear.
- **Memory:** scroll deep into a long doc, open another, quit, relaunch,
  reopen — you're back where you were.
- **Palette:** ⌘K, type a few letters of a deep heading, Enter — landed;
  works in edit mode too; rebind the key in Settings and confirm.
- **Chip:** bottom-left counts; select a paragraph — counts shrink to the
  selection; type in edit mode — count ticks.
- **Web:** the plain dist-web page still boots to its empty state (no
  payload), and an exported bundle boots straight into the document.
