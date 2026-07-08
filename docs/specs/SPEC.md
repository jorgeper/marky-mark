# SPEC: Markimark — a fast, themeable Markdown viewer

A lightweight desktop Markdown viewer for macOS (Windows-ready) that opens `.md` files by
double-click, renders them beautifully, supports drop-in themes, has a single-keystroke
swap between preview and edit mode, and carries over the experimental
"markdown with comments" feature from the sibling `md-with-comments` project.

This spec is written to be executed autonomously by Claude Code using `/goal`. Read the
whole file before writing any code. The Definition of Done in §9 is the goal condition —
every item must be provable in the transcript via the validation harness in §8.

---

## 1. Product principles

- **Lightweight.** Small install, tiny memory footprint, instant launch. This is a viewer,
  not an IDE.
- **Fast.** Cold start to rendered document in under a second; theme switches and
  edit/preview toggles feel instantaneous.
- **Sleek and modern.** Minimal chrome. The document is the UI. No sidebars, no file
  trees, no side-by-side panes.
- **Mac first, Windows later.** Build and package for macOS now; every line of app code
  must be portable so a Windows build is a packaging task, not a rewrite.

## 2. Tech stack (fixed — do not substitute)

- **Shell:** Tauri 2 (Rust host + OS-native webview). NOT Electron — Tauri gives a
  ~10 MB app using WKWebView on macOS and WebView2 on Windows, which is the whole point
  of "lightweight". Keep the Rust side minimal: window management, file associations,
  and the fs/dialog/path plugins. All app logic lives in the frontend.
- **Frontend:** React + TypeScript, built with Vite. (React is pinned because the
  comments UI is ported from `md-with-comments`, which is React. The bundle is local, so
  this does not affect startup weight meaningfully.)
- **Markdown rendering:** the same `unified` pipeline as `md-with-comments`:
  `remark-parse` → `remark-gfm` → `remark-rehype` → `rehype-sanitize` (GitHub schema,
  keep task-list checkboxes) → `rehype-stringify`. This is mandatory — comment anchors
  are offsets into the rendered plain text, and using the identical pipeline keeps
  sidecar files interoperable between the two apps.
- **Editor:** CodeMirror 6 with the markdown language package. Loaded lazily so it costs
  nothing until the first toggle into edit mode.
- **Fuzzy re-anchoring:** `diff-match-patch`.
- **Unit tests:** Vitest. **E2E tests:** Playwright (headless Chromium) against the
  browser platform shim (§6). Do not attempt `tauri-driver` — it does not support macOS.
- **No network access ever.** No CDN fonts, no telemetry, no update pings. Everything is
  bundled or read from local disk.

## 3. Functional requirements

### FR-1: Opening and rendering files
1. The app opens `.md`/`.markdown` files three ways: double-click in Finder (file
   association via Tauri bundle config + macOS open-file events), File → Open (native
   dialog, `Cmd+O`), and drag-and-drop onto the window.
2. Rendering is GitHub-flavored: headings, tables, task lists, strikethrough, fenced
   code blocks with syntax highlighting (a bundled highlighter such as `lowlight`/
   `highlight.js` subset — no network), blockquotes, links, images (local paths resolved
   relative to the file).
3. Output is sanitized (`rehype-sanitize`) — documents can never execute script.
4. The window title shows the filename. Reopening the app restores window size/position.
5. If the file changes on disk while in preview mode, the view reloads automatically
   (debounced) and comments re-anchor (FR-8).

### FR-2: Theming (the flagship feature)
1. A theme is a **single `.css` file** that sets a documented contract of CSS custom
   properties, with metadata in a leading comment block:
   ```css
   /* @name: Midnight Ocean
      @author: jorge
      @variant: dark */
   .theme-root {
     --mm-bg: #0b1622;
     --mm-fg: #d8e2ec;
     --mm-accent: #4aa8ff;
     --mm-font-body: ui-sans-serif, system-ui, sans-serif;
     /* ... full contract in THEMES.md ... */
   }
   ```
   A theme file may also include arbitrary extra CSS scoped under `.theme-root` for
   effects the variables can't express. Themes must not reference remote URLs (enforce:
   reject/ignore `url(http…)` at load time and document it).
2. **Built-in themes** are bundled as resources. **User themes** live in the app config
   directory: `~/Library/Application Support/com.markimark.app/themes/` on macOS (via
   Tauri's `appConfigDir()`, so Windows resolves to `%APPDATA%` automatically). The app
   creates this folder on first run. Dropping a `.css` file there and choosing
   "Reload themes" (or restarting) makes it appear in the theme picker.
3. The theme picker is a minimal dropdown/popover in the toolbar; switching applies
   instantly (swap a `<style>` element / stylesheet link — no reload). The selected
   theme persists in settings.
4. The full variable contract, metadata keys, and a copy-paste starter theme are
   documented in **`THEMES.md`** at the repo root (this file is a deliverable; also
   copy it into the themes config folder on first run as `README.md` so users find it
   where they drop themes).
5. The variable contract must cover at minimum: page background, content max-width,
   body/heading/code font families and sizes, text/heading/link/accent colors, code
   block background and per-token syntax colors, blockquote, table borders/stripes,
   horizontal rule, selection color, and the comment-highlight tint (FR-7).

### FR-3: Built-in themes (ship exactly these seven)
1. **Crisp** *(default)* — pure white background, near-black text, generous line height,
   system font stack, restrained blue links. Maximum readability; looks like good print.
2. **Claude** — elegant off-whites (warm paper `#faf9f5`-family background), warm dark
   ink, terracotta accent (`#d97757`-family), serif headings (Georgia/Charter stack) with
   clean sans body. Refined and calm.
3. **Monokai** — the classic editor palette: `#272822` background, vivid green/pink/
   orange/purple syntax colors carried into headings and accents.
4. **Dracula** — dark `#282a36`, purple/pink/cyan accents per the official palette.
5. **Nord** — arctic blue-grays (`#2e3440` family), frosty cyan accents.
6. **Solarized Light** — `#fdf6e3` background with the canonical Solarized accent set.
7. **One Dark** — Atom's One Dark palette: `#282c34`, soft blue/red/yellow accents.

   Each ships as a normal theme `.css` file (bundled), proving the theme system by
   dogfooding — built-ins get no special code path except being bundled.

### FR-4: Edit mode (swap, never side-by-side)
1. A toolbar toggle (and hotkey, default `Cmd+E`) swaps the **entire view** between
   preview and edit mode. No split view exists anywhere in the app.
2. Edit mode is CodeMirror 6 showing the markdown source, styled to match the active
   theme (background/fonts follow theme variables).
3. `Cmd+S` saves. A subtle dirty-dot indicator shows unsaved changes. Toggling back to
   preview re-renders the current buffer (even if unsaved) and prompts nothing; closing
   the window with unsaved changes asks confirm/save/discard.
4. Toggling preview ↔ edit must feel instant (< 100 ms after CodeMirror's one-time lazy
   load) and preserve approximate scroll position between modes.

### FR-5: Settings and hotkeys
1. Settings persist to `settings.json` in the app config directory (same folder family
   as themes), pretty-printed and human-editable.
2. A minimal settings UI (gear icon → panel) exposes: theme selection, **hotkey
   remapping** for at least *toggle edit/preview*, *open file*, *toggle comments*, and
   *save*, plus the comment author name (FR-7) and an autosave-on-toggle option.
3. Hotkey capture works by pressing the desired combo in a recorder field; conflicts
   with another binding are rejected with a message. Settings changes apply immediately.

### FR-6: Cross-platform discipline (Windows-readiness)
1. All filesystem, dialog, path, and window access goes through one module,
   `src/platform/`, with two implementations: `tauri.ts` (real) and `browser.ts` (an
   in-memory shim used by Vite dev mode and Playwright, seeded with fixture files and
   exposed to tests as `window.__mmfs` for reading/writing/mutating files).
2. No macOS-only assumptions in app code: use `appConfigDir()`-style APIs, never
   hardcoded `~/Library` paths; path joins via the platform module.
3. `src-tauri/tauri.conf.json` declares the `.md`/`.markdown` file associations; a
   comment or `WINDOWS.md` note records what the Windows build needs (WebView2, NSIS
   target, same file-association block) — do not build Windows artifacts now.

### FR-7: Comments (experimental — port from `md-with-comments`)
Port the commenting feature from the sibling repo `../md-with-comments` (read its
`SPEC.md`, `ARCHITECTURE.md`, and `src/lib/` first; reuse/adapt its pure modules
`anchoring.ts` and `domtext.ts` — they have no DOM-framework dependencies).
1. In **preview mode only**, selecting text shows a floating "Add comment" button;
   submitting creates a highlighted range and a card in a right-hand margin panel that
   appears only when comments exist or comment mode is toggled on (`Cmd+Shift+C`
   default). The panel must feel like part of the viewer: cards align with their
   highlights and push each other down to avoid overlap.
2. Cards support threaded replies, edit, delete (root delete = whole thread, with
   confirm), resolve/reopen, and a Resolved (N) collapsed section — same behavior as
   `md-with-comments` FR-5/FR-6.
3. **Sidecar format is byte-schema-compatible with `md-with-comments`:** comments for
   `foo.md` persist to `foo.md.comments.json` next to the file, pretty-printed, with the
   identical schema: `{comments: [{id, author, createdAt, body, resolved, thread[],
   anchor: {exact, prefix, suffix, start, end}}]}` where prefix/suffix are 32 chars and
   offsets index into the **rendered plain text** (concatenated DOM text nodes). A file
   commented in either app must open correctly in the other.
4. Autosave the sidecar debounced ≤ 2 s after any change. If a document has no comments,
   delete the sidecar rather than leaving an empty one.
5. Re-anchoring cascade on every load, in order: exact-at-offset → unique/disambiguated
   quote search (prefix/suffix, ties break nearest stored offset) → `diff-match-patch`
   fuzzy (threshold 0.4; >32-char selections stitch first/last 32-char matches with the
   0.5×–2× length sanity check) → **orphaned** (card remains with badge + original
   quote; no highlight; nothing deleted). After success, refresh stored anchors.
6. Highlights use the active theme's `--mm-comment-tint`; overlaps nest and darken.

### FR-8: Comments survive edits
1. Edits made in the app's own edit mode, and external on-disk edits detected by the
   file watcher, both trigger re-anchor on return to preview — inserted text elsewhere
   must not detach comments; deleting anchored text orphans (never crashes or drops).

## 4. Non-functional requirements

- **Perf budgets** (Apple Silicon, release build): cold launch → rendered doc < 1 s;
  open a 5,000-line markdown file < 300 ms; theme switch < 50 ms; preview⇄edit toggle
  < 100 ms warm. Record measured numbers in `ARCHITECTURE.md`.
- Packaged macOS `.app` under 25 MB.
- `npm install && npm run dev` runs the browser-shim app; `npm run tauri dev` runs the
  real app. `npm run tauri build` produces the installable `.app`/`.dmg`.
- Zero TypeScript errors; zero browser console errors during any E2E run (enforced by a
  shared Playwright fixture that fails on console errors).
- Anchoring and theme-parsing logic live in pure, DOM-free, unit-testable modules.

## 5. Project structure (target)

```
marky-mark/
  SPEC.md                    (this file — do not modify)
  GOAL.md                    (the /goal launch command)
  ARCHITECTURE.md            (written by you: decisions, coordinate space, perf numbers)
  THEMES.md                  (user-facing: how to create a theme; the variable contract)
  package.json               (scripts: dev, build, tauri, test:unit, test:e2e, validate)
  src-tauri/                 (Rust host, tauri.conf.json with file associations)
  src/
    platform/                (tauri.ts / browser.ts behind one interface)
    lib/                     (markdown.ts, anchoring.ts, domtext.ts, themes.ts — pure)
    components/              (viewer, editor, comments panel, settings, toolbar)
  themes/                    (the seven built-in .css themes, bundled as resources)
  fixtures/                  (sample docs incl. one ≥2,000 words with rich structure)
  tests/
    unit/                    (Vitest)
    e2e/                     (Playwright, browser shim)
```

## 6. Build order (follow this sequence)

1. Scaffold Tauri 2 + Vite + React + TS; get `npm run dev` (browser shim) rendering a
   fixture document with the unified pipeline; `npm run tauri dev` opens the same.
2. Theme engine with its unit tests first (metadata parse, variable application, remote-
   URL rejection), then the seven built-in themes and the picker. Write `THEMES.md`.
3. Edit mode toggle + save + dirty state; settings + hotkey remapping.
4. Comments port: adapt `anchoring.ts`/`domtext.ts` from `../md-with-comments` with unit
   tests green (U-tests below), then the panel UI, persistence, re-anchoring/orphaning.
5. File association config + open-file event handling; file watcher.
6. Write all Playwright tests, make `npm run validate` fully green, then package with
   `npm run tauri build` and record perf numbers.

## 7. Sample content

Ship `fixtures/welcome.md` (a friendly tour that demos every theme feature) and
`fixtures/field-guide.md` (≥ 2,000 words, headings/lists/code/tables/blockquotes/links —
copy or adapt from `../md-with-comments/documents/`). On first run with no file argument,
open `welcome.md`.

## 8. Validation harness (MUST exist exactly as specified)

`npm run validate` runs, in order, failing on first non-zero exit:

1. `tsc --noEmit` — zero type errors.
2. `npm run test:unit` — Vitest, at minimum:
   - **U1** exact-offset re-anchor succeeds after no edit
   - **U2** quote-search re-anchor succeeds after insertion before the anchor
   - **U3** prefix/suffix disambiguates when `exact` appears 3+ times
   - **U4** fuzzy re-anchor survives a 1–2 char typo inside the anchored text
   - **U5** orphaning triggers when anchored text is fully deleted
   - **U6** theme metadata parser extracts `@name`/`@variant`/`@author`; malformed or
     missing metadata falls back to filename, never throws
   - **U7** themes containing remote `url(http…)` references are rejected/sanitized
   - **U8** sidecar round-trip: serialize → parse yields identical comments, and a real
     sidecar fixture from `../md-with-comments` (copy one into `fixtures/`) parses
     without loss
3. `npm run test:e2e` — Playwright headless against the browser shim, at minimum:
   - **E1** launch → welcome doc renders (heading, code block, table visible)
   - **E2** theme picker lists the 7 built-ins; switching to Monokai changes computed
     background color; choice persists across reload
   - **E3** write a new user theme `.css` into the shim config dir → reload themes →
     it appears in the picker and applies
   - **E4** toggle to edit mode (via hotkey) shows markdown source; toggle back shows
     rendered preview; edit some text → preview reflects it
   - **E5** `Cmd+S` in edit mode persists the change to the (shim) file; dirty
     indicator clears
   - **E6** remap the toggle hotkey in settings → new combo works, old combo does not
   - **E7** select text → Add comment → highlight in DOM + card in panel with body
   - **E8** reload → comment, highlight, thread state persist via sidecar
   - **E9** reply, edit reply, resolve (highlight gone, card in Resolved), reopen
   - **E10** comment spanning two paragraphs highlights in both; deleting a comment
     (confirm) removes it from DOM and sidecar JSON
   - **E11** edit-survival: insert a paragraph near the top via the shim fs → reload →
     highlighted string still equals the original `exact`
   - **E12** orphan: delete the anchored sentence via shim fs → reload → orphan badge,
     no highlight, zero console errors
4. `cargo check` inside `src-tauri/` exits 0 (proves the Rust host compiles without
   paying full-build time on every validate).
5. Print `VALIDATION: ALL PASSED` as the final line only if steps 1–4 all exited 0.

**Anti-gaming constraints (binding):**
- No test may be skipped, stubbed, `.skip`/`.only`/`.todo`-ed, or have assertions
  weakened to pass. No hardcoding expected outputs in app code.
- The browser shim must exercise the same app code as Tauri — only `src/platform/`
  differs. Tests that bypass the UI to poke internal state don't count as E-tests.
- If something is genuinely infeasible, write it to `BLOCKERS.md` with reasoning and
  keep everything else green — never silently drop a requirement.
- `SPEC.md` and the goal condition must not be modified.

## 9. Definition of Done (the /goal condition verifies exactly this)

All of the following demonstrated in the transcript, in the same turn that claims
completion:
1. `npm run validate` exits 0 with its complete output — U1–U8, E1–E12, and the final
   `VALIDATION: ALL PASSED` line — printed in the transcript.
2. `npm run tauri build` exits 0 and the produced `.app` path and size are printed
   (size < 25 MB).
3. `grep -rn "\.skip\|\.only\|\.todo" tests/` prints nothing.
4. `ls themes/` shows the seven built-in theme files; `THEMES.md` and
   `ARCHITECTURE.md` exist; `ARCHITECTURE.md` states the anchor coordinate space and
   measured perf numbers.
5. A sidecar fixture copied from `../md-with-comments` is present under `fixtures/` and
   covered by U8 (interop proof).

---

## 10. How to launch the run

See `GOAL.md` for the exact `/goal` command (interactive) and `claude -p` one-liner
(unattended overnight run).
