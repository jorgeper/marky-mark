# Marky Mark

A lightweight, fast, themeable markdown viewer for **macOS, Windows, and the
web**. Double-click a `.md` file to read it. Press ⌘E (Ctrl+E) to edit it.
Select text to comment on it.

- **Tauri 2** shell — ~6 MB app, native webview, instant launch. No Electron.
  Plus a **single self-contained HTML file** (`dist-web/index.html`) you can
  host on any static site: open files with the picker or drag-and-drop.
- **Seven built-in themes** (Crisp, Claude, Monokai, Dracula, Nord, Solarized
  Light, One Dark) and drop-in custom themes: one CSS file in
  `~/Library/Application Support/com.markimark.app/themes/` (☰ → Settings →
  Reload themes; *Import theme…* on web). See [THEMES.md](THEMES.md).
- **Edit mode** is a full-screen swap (⌘E, remappable in Settings), not a split view.
- **Comments** (experimental): select text → 💬. Threads, resolve, orphaning.
  Stored as a `foo.md.comments.json` sidecar (format-compatible with the
  `md-with-comments` project) **or embedded invisibly inside the markdown
  file** — pick in Settings.

## Develop

```bash
npm install
npm run dev          # browser shim (virtual fs) at localhost:1420
npm run tauri dev    # the real desktop app
npm run validate     # typecheck + unit + desktop/web e2e + cargo check + single-file check
npm run tauri build  # packaged .app / .dmg
npm run build:web    # single-file web app → dist-web/index.html
```

Windows: built by `.github/workflows/release.yml` (or cross-compiled from
macOS — see [WINDOWS.md](WINDOWS.md)).

Docs: [SPEC.md](SPEC.md) · [ARCHITECTURE.md](ARCHITECTURE.md) ·
[THEMES.md](THEMES.md) · [WINDOWS.md](WINDOWS.md)
