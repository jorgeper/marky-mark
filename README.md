# Marky Mark

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/jorgeper/marky-mark?include_prereleases&label=release)](https://github.com/jorgeper/marky-mark/releases/latest)

A lightweight, fast, themeable markdown viewer for **macOS, Windows, and the
web**. Double-click a `.md` file to read it. Press ⌘E (Ctrl+E) to edit it.
Select text to comment on it.

> **⚠️ Alpha** — Marky Mark is pre-release software (`0.2.0-alpha.1`).
> Builds are unsigned, formats may still shift, expect rough edges.

- **Tauri 2** shell — ~6 MB app, native webview, instant launch. No Electron.
  Plus a **single self-contained HTML file** you can host on any static site:
  open files with the picker or drag-and-drop.
- **27+ built-in themes** (Crisp, Claude, Monokai, Dracula, Nord, Solarized,
  One Dark, …) and drop-in custom themes: one CSS file in
  `~/Library/Application Support/com.markimark.app/themes/` (☰ → Settings →
  Reload themes; *Import theme…* on web). See [THEMES.md](THEMES.md).
- **Edit mode**: full-screen swap or side-by-side split (⌘E, remappable).
- **Comments** (experimental): select text → 💬. Threads, resolve, orphaning.
  Stored as a `foo.md.comments.json` sidecar (format-compatible with the
  `md-with-comments` project) **or embedded invisibly inside the markdown
  file** — pick in Settings.

## Download

Grab the [**latest release**](https://github.com/jorgeper/marky-mark/releases/latest):

- **macOS** (Intel + Apple Silicon): `Marky Mark_<version>_universal.dmg` —
  unsigned: right-click → Open the first time, or
  `xattr -dc "/Applications/Marky Mark.app"`.
- **Windows** (x64): `Marky Mark_<version>_x64-setup.exe` — unsigned:
  SmartScreen → More info → Run anyway.
- **Web** (any platform): `marky-mark-web-<version>.html` — the whole app in
  one file. Download and open it, or host it anywhere static.

Verify downloads against `SHA256SUMS.txt`. All versions:
[releases](https://github.com/jorgeper/marky-mark/releases). How releases are
cut: [RELEASING.md](RELEASING.md).

## Building from source

```bash
npm install
npm run dev          # browser shim (virtual fs) at localhost:1420
npm run tauri dev    # the real desktop app
npm run validate     # version lock-step + typecheck + unit + desktop/web e2e + cargo check + single-file check
npm run tauri build  # packaged .app / .dmg
npm run build:web    # single-file web app → dist-web/index.html
npm run licenses     # regenerate THIRD-PARTY-NOTICES.md (allowlist-guarded)
```

Requires Node 20+ and Rust (stable). Windows builds: natively via
`.github/workflows/release.yml`, or cross-compiled from macOS — see
[WINDOWS.md](WINDOWS.md).

## Docs

[ARCHITECTURE.md](ARCHITECTURE.md) · [SPEC.md](SPEC.md) (+ delta specs
SPEC2–SPEC10) · [THEMES.md](THEMES.md) · [WINDOWS.md](WINDOWS.md) ·
[RELEASING.md](RELEASING.md)

## License

[MIT](LICENSE) © 2026 Jorge Pereira. Bundled third-party packages:
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
