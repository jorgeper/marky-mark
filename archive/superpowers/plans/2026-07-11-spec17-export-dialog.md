# SPEC17 Export Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** File → Export… dialog: HTML or PDF, include-comments / include-word-count options, sticky export theme (SPEC17).

**Architecture:** Pure `exportDoc.ts` builds the artifact inputs (markdown with/without trailer and stats line; standalone print HTML). The dialog is an in-app modal; HTML reuses the SPEC16 bundle path (payload gains `theme`); PDF rides a new `printview` aux window that calls the webview's native print. `Settings.exportTheme` persists the theme choice.

## Global Constraints
- Only new tests U36–U38, E65–E67, W7; amendments only U19/U20/U34/E63. No new deps; versions 0.2.0-alpha.3; tauri.conf/sanitize/aux-capability(no fs/dialog/opener) unchanged; reserved-name scan clean (`printview`, never `prn*`).

### Task 1: pure exportDoc + payload theme (U36, U37)
- `src/lib/exportDoc.ts`: `ExportOptions {includeComments, includeWordCount}`; `statsLine(text)` → `'1,234 words · 6 min read'` (uses countWords); `buildExportMarkdown(buffer, comments, opts)` → attachEmbedded when comments on, append `\n*<stats>*\n` when word count on (stats over the plain buffer text); `buildPrintHtml(renderedHtml, themeCss, stats?)` → complete standalone html (`<!doctype html>` + inline `<style>` theme css + minimal print/document styles + `.theme-root .doc` wrapper + optional `<p class="mm-stats"><em>…</em></p>`).
- `reviewBundle.ts`: `ReviewPayload.theme?: string`; build passes it through; extract validates optional string.
- Tests `tests/unit/export-doc.test.ts` (U36: four option combos exact, byte-identity of source, stats math; theme round-trip through build/extract) and U37 in the same file or its own (print html completeness, theme css + doc + stats present, no `http(s)://` introduced).

### Task 2: settings + commands + menu (U38 + U19/U20/U34 amendments)
- settings.ts: `exportTheme: string` default `'current'`; parse non-empty string else default.
- commands.ts: `exportReview` → `exportDoc`.
- menuSpec.ts: File item `cmd('exportDoc', 'Export…')` after saveAs, unconditional; `MenuState.canExportReview` removed.
- menu-spec.test.ts: base fixture drops canExportReview; U19/U20 File lists use `exportDoc`; U34's export assertions → always-present 'Export…'; add U38 (both layouts unconditional; label).

### Task 3: platform print seam + printview window
- types.ts: `printDocument?(html: string): Promise<void>`.
- windowRole.ts: `'printview'` joins the role union (U22 untouched — it never enumerates valids).
- tauri.ts: `printDocument` — pending html; listen `mm://print-ready` → emit `mm://print-doc` {html}; create `WebviewWindow('printview', { url 'index.html?window=printview', width 900, height 700, center, title 'Print' })`; the PrintView page prints and self-closes.
- `src/PrintView.tsx` (root next to AuxWindow): on mount busEmit `mm://print-ready`; on `mm://print-doc` set documentElement content (write the standalone html via `document.open/write/close` or set innerHTML of a container + inject style), then `getCurrentWebviewWindow().print()` (dynamic import inside tauri platform guard — PrintView must stay platform-agnostic: add `printSelf?()`+`closeNow` via platform; simplest: platform gains nothing — PrintView uses `platform.busListen/busEmit` + a new tiny optional `platform.printPage?(): Promise<void>` implemented in tauri (webview print) and shim (records)). Keep: PrintView renders received html inside a `.theme-root` container with the style tag, calls `platform.printPage?.()`, then `platform.closeNow()` after it resolves (500ms grace).
- main.tsx routes printview → PrintView.
- browser.ts: `printDocument` records `window.__mmPrints.push(html)` (declare global). `printPage` not needed on shim (printDocument short-circuits — the shim never opens a window).
- Capability: `src-tauri/capabilities/auxiliary.json` windows gains `"printview"`, permissions gain `"core:webview:allow-print"`. cargo check regenerates schemas.

### Task 4: ExportDialog + App wiring
- `src/components/ExportDialog.tsx`: props {themes, initialTheme, canHtml, canPdf, onThemeChange(id), onExport(opts: {format, includeComments, includeWordCount, theme}), onClose}; overlay+modal per spec test ids; Esc closes (document keydown); radios/checkboxes/select/buttons.
- App.tsx: `exportOpen` state; `exportDoc` command → no doc ⇒ no-op else open. Dialog props: canHtml = canExportReview (existing state), canPdf = !!platform.printDocument; theme select initial from settings.exportTheme; onThemeChange persists immediately via updateSettings.
- onExport(opts): close dialog; resolve theme id (`opts.theme === 'current'` ⇒ active wanted theme id — compute like the theme effect); HTML: template → saveFileDialog(html) → buildExportMarkdown → buildReviewBundle({name, markdown, theme: opts.theme==='current' ? activeId : opts.theme}) → write. PDF: renderMarkdown(buffer or export markdown w/o trailer) → if includeComments, re-inject highlight marks into a detached DOM via reanchor/highlightRange (reuse getDocText? domtext works on live elements — use a detached `document.createElement('div')` with innerHTML; getDocText+reanchor+highlightRange operate on it) → buildPrintHtml(html, themeCss, stats?) → platform.printDocument(html).
- Web boot theme: in App bootstrap, `if (p.kind === 'web') { const payload = extractReviewPayload(document); if (payload?.theme) loaded = { ...loaded, themeLight: payload.theme, themeDark: payload.theme }; }` — session-only (boot uses setSettings, not persisted).
- styles.css: export dialog reuses `.overlay`/`.modal` (fields rows); minimal additions.

### Task 5: e2e — amend E63, add E65–E67, W7
- E63: after menuClick('exportDoc') → `export-dialog` visible → set nextSavePath → click `export-run` → same assertions.
- E65: dialog defaults (html checked, both includes checked); Esc cancels (no file); uncheck comments → export → no `markimark-comments` in payload; word count on → payload markdown ends with `*N words · M min read*` line.
- E66: select a specific theme (e.g. 'dracula') → export → payload.theme === 'dracula'; reopen dialog → still selected; settings.json carries exportTheme; reload app → dialog still remembers.
- E67: choose PDF → export → `window.__mmPrints` length 1, entry contains doc text + a distinctive theme css marker + stats line when enabled; no file written to nextSavePath.
- W7 (web.spec): compose bundle with payload theme 'dracula' → boot → `.theme-root` background is Dracula's (#282a36 → rgb(40,42,54)); localStorage settings key absent/unchanged after boot.

### Task 6: README + gate
- README export bullet → dialog (HTML/PDF, options, sticky theme). `npm run validate`; `npm run tauri build`; DoD greps; commit; report.
