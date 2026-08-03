# Launching the Marky Mark v16 build with /goal

Run from `~/src/marky-mark`. Prereq: review and approve
`docs/specs/SPEC16.md` first — the goal implements exactly what it
prescribes.

```
/goal Implement docs/specs/SPEC16.md in full (delta on SPEC.md–SPEC15.md as implemented; SPEC16 wins on conflict; no regressions; SPEC8 stays unimplemented with E42–E44 reserved; out-of-scope per SPEC16). Deliverables per the spec: (1) File → Export Review Bundle… — the single-file web viewer with the document + comment trailer embedded as the #mm-review-doc JSON payload; the web build boots such payloads as in-memory docs; pure src/lib/reviewBundle.ts; Platform.reviewTemplate?() with tauri embedding dist-web/index.html via import.meta.glob raw (null in dev) and beforeBuildCommand becoming 'npm run build:web && npm run build'; shim stub template; web undefined. (2) Changes Since Save — toggleDiff View checkbox (edit modes only, off by default, resets per doc, not persisted) tinting changed lines plus deletion gutter dots via pure src/lib/diffLines.ts on the existing diff-match-patch, Editor diff prop, --mm-diff-* vars with fallbacks. (3) Reading position memory — block-anchored restore via the SPEC15 machinery; positions.json {version:1, entries LRU-capped at 200} via pure src/lib/readingPositions.ts; desktop, shim, and web. (4) Heading palette — rebindable hotkey headingPalette default Mod+K, View item Go to Heading…, centered fuzzy overlay per SPEC16 §4 via pure src/lib/fuzzy.ts; preview jumps the heading to top, edit modes scroll the editor to its line. (5) Word count chip — fixed bottom-left word-chip whenever a doc is open, 'N words · M min' at 220wpm (ceil, min 1), selection-aware in preview, buffer-based in edit, via pure src/lib/wordCount.ts. MenuState gains canExportReview and showDiff; HotkeyMap gains only headingPalette. Done when: 'npm run validate' exits 0 with complete output — U1–U34, E1–E41 plus E45–E63, W1–W6, the single-file check, the static bundle scan line, and 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' (macOS) exits 0 with app path and size printed and the viewer embedded, AND the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing, AND 'git diff src-tauri/tauri.conf.json' shows only the beforeBuildCommand change with no CSP or sanitize-schema change anywhere, AND README gains the five features with the size claim kept accurate, AND 'git diff --stat docs/specs' is empty and 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing. Constraints: the spec files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted additions are U29–U34, E60–E63, and W6, and the only permitted amendment is U19/U20's File-menu lists gaining exportReview; no new runtime dependencies; the sidecar/trailer formats, theme format, comment-anchor coordinate space, SPEC11 network isolation (W6 asserts the exported bundle inherits it), SPEC13 aux windows, SPEC14 navigation, SPEC15 scroll sync, and all existing web behavior beyond the review-boot path are unchanged; the version files stay at 0.2.0-alpha.3. Stop after 100 turns or 10 hours even if incomplete, and summarize remaining work.
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
