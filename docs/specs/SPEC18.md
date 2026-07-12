# SPEC18: Marky Mark v18 — static HTML export, working PDF

Delta spec on top of SPEC.md–SPEC17.md as implemented (all green: U1–U38,
E1–E41 + E45–E67, W1–W7; SPEC8 still pending, E42–E44 reserved). This file
wins on conflict; nothing may regress. §7 is the goal condition.

**What ships:** the Export dialog's **HTML format becomes a beautiful,
fully static reading page** — the themed document and nothing else: no app
UI, no settings, no scripts at all. Comments (when included) render as
highlights with numbered references and a static "Comments" section at the
end. The word-count option is honored exactly (the stats line is the only
word count an export ever shows). And **PDF works**: printing moves from
the webview's dead `window.print()` to a real native print command in Rust.

Out of scope: removing the reviewBundle library or the web build's
bundle-boot path (they stay as a documented format the viewer accepts —
W6/W7 keep passing untouched); PDF without the OS print dialog; comment
threads in the PDF margin; pagination controls.

---

## 1. Static HTML export (FR-H)

1. The dialog's HTML format ("HTML — static reading page") produces a
   **complete standalone document with zero `<script` tags**: inline theme
   CSS (the chosen theme), clean reading styles (centered measure, the
   app's document typography via the `--mm-*` contract), the rendered
   markdown, `<title>` = the document name. Nothing interactive, nothing
   network-touching (no `http(s)` srcs, no `@import`).
2. **Include comments** (open comments only, resolved skipped): the
   commented ranges render as `mark.hl` highlights carrying a numbered
   superscript reference (`<sup class="mm-ref"><a href="#mm-comment-N">`),
   and the page ends with a **Comments** section — one entry per comment
   (`id="mm-comment-N"`): the quoted excerpt, author, body, and replies,
   statically rendered. Unchecked ⇒ no marks, no refs, no section.
3. **Include word count**: exactly the SPEC17 stats line
   (`*N words · M min read*` styling) at the end of the document.
   **Unchecked ⇒ the artifact contains no word count anywhere** (the
   SPEC17 bundle leaked the viewer's chip; static pages fix this by
   construction, and E68 pins it).
4. Save flow: suggested name **`<basename>.html`**, html filter. The HTML
   option is now **always enabled** — no template needed.
5. **Pure builder** (`src/lib/exportDoc.ts` refactor):
   `buildStaticHtml({ title, bodyHtml, themeCss, stats?, comments? })`
   where `comments` is pre-shaped static data (number, excerpt, author,
   body, replies). `buildExportMarkdown` and `buildPrintHtml` retire in
   its favor (their U36/U37 assertions are amended to the new surface;
   `statsLine` and the reviewBundle payload-theme round-trip survive).

## 2. PDF that actually works (FR-P)

1. The printview flow stays (SPEC17 §3 window + bus), but the print
   invocation becomes a **Rust command**: `print_view` in `lib.rs` calls
   the webview's native `print()` (the same API the File-menu print of a
   normal browser uses) — `window.print()` in WKWebView is a silent no-op
   and is removed. The printview window invokes the command once the page
   has laid out, and closes after the command resolves (grace period).
2. **The PDF prints the same §1 static page** (identical builder output),
   so HTML and PDF exports look the same. Options behave identically
   (comments section included when checked; stats line when checked).
3. No new dependencies; no capability widening beyond what SPEC17 already
   granted the printview window (app commands need no capability entries,
   matching `take_pending_open_files`).

## 3. Retiring the interactive-bundle export

1. The dialog no longer produces review bundles, so the app-side template
   machinery goes: `Platform.reviewTemplate` (types/tauri/browser), the
   `import.meta.glob` embedding, the `canExportReview` App state, and
   `tauri.conf.json`'s `beforeBuildCommand` reverts to `npm run build`
   (the desktop bundle sheds the embedded 1.2 MB viewer — the ONLY
   permitted tauri.conf.json change).
2. `src/lib/reviewBundle.ts` and the web boot path **stay** (W6/W7
   untouched): the bundle format remains something the web viewer opens.
3. The web build's tauri-platform stub (vite.web.config.ts) stays — it's
   what keeps the single file lean.

## 4. Tests

1. **U39** — `buildStaticHtml`: zero `<script` tags; theme CSS present;
   title escaped into `<title>`; stats line present iff given; comments
   section with numbered ids/refs present iff given; no `http(s)://` or
   `@import` introduced.
2. **Amended, not weakened:** U36 (drops `buildExportMarkdown`; keeps
   `statsLine` math and the payload-theme round-trip), U37 (retargets
   `buildPrintHtml` assertions onto `buildStaticHtml`), E63 (the dialog's
   default HTML export: a static page — no scripts, doc text present,
   comment excerpts + refs present, trailer/JSON payload absent), E65
   (comments-off ⇒ no Comments section and no `mark.hl`; word-count-on ⇒
   stats line), E66 (sticky theme: the artifact contains the chosen
   theme's CSS marker instead of a payload field), E67 (the shim-recorded
   print page equals the static-page shape: no scripts, theme marker,
   stats line, highlights when comments on).
3. **E68** (new) — word count off is honored end-to-end: export HTML with
   the checkbox unchecked ⇒ the artifact contains no "min read" and no
   word-count text anywhere; same assertion for the PDF path via
   `__mmPrints`.
4. No other existing test may be modified, weakened, skipped, or deleted;
   E42–E44 stay reserved; W1–W7 run unchanged.

## 5. Docs

1. README export bullet: static reading page (HTML) or PDF, options,
   sticky theme. Size claim re-checked (the app shrinks back to ~6 MB).

## 6. Manual acceptance (GOAL18 lists these; automation can't see them)

1. Export → HTML opens in a browser as a clean readable page — no app
   chrome, comments as numbered notes at the end.
2. Export → PDF opens the macOS print dialog with the themed document;
   Save as PDF produces a correct file. **This is the headline fix — test
   it first.**

## 7. Definition of Done (the /goal condition verifies exactly this)

1. `npm run validate` exits 0 with complete output — **U1–U39, E1–E41 +
   E45–E68, W1–W7**, the single-file check, the static bundle scan line,
   and `VALIDATION: ALL PASSED` — printed in the transcript.
2. `npm run tauri build` (macOS) exits 0; app path + size printed; the
   app no longer embeds the web viewer (no ~1.2 MB template chunk).
3. Windows-reserved-name scan prints nothing.
4. `git diff` for `src-tauri/tauri.conf.json` across the milestone shows
   only the `beforeBuildCommand` revert; sanitize schema untouched; aux
   capability still free of `fs:`/`dialog:`/`opener:`;
   `git diff --stat docs/specs/` empty;
   `grep -rEn '\.(skip|only|todo)\(' tests/` prints nothing.
5. README updated per §5; version files untouched (0.2.0-alpha.3); no new
   runtime dependencies (the Rust `print_view` command uses tauri itself).
