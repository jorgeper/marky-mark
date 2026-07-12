# Launching the Marky Mark v17 build with /goal

Run from `~/src/marky-mark`. Prereq: review and approve
`docs/specs/SPEC17.md` first — the goal implements exactly what it
prescribes.

```
/goal Implement docs/specs/SPEC17.md in full (delta on SPEC.md–SPEC16.md as implemented; SPEC17 wins on conflict; no regressions; SPEC8 stays unimplemented with E42–E44 reserved; out-of-scope per SPEC17). The deliverable is File → Export… (command exportDoc replacing exportReview, always present, no-op without a doc): an in-app modal (export-dialog) with format radios export-format-html/export-format-pdf (HTML default, disabled without a review template; PDF disabled where the platform can't print), checkboxes export-include-comments and export-include-wordcount (both default on; word count appends the italic '*N words · M min read*' stats line to the exported copy only), a theme select export-theme ('Current theme' + every installed theme) whose choice is sticky via a new Settings.exportTheme ('current' default, persisted immediately, old files parse to it), and export-run/export-cancel with Esc/scrim cancel. HTML export per SPEC17 §2: pure src/lib/exportDoc.ts buildExportMarkdown(buffer, comments, opts) applies the includes; ReviewPayload gains optional theme which the web boot applies for the session (both slots, nothing persisted, unknown ids fall back); save flow unchanged (.review.html, html filter). PDF per §3: Platform.printDocument?(html) — tauri opens a printview window (?window=printview through the SPEC13 router, label in the aux capability with events/self-close/print only), hands it buildPrintHtml(renderedHtml, themeCss, statsLine?) over the aux bus, prints via the webview and closes with the dialog; shim records to window.__mmPrints; web undefined; print shows mark highlights only, no margin cards; rendering reuses the existing pipeline. MenuState.canExportReview is removed (gating moves into the dialog). Done when: 'npm run validate' exits 0 with complete output — U1–U38, E1–E41 plus E45–E67, W1–W7, the single-file check, the static bundle scan line, and 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' (macOS) exits 0 with app path and size printed, AND the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing, AND 'git diff src-tauri/tauri.conf.json' is empty with the sanitize schema untouched and the aux capability still free of fs:/dialog:/opener:, AND README's export bullet describes the dialog, AND 'git diff --stat docs/specs' is empty and 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing. Constraints: the spec files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted additions are U36–U38, E65–E67, and W7, and the only permitted amendments are U19/U20 (File carries exportDoc ungated), U34 (exportDoc always present; rest unchanged), and E63 (drives the dialog with defaults; same bundle assertions); no new runtime dependencies; the sidecar/trailer formats, theme format, comment-anchor space, SPEC11 network isolation, SPEC13 aux protocol, SPEC14/15/16 behaviors, and all existing web behavior beyond the theme-carrying boot are unchanged; the version files stay at 0.2.0-alpha.3. Stop after 100 turns or 10 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part)

```bash
cd ~/src/marky-mark
! git push
# then cut 0.2.0-alpha.4 per docs/RELEASING.md — v14–v17 make a strong alpha
```

Manual checks (the parts automation can't see):

- File → Export… — the dialog shows format/includes/theme; pick PDF →
  the macOS print dialog opens with the themed document; PDF ▾ → Save as
  PDF produces a clean file (no app chrome, highlights visible when
  comments are on).
- Export HTML without comments → open it: no comment cards. With word
  count → the stats line sits at the end, italic and discreet.
- Pick "Dracula" as the export theme, export, quit, relaunch, Export… —
  Dracula is still selected; the exported bundle opens in Dracula while
  your app stays in your own theme.
- Web: an exported bundle opens themed; the recipient's own theme choice
  (if they had one saved) is untouched afterwards.
