# SPEC2: Markimark v2 — three targets, simpler chrome, embedded comments

Delta spec on top of `SPEC.md` (v1, shipped: all of U1–U8 / E1–E12 green, packaged
macOS app). Where this file conflicts with SPEC.md, this file wins; everything else in
SPEC.md still holds and must not regress. This spec is written to be executed
autonomously by Claude Code using `/goal`. Read this whole file and SPEC.md before
writing code. The Definition of Done in §8 is the goal condition.

---

## 1. What v2 adds

1. **Windows build** of the same desktop app.
2. **Web app**: the same viewer as a **single self-contained HTML file** hostable on
   any static site.
3. **Simpler toolbar**: one overflow menu (Open / Save / Settings), theme picking moves
   into Settings, full-path tooltip on the filename.
4. **Comment storage choice**: sidecar file (as today) **or embedded invisibly inside
   the markdown file itself**.

## 2. Windows build (FR-W)

1. Primary path — cross-compile from this Mac (Tauri's experimental Windows-from-macOS
   support): `rustup target add x86_64-pc-windows-msvc`, `cargo install cargo-xwin`,
   `brew install nsis llvm`, then
   `npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis`.
   Success = an NSIS installer `.exe` under
   `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. The existing
   `bundle.fileAssociations` covers `.md` registration; CLI-arg open handling already
   exists in `lib.rs`.
2. **Regardless of whether 1 succeeds**, add `.github/workflows/release.yml` that
   builds and uploads macOS (`.dmg`) and Windows (NSIS) artifacts on real runners
   (`macos-latest`, `windows-latest`) using `tauri-apps/tauri-action` or plain
   `npm run tauri build`, triggered on tag push and manual dispatch.
3. If cross-compilation is genuinely infeasible on this machine (toolchain or SDK
   download failure after honest attempts), record the exact failure in `BLOCKERS.md`;
   the CI workflow then stands as the Windows deliverable. Do not fake an artifact.

## 3. Web app (FR-B)

1. New platform implementation `src/platform/web.ts` (fourth: tauri / browser-shim /
   web) selected when neither Tauri nor the e2e shim flag is present. The existing
   `browser.ts` shim remains exclusively for dev/e2e (select it via a
   `?shim=1` query param or `import.meta.env.DEV`; the production web bundle must
   default to `web.ts`).
2. **Open**: (a) the Open menu item uses the File System Access API
   (`showOpenFilePicker`) when available, falling back to a hidden
   `<input type="file" accept=".md,.markdown">`; (b) **drag-and-drop** of a file onto
   the page opens it (use `DataTransferItem.getAsFileSystemHandle()` when available so
   saving back works).
3. **Save**: writes back through the file handle (`createWritable`) when one exists;
   otherwise falls back to a download of the file (`<a download>`). `Cmd/Ctrl+S`, the
   Save menu item, and autosave-on-toggle all route through this.
4. **Comments on web are always embedded** (§5) — a static page cannot write a sidecar
   next to a file. The storage setting is hidden/locked to "embedded" on web, with a
   short note in the Settings panel.
5. Settings and the selected theme persist in `localStorage`. User themes on web:
   Settings gains an "Import theme…" action (file picker for a `.css`, stored in
   localStorage) — same parseTheme/rejection rules as desktop.
6. **Single file**: a separate build (`npm run build:web`, e.g. Vite +
   `vite-plugin-singlefile` with `inlineDynamicImports`) emits `dist-web/index.html`
   with **zero external requests**: no other files in `dist-web`, no
   `src=`/`href=` references to assets, everything (JS, CSS, themes, fixtures) inlined.
   Full-path tooltip shows just the file name on web (browsers don't expose paths).
7. No functionality regressions otherwise: themes, edit/preview swap, hotkeys,
   comments UX identical.

## 4. UI simplification (FR-U)

1. **Toolbar becomes**: filename (left, with dirty dot) · Edit/Preview toggle ·
   comments toggle · one **overflow menu button (⋯ or ☰) on the right** containing
   exactly: *Open…*, *Save*, *Settings…* (with hotkey hints). The 🎨 theme picker
   button and the separate Open/⚙ buttons are **removed** from the toolbar.
2. **Settings panel** gains the theme chooser as the primary control (the `<select>`
   already exists — keep it, listing built-ins and user themes) plus a
   **"Reload themes"** button (moved from the old picker) and (web only) "Import
   theme…". Everything else in Settings stays.
3. **Full path tooltip**: hovering the filename shows the document's full on-disk path
   (`title` attribute = absolute path; on web, the file name). Keep a
   `data-testid="docname"` with the `title` set for testing.
4. Existing e2e tests E2 and E3 must be **rewritten** (not deleted) to assert the same
   behaviors through the new UI: E2 = settings select lists the 7 built-ins, switching
   to Monokai changes the computed background, choice persists across reload; E3 =
   drop a user theme into the config themes dir → Reload themes (in Settings) → appears
   in the select and applies. This is the one sanctioned test modification; every other
   v1 test keeps passing unchanged.

## 5. Comment storage: sidecar or embedded (FR-C)

1. New setting `commentStorage: 'sidecar' | 'embedded'` (default `'sidecar'` on
   desktop; forced `'embedded'` on web), exposed in Settings as a two-option control.
2. **Embedded format** — a trailer at the very end of the markdown file inside an HTML
   comment, invisible in every renderer (Markimark strips/sanitizes HTML comments;
   GitHub etc. hide them too):

   ```
   <!-- markimark-comments
   {"version":1,"comments":[ …same schema as the sidecar… ]}
   -->
   ```

   Exactly one trailing block, separated from content by a blank line. The JSON
   `comments` array schema is identical to the sidecar's.
3. **`-->` hazard (must be handled)**: a comment body containing `-->` would terminate
   the HTML comment. When serializing the trailer, escape every `-->` inside the JSON
   as `-->` (valid JSON string escaping; `JSON.parse` restores it). A unit test
   must cover a body containing `-->`.
4. **Load**: parse and strip the trailer from the buffer before rendering/editing —
   the trailer never appears in preview or in the edit-mode buffer. Comments come from
   the trailer if present, else from the sidecar; if both exist, entries are merged by
   id with trailer entries winning.
5. **Save/autosave semantics**:
   - Sidecar mode: exactly as v1 (debounced sidecar writes; file saves write the plain
     buffer).
   - Embedded mode: saving the document writes buffer + trailer (omitted when there
     are no comments). Comment changes autosave (≤ 2 s debounce) by rewriting the file
     as *last-saved text + new trailer* — never flushing unsaved text edits.
   - Mode migration on the next write: switching to embedded deletes the sidecar after
     a successful embedded write; switching to sidecar strips the trailer from the file
     and writes the sidecar. No comment is ever lost in either direction.
6. Pure logic (`src/lib/embedded.ts` or similar): extract/strip/serialize trailer,
   byte-exact content preservation, the `-->` escape. Unit-tested without DOM.

## 6. Project structure additions

```
  SPEC2.md                 (this file — do not modify)
  vite.web.config.ts       (single-file web build → dist-web/index.html)
  .github/workflows/release.yml
  src/platform/web.ts
  src/lib/embedded.ts
  tests/e2e/web.spec.ts    (W-tests, run against the built dist-web page)
```

## 7. Validation harness (extends v1)

`npm run validate` becomes: typecheck → unit → e2e (desktop shim) → **web e2e** →
`cargo check` → **single-file check** → `VALIDATION: ALL PASSED`.

New unit tests (Vitest):
- **U9**: embedded trailer round-trip — serialize(comments)+parse yields identical
  comments, including a body containing `-->` (escape verified both directions).
- **U10**: extract/strip preserves the remaining markdown byte-exactly, and
  reattach(strip(x)) round-trips; a document with no trailer passes through untouched.
- **U11**: when both sidecar and trailer exist, merge-by-id with trailer precedence;
  migration helpers produce the right final state in both directions.

Rewritten (per FR-U.4): **E2**, **E3** through Settings.

New desktop-shim e2e:
- **E13**: toolbar has no theme/Open/⚙ buttons; the overflow menu opens with exactly
  Open…, Save, Settings…; Save from the menu persists a dirty buffer.
- **E14**: the filename element's `title` equals the document's full path.
- **E15**: switch to embedded in Settings → add a comment → (autosave) file on disk
  ends with the `markimark-comments` trailer and the sidecar is gone → reload →
  comment loads, and neither preview nor edit-mode buffer shows the trailer.
- **E16**: in embedded mode with unsaved text edits, a comment autosave does NOT write
  the unsaved text (disk text = last save), and a subsequent Cmd+S writes both.

Web e2e (`tests/e2e/web.spec.ts`, Playwright against a static server on `dist-web`,
with `showOpenFilePicker` deleted via `addInitScript` to exercise the fallback path):
- **W1**: the single HTML page loads with zero console errors and shows its
  empty/welcome state; a theme change via Settings applies and persists across reload
  (localStorage).
- **W2**: drag-and-drop of an in-page-constructed `.md` File opens and renders it.
- **W3**: open via the file-input fallback (Playwright `filechooser`), add a comment,
  Save → the downloaded file (captured via Playwright `download`) contains the
  embedded trailer; re-opening that file restores the comment.
- **W4**: the page made **zero network requests** after initial load (assert via
  Playwright request tracking) — proves self-containment at runtime.

Single-file check (script step): `dist-web/` contains only `index.html`;
`index.html` has no `src=`/`href=` pointing at local assets and no `http(s)://`
resource loads; print its byte size.

**Anti-gaming constraints (binding)**: same as SPEC.md §8 — no skipped/weakened
tests, no hardcoded outputs, blockers to `BLOCKERS.md`, SPEC.md/SPEC2.md and the goal
condition unmodified. E2/E3 rewrites must keep asserting the original behaviors.

## 8. Definition of Done (the /goal condition verifies exactly this)

All demonstrated in the transcript, in the completion turn:
1. `npm run validate` exits 0 with complete output — U1–U11, E1–E16, W1–W4, the
   single-file check, and final `VALIDATION: ALL PASSED` — printed.
2. macOS: `npm run tauri build` exits 0; `.app` path + size printed (< 25 MB).
3. Windows: EITHER the NSIS installer path + size under
   `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/` printed, OR
   `BLOCKERS.md` documents the honest cross-compile failure. In BOTH cases
   `.github/workflows/release.yml` exists and covers macOS + Windows.
4. Web: `ls dist-web/` shows exactly `index.html`; its size printed.
5. `grep -rn "\.skip\|\.only\|\.todo" tests/` prints nothing; SPEC.md and SPEC2.md
   unmodified (`git diff --stat SPEC.md SPEC2.md` empty).
6. `ARCHITECTURE.md` updated: web platform, embedded-comments format (including the
   `-->` escape), storage-mode migration, and the Windows build story.

## 9. Build order

1. `src/lib/embedded.ts` with U9–U11 first (TDD), then wire storage modes + migration
   into App (E15, E16).
2. Toolbar/Settings rework (E13, E14; rewrite E2, E3).
3. `web.ts` platform + `vite.web.config.ts` single-file build; W1–W4; extend
   `scripts/validate.mjs`.
4. Windows: CI workflow first (always ships), then attempt the cargo-xwin
   cross-compile; wire nothing about Windows into `validate` (it's a DoD artifact
   check, not a loop step).
5. Full `npm run validate` green, mac `tauri build`, Windows artifact attempt,
   ARCHITECTURE.md update.
