# editor/AGENTS.md — the @marky-mark/editor package

This directory is `@marky-mark/editor` (PRD 021): Marky Mark's embeddable
markdown editor + preview + split view, a self-contained workspace package
any React app can consume. The app is one consumer of it, not its owner.

Directives for any agent working in here:

- **Never import app code.** No module under `editor/` — source, test, or
  config — imports from `src/`, `server/`, or `src-tauri/`, whether by a
  relative path escaping the package (`../../src/...`) or by any alias
  resolving there.
- **App-flavored needs become seams, never reverse imports.** If the
  editor needs something only Marky Mark can provide (file access, app
  settings, comment marks), add a prop or extension seam to the package
  API and let the app pass it in.
- **Self-contained.** The package's styles, tests (`editor/tests/`, IDs on
  the repo-wide `U<n>` register), and docs live in-package; consumers
  reach it only through the entry points `editor/package.json` `exports`
  declares (`@marky-mark/editor` plus its exported subpaths, e.g.
  `@marky-mark/editor/styles.css` — other deep paths are sealed).
- **The gate enforces all of this.** The editor-package-boundary check in
  `scripts/validate.mjs` (quick tier; logic in
  `scripts/editor-boundary.mjs`) fails validation on any violation, in
  either direction.
