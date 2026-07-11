# Contributing to Marky Mark

Thanks for your interest! This page is for developers — if you just want to
use the app, grab a build from the
[releases page](https://github.com/jorgeper/marky-mark/releases/latest).

## Setup

Prerequisites: **Node 20+**, **Rust (stable)** — plus the
[Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/)
for your OS.

```bash
git clone https://github.com/jorgeper/marky-mark.git
cd marky-mark
npm install
```

## Everyday commands

```bash
npm run dev          # browser shim (virtual fs, no Rust needed) at localhost:1420
npm run tauri dev    # the real desktop app
npm run validate     # THE gate: version lock-step + typecheck + unit + desktop/web e2e + cargo check + single-file check
npm run test:unit    # just the Vitest unit suite
npm run test:e2e     # just the desktop e2e suite (Playwright)
npm run tauri build  # packaged .app / .dmg
npm run build:web    # single-file web app → dist-web/index.html
npm run licenses     # regenerate THIRD-PARTY-NOTICES.md (allowlist-guarded)
```

### Testing the installed app (macOS)

`npm run tauri dev` is the fast loop — frontend edits hot-reload, Rust edits
rebuild and relaunch automatically. When you need to test the *installed*
app in `/Applications` (file associations, packaged behavior):

```bash
npm run build:app    # release .app only — skips the slow .dmg step
npm run install:app  # quit, replace /Applications/Marky Mark.app, relaunch
npm run clean:app    # wipe every trace (app, data, prefs, caches) for a true first run
```

## How this codebase works

- **Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.** The one rule
  that matters most: all filesystem/dialog/window access goes through the
  platform seam (`src/platform/`) — app code never assumes an OS or a host.
- The product is **spec-driven**: each milestone is a delta spec in
  [docs/specs/](docs/specs/) (SPEC.md through SPEC10.md, later wins on
  conflict). [docs/goals/](docs/goals/) records how each milestone was
  launched and verified.
- Tests carry stable IDs — **U**nit (U1–U16), desktop **E**2E (E1–E45), and
  **W**eb e2e (W1–W4) — that the specs reference. Numbers are never reused;
  E42–E44 are reserved for the pending SPEC8. Don't weaken, skip, or delete
  existing tests; new behavior gets new numbered tests.

## Pull requests

1. `npm run validate` must print `VALIDATION: ALL PASSED` — it's the same
   gate CI runs before any release build.
2. If you add or update a dependency, run `npm run licenses` and commit the
   regenerated `THIRD-PARTY-NOTICES.md` (the allowlist guard fails the build
   on copyleft/unknown licenses).
3. Keep the comment sidecar/trailer formats stable — they're interoperable
   with the sibling `md-with-comments` project.
4. Windows-specific work: see [docs/WINDOWS.md](docs/WINDOWS.md) (native and
   cross-compile paths).

## Themes

Themes are single CSS files with a small metadata header — no build step.
[THEMES.md](THEMES.md) documents the format and variables (it also ships
inside the app's config folder on first run).

## Releases (maintainers)

Tag-driven, always land as a draft: see [docs/RELEASING.md](docs/RELEASING.md).

## License

By contributing, you agree your contributions are licensed under the
[MIT License](LICENSE). The licensing decision record and dependency audit
live in [docs/license.md](docs/license.md).
