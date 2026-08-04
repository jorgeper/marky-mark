# Spec: Live preview wiring: experimental settings toggle, theming, and feature compatibility (#50)

## Goal

All acceptance criteria in issue-specs/issue-50.md are satisfied for issue
#50, with evidence visible in the session: the live-preview extension
(#47–#49) is reachable in the shipped app through a persisted
"Live preview (experimental)" settings toggle that is off by default; with
the toggle off the edit pane behaves exactly as today and the pre-existing
e2e suite passes unchanged; with it on, live-preview styling rides the
current theme's tokens in both light and dark themes, the edit-adjacent
features (split view + scroll sync, mirrored selection, vim nav, comments,
find) keep working with e2e coverage, and the SPEC23 markdown-highlighting
setting is superseded while revealed raw lines keep the existing highlight
styling; `npm run validate:quick` passes in the implementer's session and a
summary comment from the implementer exists on issue #50.

## Acceptance criteria

- (PRD 006 §1) The Settings window's Editor tab has a
  "Live preview (experimental)" toggle, **off by default**, persisted as a
  new key on the `Settings` interface in `src/lib/settings.ts` alongside
  the other editor settings — which means a `DEFAULT_SETTINGS` entry and a
  scope tag in the exhaustive `SETTINGS_SCOPES` record (`U`, like the other
  editor toggles such as `editorSyntax`). The row has a `data-testid` so
  tests can reach it, and follows the existing checkbox-row + `scopeNote`
  pattern in `SettingsPanel.tsx`.
- (PRD 006 §1) Toggling the setting takes effect on the live editor without
  a remount — the extension rides a CodeMirror compartment reconfigured on
  setting change, the same pattern SPEC23's `editorSyntax` uses in
  `src/components/Editor.tsx`.
- The Editor wiring passes `platform.openExternal` as the
  `LivePreviewOptions.openExternal` hand-off, so cmd/ctrl-click on a
  rendered link opens the URL the same way the preview pane does (#48
  behaviour, previously inert for lack of a host).
- (PRD 006 §2) With the toggle off — the default — the edit pane behaves
  exactly as it does today, including the SPEC23 markdown-highlighting
  setting. All pre-existing e2e tests pass **unchanged** (no edits to
  existing tests to accommodate this issue) as part of `validate:quick`.
- (PRD 006 §10) Live-preview styling uses the current theme's tokens: the
  `mm-lp-*` styling resolves colors from the `--mm-*` variables the themes
  define (e.g. `--mm-heading`, `--mm-link`, `--mm-accent`, `--mm-code-bg`
  / `--mm-code-fg`, `--mm-blockquote-border` / `--mm-blockquote-fg`,
  `--mm-hr`) rather than hardcoded colors, so rendered constructs match
  the preview pane's look in both a light and a dark theme. At least one
  test proves theme-following (e.g. switch themes and assert a rendered
  construct's computed color changes / matches the token).
- (PRD 006 §11) With the toggle on, the edit-adjacent features keep
  working, each with e2e coverage in the toggled-on state: split view and
  its scroll sync, mirrored selection, vim nav, comments, and find. Any
  interaction broken by live preview is a bug to fix in this issue, not a
  documented limitation.
- (PRD 006 §12) While live preview is on, the SPEC23 markdown-highlighting
  setting is superseded: flipping `editorSyntax` has no additional visible
  effect, and revealed (raw) lines use the existing highlight styling
  (the `mm-md-*` classes) regardless of the `editorSyntax` value. Covered
  by a test.
- Stale comments updated: notes in `src/components/livePreview.ts` /
  `src/lib/livePreview.ts` saying the extension is unreferenced by the
  shipped app ("the app as shipped never does", "the settings toggle and
  Editor wiring land in #50") no longer claim that once this lands.
- New e2e tests live in `tests/e2e/` (a new `live-preview.spec.ts` or the
  fitting existing suite), titled `E<n>:` using the next unused numbers
  (E141 is the highest today); any new pure logic gets unit tests in
  `tests/unit/` titled `U<n>:` (U191 is the highest today). New behaviour
  carries citation comments (`// PRD 006 §<n>: …`) per
  `.sandcastle/CODING_STANDARDS.md`; no `console.*` in `src/`.
- `docs/MAP.md` is regenerated (`npm run map`) if the spec→code table
  changed — the validation gate diffs it.
- Iteration used `npm run typecheck` and `npm run test:unit` (or tests
  targeted at the changed code — one e2e at a time via
  `npx playwright test -g '<title>'`) after each change; the full gate
  `npm run validate:quick` was run ONCE, right before declaring the goal
  met — not after every small change and not as a starting baseline.
- `npm run validate:quick` passes in the implementer's session, printing
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #50.

## Context

Parent #41 / `prd/006-live-preview.md` (reqs 1, 2, 10–12); blockers
#47–#49 are all merged, so the extension is complete and this issue is
pure wiring. `livePreviewExtension(options)` in
`src/components/livePreview.ts` is the factory; its `openExternal` option
expects `platform.openExternal` (see `src/platform/types.ts` and existing
App.tsx hand-offs). Styling currently sits in an `EditorView.baseTheme`
block in that file — links/quotes/rules already reference `--mm-*` tokens
with fallbacks, but headings/bold/etc. may need token alignment for §10;
`src/styles.css` has the `mm-md-*` precedent around line 676. Settings
plumbing: `src/lib/settings.ts` (`Settings`, `DEFAULT_SETTINGS`,
`SETTINGS_SCOPES` — exhaustive record, typecheck fails until the new key
gets a scope) and `src/components/SettingsPanel.tsx` (`editorTab`,
~line 681, shows the row pattern). Editor wiring: grep `SPEC23` in
`src/components/Editor.tsx` (~1500 lines — don't read whole) for the
compartment-per-setting pattern; `App.tsx` passes `syntax=` at ~4305 and
4378 — never read `App.tsx` end-to-end, citation-grep instead. E2e shared
setup is `tests/e2e/helpers.ts` / `fixtures.ts`; unit tests run with
`pool: 'threads'`, `isolate: false` — restore any global state touched.
