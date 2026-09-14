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

## Agent-bridge seams (PRD 027 Req 12/13, issue #366)

The app's agent bridge (`src/lib/agentBridgeClient.ts`) drives the editor
ONLY through these public handle methods — never CodeMirror internals,
never `insertRef`. Each is an adapter over `src/components/bridgeEdits.ts`
(unit-tested in `tests/bridge-edits.test.ts`) or the canonical view:

- `SmartEditHandle.replaceRange(from, to, text)` — CANONICAL offsets,
  clamped into the document; ONE transaction annotated
  `isolateHistory.of('full')` (a single undo unit, never merged with the
  user's typing); the caret lands after the inserted text; no focus steal.
- `SmartEditHandle.documentText()` — the live CANONICAL document, read
  synchronously off the view (the host's React buffer lags a dispatch).
- `SmartEditHandle.applyFormat(op)` — the existing Smart Edit formatting
  seam; one undo step per call (`applySplice`), post-format selection kept.
- `EditorSyncHandle.viewportLines()` — whole lines the viewport shows, at
  least 1; the page unit for scroll-by-pages. `topLine()` / `scrollToLine`
  stay CANONICAL and scroll-only (the caret never moves).
- `SelectSourceRange` — canonical, no focus; `{ reveal: true }` scrolls the
  range into view.
