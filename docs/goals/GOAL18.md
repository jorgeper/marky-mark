# Launching the Marky Mark v18 build with /goal

Run from `~/src/marky-mark`. Prereq: review and approve
`docs/specs/SPEC18.md` first — the goal implements exactly what it
prescribes.

```
/goal Implement docs/specs/SPEC18.md in full (delta on SPEC.md–SPEC17.md as implemented; SPEC18 wins on conflict; no regressions; SPEC8 stays unimplemented with E42–E44 reserved; out-of-scope per SPEC18). Deliverables: (1) The Export dialog's HTML format becomes a fully static reading page — zero <script tags, inline chosen-theme CSS, clean centered document typography via the --mm-* contract, <title> = doc name, no app UI; include-comments renders open comments as mark.hl highlights with numbered sup refs (#mm-comment-N) plus a static end-of-page Comments section (excerpt, author, body, replies), unchecked ⇒ none of it; include-word-count is exactly the '*N words · M min read*' line and unchecked ⇒ no word count anywhere in the artifact; suggested name <basename>.html; the HTML option is always enabled. Pure builder buildStaticHtml({title, bodyHtml, themeCss, stats?, comments?}) in src/lib/exportDoc.ts replaces buildExportMarkdown and buildPrintHtml (statsLine survives). (2) PDF works: printview keeps the SPEC17 window+bus flow but printing becomes a Rust command print_view in lib.rs calling the webview's native print() (window.print() removed as a WKWebView no-op); the printed page is the same static-page builder output; the window closes after the command resolves. (3) The interactive-bundle export retires: Platform.reviewTemplate, the import.meta.glob embedding, and App's canExportReview are removed; tauri.conf.json beforeBuildCommand reverts to 'npm run build' (the only tauri.conf change; app sheds the embedded viewer); src/lib/reviewBundle.ts and the web boot path stay (W6/W7 untouched); the vite.web.config tauri stub stays. Done when: 'npm run validate' exits 0 with complete output — U1–U39, E1–E41 plus E45–E68, W1–W7, the single-file check, the static bundle scan line, and 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' (macOS) exits 0 with app path and size printed and no ~1.2MB template chunk in dist/assets, AND the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing, AND the milestone diff of src-tauri/tauri.conf.json shows only the beforeBuildCommand revert with the sanitize schema untouched and the aux capability still free of fs:/dialog:/opener:, AND README's export bullet describes the static page and the size claim is re-checked, AND 'git diff --stat docs/specs' is empty and 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing. Constraints: the spec files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted additions are U39 and E68, and the only permitted amendments are U36 (drop buildExportMarkdown; keep statsLine and payload-theme round-trip), U37 (retarget onto buildStaticHtml), E63, E65, E66, E67 (static-page assertions per SPEC18 §4.2); no new runtime dependencies (print_view uses tauri itself); the sidecar/trailer formats, theme format, comment-anchor space, SPEC11 network isolation, SPEC13 aux protocol, SPEC14/15/16 behaviors, the Export dialog UX otherwise, and all web behavior are unchanged; the version files stay at 0.2.0-alpha.3. Stop after 100 turns or 10 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part)

```bash
cd ~/src/marky-mark
! git push
# then cut 0.2.0-alpha.4 per docs/RELEASING.md
```

Manual checks (the parts automation can't see):

- **PDF first — the headline fix:** File → Export… → PDF → Export. The
  macOS print dialog must open with the themed document; PDF ▾ → Save as
  PDF gives a clean file (highlights visible when comments on, stats line
  when word count on, neither when off).
- **HTML:** export and open in Safari — a clean static reading page, no
  app chrome, no scripts (view source), comments as numbered notes at the
  end, chosen theme applied.
- **Word count off** exports contain no count anywhere, both formats.
- The app is ~1.2 MB smaller than v17 (the embedded viewer is gone).
