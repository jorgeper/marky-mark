# Launching the Marky Mark v23 build with /goal

Run from `~/src/marky-mark`. Prereq: review and approve
`docs/specs/SPEC23.md` first — the goal implements exactly what it
prescribes.

The statement stays under the /goal 4000-character limit by deferring
all detail to SPEC23's sections rather than restating them.

```
/goal Implement docs/specs/SPEC23.md in full (delta on SPEC.md–SPEC22.md as implemented; SPEC23 wins on conflict; no regressions; SPEC8 stays unimplemented with E42–E44 reserved). Deliverable: the editing trio exactly as SPEC23 prescribes: (1) §1 mirrored selection — split-edit only, preview-pane selections map to exact SOURCE offsets in the editor via the pure src/lib/selectionMap.ts (stripInline + mapSelectionToSource with visible-index→source-offset maps), bounded by the blocks' data-mm-line stamps, dispatched to CodeMirror without focusing it, drawSelection() + themed .cm-selectionBackground so the unfocused selection is visible, null-mapping falls back to the covering line range, collapsed selections never touch the editor. (2) §2 vim nav mode — gated on the existing vimNav setting; Esc enters a navigation-only modal state, i/a exit; pure VimEditResolver in src/lib/vimnav.ts (VimNavResolver untouched); keyset h j k l, w b, 0 $, gg (500ms window) G, Ctrl+d/u half viewport — cursor motions that scroll into view; ALL other printable keys plus Enter/Backspace/Delete/Tab inert in nav mode with the buffer byte-identical; ⌘-accelerators, arrows, and IME untouched; NAV pill test id vim-badge bottom-right of the editor pane in full and split edit; mode resets to typing on remount/doc switch; General settings Vim checkbox copy updated. (3) §3 markdown highlighting — new setting editorSyntax default true (parse/serialize/fallback per house rules), Settings→Editor checkbox test id editor-syntax, live compartment reconfigure with undo history intact; syntaxHighlighting(HighlightStyle.define) mapping Lezer tags to mm-md-* CSS classes (headings by level, emphasis, strong, inline+fenced code, links/URLs, blockquote, list marks, dimmed punctuation marks) colored ONLY via theme CSS variables in styles.css with fallbacks; off ⇒ zero mm-md-* classes. (4) §4 dev-shim-only window.__mmEdit seam {head, headLine, selFrom, selTo, selText, nav}. (5) §5 tests exactly U49–U51, E80–E82, W10. (6) §6 docs — ARCHITECTURE.md sections + one README bullet. Done when: 'npm run validate' exits 0 with complete output — U1–U51, E1–E41 plus E45–E82, W1–W10, the single-file check, the static bundle scan, and 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'git diff src-tauri/' is empty, AND 'git diff --stat docs/specs/' is empty, AND 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing, AND git diff shows no version-file changes and the only permitted dependency change is an explicit @lezer/highlight entry matching the vendored version (no other package.json or Cargo.toml dependency changes). Constraints: the spec files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted additions are U49–U51, E80–E82, W10 with no amendments to existing tests; sidecar/trailer formats, theme file format, comment-anchor space, SPEC11 network isolation, SPEC13 aux protocol, and SPEC14–22 behaviors unchanged; Esc must remain inert in the editor while vimNav is off. Stop after 100 turns or 10 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part)

Manual checks (the parts automation can't see):

- Split edit: drag-select a sentence in the preview pane — the same
  text (with its markdown markers) highlights in the editor and
  scrolls into view; your preview selection stays put. Try a phrase
  running through **bold** text, then one inside a table (the latter
  should select the whole source line instead of guessing).
- Vim: enable Vim navigation in Settings → General. In edit mode press
  Esc — NAV pill appears; j/k/w/b/0/$/gg/G/Ctrl+d/u move the cursor;
  mash letters — nothing types; press i and type — normal again. Turn
  the setting off — Esc goes back to doing nothing.
- Highlighting: headings/bold/code tint in the editor in every theme
  you use (try a dark one); Settings → Editor toggle flips it live
  without losing undo; relaunch — it stuck.
- Quick regression pass: image paste, resize handles, comments, and
  the diff tint all render over the new highlighting without visual
  fights.
