# SPEC17: Marky Mark v17 — the Export dialog (HTML & PDF, options, sticky theme)

Delta spec on top of SPEC.md–SPEC16.md as implemented (all green: U1–U35,
E1–E41 + E45–E64, W1–W6; SPEC8 still pending, E42–E44 reserved). This file
wins on conflict; nothing may regress. §8 is the goal condition.

**What ships:** "Export Review Bundle…" grows into **File → Export…** — a
dialog where you choose the **format** (self-contained HTML review bundle,
or **PDF** via the OS print dialog), whether to include **comments**,
whether to include a **word-count line**, and the **theme** the export uses
(the current one or any other). The theme choice is **sticky** — the app
remembers it for subsequent exports. One **Export** button runs it.

Out of scope: direct PDF file generation without the OS print dialog (no
new dependencies), exporting from the web build (its dialog never shows —
web still only *opens* bundles), per-export page-size/margin controls,
remembering the format/comments/word-count choices (only the theme sticks),
batch export.

---

## 1. The dialog (FR-X)

1. Command **`exportDoc`** (replacing `exportReview`); File → **Export…**
   sits where Export Review Bundle… did, on both OS layouts, now **always
   present** (no template gating — PDF works without the template). With no
   document open the command is a silent no-op.
2. Invoking opens an in-app modal (overlay + modal, like the close prompt —
   not an aux window; it's transient). Test id `export-dialog`. Contents:
   - **Format** radios: `export-format-html` ("HTML — self-contained review
     page"), `export-format-pdf` ("PDF — via the system print dialog").
     HTML is the default. HTML is **disabled** when no review template is
     available (template-less dev builds); PDF is **disabled** when the
     platform can't print (web).
   - **Include comments** checkbox (`export-include-comments`), default
     checked. Unchecked ⇒ the artifact carries no comment threads at all.
   - **Include word count** checkbox (`export-include-wordcount`), default
     checked. Checked ⇒ the exported document ends with a discreet italic
     stats line — `*1,234 words · 6 min read*` — appended to the exported
     copy only (the source file is never touched).
   - **Theme** select (`export-theme`): first option **"Current theme"**
     (value `current`), then every installed theme by name. Defaults to the
     remembered choice (§4).
   - **Export** button (`export-run`) and **Cancel** (`export-cancel`);
     Esc and scrim-click cancel. Export closes the dialog and runs §2/§3.
3. The dialog is pure app UI — identical on desktop and shim. (The web
   build never shows it; its File menu is the hamburger, unchanged.)

## 2. HTML export (FR-H)

1. As today's review bundle (SPEC16 §1 mechanics, template + payload),
   with the options applied via a **pure builder**
   (`src/lib/exportDoc.ts`): `buildExportMarkdown(buffer, comments,
   { includeComments, includeWordCount }): string` — attaches the embedded
   trailer only when comments are included, appends the stats line when
   word count is included (stats computed from the document text, 220 wpm
   ceiling as SPEC16 §5).
2. The payload (`ReviewPayload`) gains an optional **`theme?: string`**
   (a theme id; absent when "Current theme" is chosen and the export just
   uses the exporter's active theme id). The **web boot path applies it**:
   a bundle carrying `theme` opens with that theme active for the session
   (both light and dark slots point at it; nothing is persisted to the
   recipient's localStorage). Unknown ids fall back to the default theme
   chain. `buildReviewBundle`/`extractReviewPayload` round-trip the field
   unchanged.
3. Save flow as today: save dialog (`.review.html` suggestion, html
   filter), write the composed bundle.

## 3. PDF export (FR-P)

1. PDF rides the OS print dialog (macOS: PDF ▾ / Save as PDF) — honest
   about the mechanism, zero new dependencies. The platform seam is
   **`printDocument?(html: string): Promise<void>`**:
   - **tauri.ts**: opens a dedicated window (label `printview`, hidden or
     small; `?window=printview` through the SPEC13 window-role router),
     hands it the print-ready HTML over the existing aux bus, and the
     print view invokes the webview's native print once rendered. Closing
     the print dialog closes the window. The `printview` label joins the
     aux capability (events + self-close + print permission only — still
     no fs/dialog/opener there).
   - **browser.ts** (shim): records the html on `window.__mmPrints`
     (array) — the e2e seam. **web.ts**: undefined (PDF disabled, §1.2).
2. The print-ready HTML is composed by the pure builder
   (`buildPrintHtml(renderedHtml, themeCss, statsLine?): string` in
   `exportDoc.ts`): a minimal standalone page — the chosen theme's CSS,
   the app's document styles for print (reasonable print stylesheet:
   white-page friendly, no fixed chrome), the rendered document, the
   optional stats line. Comments in a PDF render as the highlighted text
   only when comments are included — margin cards are NOT reproduced in
   v17 (print shows `mark` highlights; threads are a bundle feature).
3. The markdown → HTML rendering for print reuses the existing pipeline
   (same sanitize guarantees; no network in the print view — theme CSS is
   inlined text, images resolve as in the app).

## 4. Sticky export theme (FR-S)

1. `Settings` gains **`exportTheme: string`** — `'current'` (default) or a
   theme id. Parse: any non-empty string accepted, else default;
   serialize as usual; old settings files parse to `'current'`.
2. The dialog initializes its theme select from it and **persists every
   change immediately** (through the normal settings write), so the next
   export — even after a restart — remembers.

## 5. Menus, commands, amendments

1. `CommandId`: `exportReview` → **`exportDoc`**; File item label
   **"Export…"**, always present. `MenuState.canExportReview` is no longer
   a menu concern — it moves into the dialog (HTML option gating) and
   leaves `MenuState` (the field is removed).
2. **Amended, not weakened:** U19/U20 (File list carries `exportDoc`,
   ungated), U34 (its exportReview gating assertions become: `exportDoc`
   always present; the rest of U34 unchanged), and E63 (drives the new
   dialog: open → keep defaults → Export → same bundle assertions). No
   other existing test may be modified, weakened, skipped, or deleted;
   E42–E44 stay reserved.

## 6. Web build & shim

1. Web: §2.2 theme-carrying boot is the only behavior change; W1–W6 stay
   green.
2. Shim: `__mmPrints` seam (§3.1); its stub review template keeps E-tests
   template-independent.

## 7. Tests (added: U36–U38, E65–E67, W7)

1. **U36** — `buildExportMarkdown`: all four option combinations —
   trailer present/absent, stats line present/absent (exact format,
   220 wpm math), source text otherwise byte-identical; payload `theme`
   round-trips through `buildReviewBundle`/`extractReviewPayload`.
2. **U37** — `buildPrintHtml`: contains the theme CSS, the rendered doc,
   and the stats line when given; is a complete standalone document; no
   remote references introduced.
3. **U38** — menu: File carries `exportDoc` ("Export…") on both layouts
   unconditionally; `canExportReview` no longer exists in `MenuState`
   (type-level: the fixture compiles without it).
4. **E65** — dialog flow: Export… opens the dialog with defaults (HTML,
   both includes on, remembered theme); Cancel and Esc close without
   exporting; with comments unchecked the written bundle has **no**
   trailer; with word count checked the payload markdown ends with the
   stats line.
5. **E66** — sticky theme: pick a non-current theme, Export; reopen the
   dialog → still selected; survives `settings.json` round-trip (reload);
   the written payload carries that theme id.
6. **E67** — PDF path: choose PDF, Export → `window.__mmPrints` gains one
   entry containing the rendered document text, the chosen theme's CSS
   marker, and (when enabled) the stats line; no file is written.
7. **W6 stays green; W7** — a bundle whose payload carries a theme id
   boots with that theme applied (background color assertion), without
   touching the recipient's persisted settings (localStorage theme keys
   unchanged after boot).

## 8. Definition of Done (the /goal condition verifies exactly this)

1. `npm run validate` exits 0 with complete output — **U1–U38, E1–E41 +
   E45–E67, W1–W7**, the single-file check, the static bundle scan line,
   and `VALIDATION: ALL PASSED` — printed in the transcript.
2. `npm run tauri build` (macOS) exits 0; app path + size printed.
3. Windows-reserved-name scan (standard command) prints nothing — note
   `printview`, not `prn`-anything, for the print window label and files.
4. `git diff src-tauri/tauri.conf.json` shows no change; the sanitize
   schema is untouched; aux-window capability still contains no
   `fs:`/`dialog:`/`opener:` identifiers; `git diff --stat docs/specs/`
   is empty; `grep -rEn '\.(skip|only|todo)\(' tests/` prints nothing.
5. README's export bullet describes the dialog (HTML/PDF, options, sticky
   theme); version files untouched (0.2.0-alpha.3); no new runtime
   dependencies.
