# Marky Mark

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/jorgeper/marky-mark?include_prereleases&label=release)](https://github.com/jorgeper/marky-mark/releases/latest)

A lightweight, fast, themeable markdown viewer for **macOS, Windows, and the
web**. Double-click a `.md` file to read it. Press ⌘E (Ctrl+E) to edit it.
Select text to comment on it.

> **⚠️ Alpha** — Marky Mark is pre-release software (`0.2.0-alpha.1`).
> Builds are unsigned, formats may still shift, expect rough edges.

## Download

Grab the [**latest release**](https://github.com/jorgeper/marky-mark/releases/latest)
(currently a **pre-release** — while Marky Mark is in alpha, every build is
flagged pre-release on GitHub, and the latest-release link lands on the
releases page with the newest alpha at the top):

| Platform | File | Note |
| --- | --- | --- |
| **macOS** (Intel + Apple Silicon) | `Marky Mark_<version>_universal.dmg` | Unsigned — after the "Not Opened" dialog: System Settings → Privacy & Security → **Open Anyway**, or `xattr -dr com.apple.quarantine "/Applications/Marky Mark.app"` |
| **Windows** (x64) | `Marky Mark_<version>_x64-setup.exe` | Unsigned — SmartScreen → More info → Run anyway |
| **Web** (any platform) | `marky-mark-web-<version>.html` | The whole app in one file: download and open, or host anywhere static |

Verify downloads against `SHA256SUMS.txt`. All versions:
[releases](https://github.com/jorgeper/marky-mark/releases).

## What you get

- **Instant, tiny, native** — a ~6 MB Tauri 2 app on a native webview. No
  Electron. Or the single self-contained HTML file — no install at all.
- **27+ built-in themes** (Crisp, Claude, Monokai, Dracula, Nord, Solarized,
  One Dark, …) and drop-in custom themes — one CSS file, no build step. See
  [THEMES.md](THEMES.md) for making your own.
- **Edit mode** — full-screen swap or side-by-side split (⌘E / Ctrl+E,
  remappable), with undo history that survives mode switches.
- **Comments** (experimental) — select text → 💬. Threads, resolve, reopen,
  edit-survival re-anchoring. Stored in a `foo.md.comments.json` sidecar or
  embedded invisibly in the markdown file itself — your pick.
- **Private by design** — no server, no telemetry, no network. Your files
  stay files.

## For developers

Want to build from source, run the test suite, or contribute? Start with
[CONTRIBUTING.md](CONTRIBUTING.md). The design docs live in
[docs/](docs/) — [architecture](docs/ARCHITECTURE.md), the
[delta specs](docs/specs/) that drove each milestone, and the
[release process](docs/RELEASING.md).

## License

[MIT](LICENSE) © 2026 Jorge Pereira. Bundled third-party packages:
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
