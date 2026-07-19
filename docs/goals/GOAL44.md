# Launching the Marky Mark v44 build with /goal

Run from the feature worktree. Prereq: review and approve
`docs/specs/SPEC44.md` first — the goal implements exactly what it
prescribes.

```
/goal Implement docs/specs/SPEC44.md in full (delta on SPEC.md–SPEC43.md as implemented; SPEC44 wins on conflict, no regressions; SPEC31 stays spec-only, E42–E44 reserved; out of scope: highlight-all-occurrences, multi-caret, touch pointers, a settings toggle, persisting the active word, any change to find/comment highlight systems). The deliverable is "where am I?" placement cues in both panes: the editor keeps its cm-activeLine tint and gains a darker active-word decoration under the caret (mm-active-word, cleared while a real selection exists, themed --mm-active-word with stacking find > selection > comments > active word > active line); the preview mirrors both while the editor drives — the [data-mm-line] block containing the caret's source line carries mm-active-block tinted --mm-active-line, and the caret's word appears as a position-exact synthetic mm-active-word mark located through the existing E83 selection-mirror pipeline (never a text search; rendered text stays byte-identical, sanitize schema untouched, exports and comment anchors blind to the marks); clicking the preview places you — in split mode a plain click (not links, images, comment marks, find bar) maps through the E80 preview-to-source machinery to move the editor caret with both panes' highlights following, and in preview-only mode the same click shows block + word via a collapsed SPEC25 carried selection so a later Mod+E lands the editor caret on that word (E85 contract extended); click-drag text selection and type-to-comment keep priority; tab switches (SPEC36) re-derive highlights from the restored caret. Mechanism per SPEC44 §1: new pure src/lib/activePosition.ts (wordAt with Unicode word chars and left-affinity, blockLineFor over the data-mm-line anchor list) plus only pure additions to selectionMap.ts if mapping needs extending. Done when: 'npm run validate' exits 0 with its complete output — U1–U76, E1–E41 plus E45–E126, W1–W11 — and the final line 'VALIDATION: ALL PASSED' printed in the transcript, AND 'git diff src-tauri/' is empty, AND the sanitize-schema diff is empty, AND the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing, AND README gains the placement bullet and ARCHITECTURE.md documents activePosition and the shared synthetic-mark pipeline, AND 'git diff --stat docs/specs' is empty and 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing. Constraints: the spec files and this condition must not be modified; existing tests may not be modified, weakened, stubbed, or deleted — the only permitted test additions are U76 and E124–E126; no new dependencies; version files stay at 0.4.0-alpha.2; the SPEC11 network-isolation guarantee, sidecar/trailer formats, comment-anchor coordinate space, SPEC15 scroll-sync behavior, and all existing web behavior are unchanged. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part)

Manual checks (the parts automation can't see):

- Split mode, caret mid-paragraph: the word under the caret reads
  clearly darker than the line tint in BOTH panes; arrowing through a
  sentence walks the highlight word by word without flicker.
- Click a word deep in the preview — the editor caret lands on it, the
  line tint and word shade agree on both sides.
- Preview-only mode: click a word, then ⌘E — the editor opens with the
  caret on that exact word.
- Select a few words in the editor — the word cue disappears, the
  selection mirror still shows; collapse the selection — the cue is
  back.
- Dark theme: both tints read as subtle lightening, not gray smears;
  the word stays distinguishable from the line.
- Find (⌘F) marks and the active word overlap without either vanishing.
