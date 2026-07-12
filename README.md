# Marky Mark

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/jorgeper/marky-mark?include_prereleases&label=release)](https://github.com/jorgeper/marky-mark/releases/latest)

A lightweight, fast, themeable markdown viewer for **macOS, Windows, and the
web**. Double-click a `.md` file to read it. Press ⌘E (Ctrl+E) to edit it.
Select text to comment on it.

<p align="center">
  <a href="docs/screenshots/hero.png"><img
    src="docs/screenshots/hero.png"
    alt="Marky Mark in four of its themes — reading mode in Vaporwave, margin comments in Crisp Mono, the editor in Phosphor, and side-by-side edit in Claude"></a>
</p>

> **⚠️ Alpha** — Marky Mark is pre-release software (`0.2.0-alpha.1`).
> Builds are unsigned, formats may still shift, expect rough edges.

## Download

Grab the [**latest release**](https://github.com/jorgeper/marky-mark/releases/latest)
(currently a **pre-release** — while Marky Mark is in alpha, every build is
flagged pre-release on GitHub, and the latest-release link lands on the
releases page with the newest alpha at the top):

| Platform | File | Note |
| --- | --- | --- |
| **macOS** (Intel + Apple Silicon) | `Marky Mark_<version>_universal.dmg` | Unsigned — see [First launch on macOS](#first-launch-on-macos) |
| **Windows** (x64) | `Marky Mark_<version>_x64-setup.exe` | Unsigned — SmartScreen → **More info** → **Run anyway** |
| **Web** (any platform) | `marky-mark-web-<version>.html` | The whole app in one file: download and open, or host anywhere static |

Verify downloads against `SHA256SUMS.txt`. All versions:
[releases](https://github.com/jorgeper/marky-mark/releases).

### First launch on macOS

Alpha builds aren't signed or notarized yet, so the first open is blocked
with *“Apple could not verify 'Marky Mark' is free of malware.”* Click
**Done** (not Move to Trash!), then:

**System Settings → Privacy & Security → scroll down to
*“Marky Mark” was blocked…* → Open Anyway.**

Terminal alternative:

```bash
xattr -dr com.apple.quarantine "/Applications/Marky Mark.app"
```

Either way it's a one-time step — the app opens normally afterwards.

## What you get

- **Instant, tiny, native** — a ~6 MB Tauri 2 app on a native webview. No
  Electron. Or the single self-contained HTML file — no install at all.
- **Export & Print** — File → Export… writes a beautiful fully static
  HTML reading page: your themed document with comments as numbered notes,
  zero scripts, opens anywhere — with or without comments and word counts,
  in the theme of your choice (the app remembers it). File → Print… (⌘P)
  prints the document natively — and the print dialog does PDF.
- **A real desktop citizen** — native menus (macOS menu bar / Windows menu
  bar), a chromeless window with no in-app toolbar, and real Settings (⌘,)
  and About windows — not in-page pop-overs.
- **27+ built-in themes** (Crisp, Claude, Monokai, Dracula, Nord, Solarized,
  One Dark, …) and drop-in custom themes — one CSS file, no build step. See
  [THEMES.md](THEMES.md) for making your own.
- **Edit mode** — full-screen swap or side-by-side split (⌘E and ⌘\ /
  Ctrl+E and Ctrl+\, remappable; split also lives in the View menu) with
  synchronized scrolling between the panes, a
  changes-since-save view that tints edited lines, and undo history that
  survives mode switches. File → New (⌘N) opens a fresh untitled buffer —
  you pick where it lives on first save. Your selection survives switching
  between edit and preview, in both layouts. Markdown syntax highlighting in
  the editor (theme-driven, toggleable), select in either split pane to
  see the same text selected in the other, and — with Vim navigation on —
  Esc puts the editor in a navigation-only vim mode (h/j/k/l, w/b, 0/$,
  gg/G, Ctrl+d/u; i to type again). ⌘F finds in both modes — live
  highlighted matches in preview, find & replace in the editor.
- **Never lose work** — dirty buffers shadow-save continuously; after a
  crash or force-quit the next launch offers to restore your unsaved
  changes, untitled buffers included.
- **Front matter, handled** — YAML front matter never renders as broken
  markdown; it shows as a quiet metadata card you can dismiss (✕ or View →
  Front Matter), with a setting for the default.
- **Creature comforts** — launching the app reopens your last document
  right where you left off (toggleable), File → Open Recent remembers
  your last ten documents, ⌘K fuzzy-jumps to any heading, and a quiet
  word-count / reading-time chip keeps score (selection-aware).
- **Images that just work** — paste a screenshot straight into edit mode and
  it lands as a real file in an `images/` folder next to your document
  (folder and naming pattern configurable); click an image in preview and
  drag the corner handles to resize — persisted as portable HTML that GitHub
  renders too.
- **Comments** (experimental) — select text → 💬. Threads, resolve, reopen,
  edit-survival re-anchoring. Jump between comments with ⌥⌘↓ / ⌥⌘↑
  (rebindable) or the fixed navigator pill — park the mouse and click
  through. Stored in a `foo.md.comments.json` sidecar or embedded invisibly
  in the markdown file itself — your pick.
- **Private by design** — no server, no telemetry: the document viewer
  makes **no outbound network requests, guaranteed** — remote images and
  theme imports are blocked at render time, a strict CSP backstops
  everything, and CI proves it with adversarial tests. The *only* network
  the app ever performs is the **update check you explicitly trigger**
  (Check for Updates…): a Rust-side, signature-verified request to this
  repo's GitHub Releases — nothing automatic, nothing else, ever. See the
  [security assessment](docs/security/assessment.md). Your files stay files.
- **Updates, on your terms** — Check for Updates… (in the app menu) checks
  GitHub Releases and installs the new version in one click, verified
  against the app's built-in signing key. Strictly manual — the app never
  phones home on its own.

## Uninstalling

- **macOS** — drag `Marky Mark.app` from Applications to the Trash; that's
  the whole uninstall. If you also want zero traces (settings, themes,
  reading positions, webview caches — a few KB unless you added custom
  themes), run:

  ```bash
  rm -rf ~/Library/Application\ Support/io.jorgepereira.markymark.app \
         ~/Library/Preferences/io.jorgepereira.markymark.app.plist \
         ~/Library/WebKit/io.jorgepereira.markymark.app \
         ~/Library/Caches/io.jorgepereira.markymark.app \
         ~/Library/HTTPStorages/io.jorgepereira.markymark.app \
         ~/Library/Saved\ Application\ State/io.jorgepereira.markymark.app.savedState
  ```

- **Windows** — Settings → Apps → Marky Mark → Uninstall (the standard
  Add/Remove Programs entry the installer registers).
- **Web** — it's one file; delete it. Settings live in your browser's
  localStorage for the page and vanish with normal site-data clearing.

## For developers

Want to build from source, run the test suite, or contribute? Start with
[CONTRIBUTING.md](CONTRIBUTING.md). The design docs live in
[docs/](docs/) — [architecture](docs/ARCHITECTURE.md), the
[delta specs](docs/specs/) that drove each milestone, and the
[release process](docs/RELEASING.md).

## License

[MIT](LICENSE) © 2026 Jorge Pereira. Bundled third-party packages:
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
