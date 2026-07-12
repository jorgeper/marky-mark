# Launching the Marky Mark v30 build with /goal

Run from `~/src/marky-mark`. Prereq: review and approve
`docs/specs/SPEC30.md` first — the goal implements exactly what it
prescribes.

```
/goal Implement docs/specs/SPEC30.md in full (delta on SPEC.md–SPEC29.md as implemented; SPEC30 wins on conflict; no regressions; SPEC8 stays unimplemented with E42–E44 reserved; SPEC28 stays withdrawn). Deliverable: the three MVP pillars exactly as SPEC30 prescribes: (1) §1 Find — command `find`, rebindable Mod+F, Edit → Find… on both layouts before Insert Image…; one FindBar component for both modes (test ids find-bar/find-input/find-count/find-prev/find-next/find-close), literal case-insensitive live matching (≤200ms debounce), selection prefill, Enter/Shift+Enter/Esc; preview matches over getDocText wrapped via highlightRange restyled mm-find/mm-find-active (never hl/data-cid, unwrap+normalize on close, doc text byte-identical); edit mode drives @codemirror/search (the ONLY new dependency) via setSearchQuery/findNext/findPrevious with CM's own panel and keymap never enabled, plus a replace row (find-replace-input/find-replace-one/find-replace-all) riding the normal dirty/undo path; split edit drives the editor; doc switch closes, mode toggle re-applies. (2) §2 reopen-on-launch — setting reopenLastDoc default true (settings-reopen checkbox, General); boot order: explicit opens (association/CLI/#open/review bundle) always beat reopen; missing file skips silently; web stays inert (documented). (3) §3 crash-safe drafts — pure src/lib/drafts.ts (Draft{version,docPath|null,content,at}, parse/serialize, isStaleDraft); ~2s-idle debounced shadow write to <configDir>/draft.json while dirty; deleted on clean transition, explicit discards, and either restore decision; boot (after reopen resolution) offers restore-prompt/restore-yes/restore-no for a non-stale draft, restoring the doc (or a fresh untitled) with the draft as the dirty buffer. (4) §4 tests exactly U58–U59, E89–E92, W11, with ONLY these amendments: U19's Edit array gains 'find' before 'insertImage'; E25 and E49 assert the reopened welcome instead of the splash after relaunch; E60 asserts the document reopens by itself (drop its manual #open). (5) §5 docs — README bullets + ARCHITECTURE.md sections (two find engines, boot order, draft lifecycle). Done when: 'npm run validate' exits 0 with complete output — U1–U59, E1–E41 plus E45–E92, W1–W11, the single-file check, the static bundle scan, and 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'git diff src-tauri/' is empty, AND 'git diff --stat docs/specs/' is empty, AND the only package.json dependency change is @codemirror/search, AND no version-file changes, AND 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing. Constraints: the spec files and this condition must not be modified; tests may not be weakened, stubbed, or deleted beyond the four named amendments; comment anchors, sidecar/trailer formats, SPEC11 isolation, and SPEC12–29 behaviors unchanged; find highlights must never trigger the comment click machinery. Stop after 100 turns or 10 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part)

- ⌘F in a long doc: type, watch the count tick, Enter through matches
  (wraps), Esc leaves the document untouched. Same query survives ⌘E.
- Replace-all something in edit mode, then one ⌘Z brings it all back.
- Quit with a doc open, relaunch from Finder: it reopens where you were.
  Double-click a different file: that wins instead.
- Force-quit (⌘⌥Esc) with unsaved typing; relaunch → restore prompt;
  Restore brings the dirty buffer back byte-perfect.
- Toggle "Reopen last document on launch" off and confirm the splash.
