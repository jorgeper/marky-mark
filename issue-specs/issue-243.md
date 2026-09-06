# Spec: Home page: logo-only welcome screen, hide irrelevant toolbar buttons (#243)

## Goal

All acceptance criteria in issue-specs/issue-243.md are satisfied for issue
#243, with evidence visible in the session: on the hosted (cloud) build only,
the pre-file welcome screen renders the app badge and the start actions with
no version, alpha-notice, developer/license or repo-link text; the toolbar's
`edit-toggle` is absent on that home page and returns once a file is open;
desktop, the dev shim and the static web build keep today's splash text and
toolbar behaviour byte-for-byte; `npm run validate:quick` passes in the
implementer's session; and a summary comment from the implementer exists on
issue #243.

## Acceptance criteria

- **Hosted welcome screen is logo-only.** In the splash block of
  `src/App.tsx` (`data-testid="empty-hint"`, ~line 7852 — the
  `!docPath && !untitled && appMode !== 'workspace'` branch), the four text
  paragraphs are rendered only when the build is NOT hosted:
  `<p className="splash-version">v{__APP_VERSION__}</p>`, the
  `.splash-alpha` alpha notice, the `.splash-meta` "Developer: Jorge Pereira ·
  MIT License" line, and the `.splash-meta` paragraph holding the
  `github.com/jorgeper/marky-mark` link. On hosted the block renders the
  `splash-mark` / `splash-badge` app badge and then `<StartPage …>`, nothing
  between them.
- **The start actions are untouched.** `src/components/StartPage.tsx` is not
  modified: the `start-drop` "Drop a file to open" hint, the `start-<id>`
  action buttons (Open File…, New Workspace, Open Workspace, and the
  `start-management` row when the session is an admin) and the PRD 017 Req 10
  refusal hints all render on hosted exactly as they do today. The issue's
  "keep only the logo" wording is read as removing the About-information
  paragraphs above the actions, not the action list itself, which the issue
  explicitly says stays as it is.
- **The toolbar's Edit button is hidden — not disabled — on the hosted home
  page.** With the hosted build showing the splash (no document and no
  untitled buffer), `getByTestId('edit-toggle')` has count 0; with a document
  open it renders and toggles edit/preview exactly as today. The button is
  removed from the DOM, never rendered with a `disabled` attribute or a
  greyed class. Implementation note: `src/components/Toolbar.tsx` renders it
  behind `canEdit` (`p.canEdit !== false`), and `src/App.tsx` passes
  `canEdit={docGrants.edit}` at the `<Toolbar …>` call site (~line 7570) —
  `docGrants` is `ALL_FILE_GRANTS` (edit: true) on the splash today, which is
  why the button currently shows there. The gate may live in either file; the
  PRD 007 Req 17 read-only meaning of `canEdit` must not be muddied — if the
  new condition rides `canEdit`, its JSDoc says so.
- **Nothing else in the toolbar or the edge cluster changes.** `menu-btn`,
  the app menu and its View ▸ flyout, `docname` and the dirty dot render on
  the hosted home page as they do today; the show/hide-comments toolbar
  button stays gone (issue #256, already landed); the edge-cluster buttons
  (`ModeSwitchButton`, `PreviewToggleButton`, `CommentsToggleButton`,
  `SyncScrollButton`, the copy-link buttons) keep their existing gates —
  they are already absent on the splash and no new condition is added to
  them.
- **Build applicability is hosted-only and expressed once.** The branch is a
  single named boolean derived from `platform.kind === 'hosted'` — the
  existing precedent at `src/App.tsx:7477` (`hostedWorkspace`) — or from
  `detectHostedMode(document)` in `src/lib/hostedGate.ts`, not a scattered
  inline test. It carries a comment saying this is the owner's 2026-09-05
  build-applicability decision (a deliberate flavor branch, unlike the
  capability-first default the `Platform` doc comment in
  `src/platform/types.ts` states) plus its spec citation per
  `.sandcastle/CODING_STANDARDS.md`.
- **Desktop, shim and static web are unchanged.** E87
  (`tests/e2e/shell-and-menus.spec.ts:712`) still asserts the version, alpha
  notice, developer + MIT License, repo link and drop hint on the shim splash
  and still passes unedited; E78 (`tests/e2e/documents.spec.ts:90`) and every
  other `empty-hint` assertion in the desktop-shim and web suites pass
  unedited. No existing test is weakened, renumbered, skipped or deleted.
- **New hosted e2e coverage exists**, in `tests/e2e/hosted.spec.ts`, using the
  next unused ids (E494 onward — E493 is the highest in the suite today):
  after signing in as a seeded mock user and landing on the splash, the test
  asserts `splash-badge` and `start-actions` are visible, that `empty-hint`
  does not contain `v<pkg.version>`, "Alpha — pre-release software",
  "Developer: Jorge Pereira", "MIT License" or "github.com/jorgeper", and
  that `edit-toggle` has count 0; then it opens a workspace file and asserts
  `edit-toggle` is visible and still toggles edit/preview. Titles start with
  the `E<n>:` id per the testing rules.
- **E390/E391 still pass unedited.** Removing the paragraphs below the badge
  must not move it: `.splash` is top-anchored on `--mm-splash-top`
  (`src/styles.css:1423`), so the sign-in, "Checking session…" and splash
  badge boxes must stay within E391's ½px tolerance. If any CSS change is
  needed, it is scoped so the desktop splash's layout is identical to today.
- **Unit coverage where it applies.** If the work adds or changes a pure
  module under `src/lib/`, it gets matching coverage in
  `tests/unit/<kebab-case-module>.test.ts` with the next unused `U<n>:` ids
  (U1187 onward). If the change is confined to `src/App.tsx` /
  `src/components/`, the hosted e2e above is the proof and no unit test is
  invented.
- **The spec documents are amended, not rewritten**, in this repo's existing
  style (`> **Amendment (issue #243, 2026-09-06):** …`):
  `docs/specs/SPEC27.md` §3 (the splash's About-information bullets and
  item 2's "Identical on desktop, dev shim, and web" claim now carve out the
  hosted build) and `docs/specs/SPEC2.md` §4.1 (the toolbar composition:
  the Edit/Preview toggle is absent on the hosted home page). Each amendment
  names the hosted-only scope and says desktop is unchanged.
- **`docs/MAP.md` is regenerated** with `npm run map` and committed if any
  `SPEC<n>` citation was added, moved or removed in `src/` or `tests/e2e/`
  (the quick gate diffs it and fails otherwise).
- **Test economy.** The implementer iterates with `npm run typecheck` and
  `npm run test:unit` (or a targeted `npx playwright test -g '<title>'` for
  the new hosted test), baselines with the quick tier only, and runs the full
  gate ONCE at the end — not after every small change.
- **`npm run validate:quick` has been run in the implementer's session and
  passes**, printing `QUICK VALIDATION: ALL PASSED`.
- **A summary comment from the implementer exists on issue #243**, naming
  what changed, the new test ids, and the validate:quick result.

## Context

The home page is the preview empty state in `src/App.tsx` — the
`!docPath && !untitled && appMode !== 'workspace'` branch around line 7852,
`data-testid="empty-hint"`, holding `AppBadge` (`splash-badge`), four text
paragraphs and `<StartPage>`. Its contract is `docs/specs/SPEC27.md` §3
(FR-SPLASH); the CSS is `src/styles.css` `.splash*` from line 1423, anchored
via `--mm-splash-top` (line 46).

The toolbar is `src/components/Toolbar.tsx` — since issue #256 it is
hamburger · docname · Edit/Preview only, so this issue's "hide the irrelevant
buttons" work reduces to the `edit-toggle`. `src/App.tsx:4881`
(`mayToggleMode = docOpen && docGrants.edit`) already gates the edge-cluster
mode switch on an open document; the toolbar button does not, which is the
gap. `dispatchCommand('toggleMode')` is already a no-op on the splash
(`src/App.tsx:3794`), so hiding the button removes an inert affordance and
changes no behaviour.

Flavor detection: `Platform.kind` (`src/platform/types.ts:35`) is
`'tauri' | 'browser' | 'web' | 'hosted'`; `src/App.tsx:7477` already branches
on `platform.kind === 'hosted'`. `detectHostedMode(document)` in
`src/lib/hostedGate.ts` is the underlying marker test used by
`src/platform/index.ts` and `src/main.tsx`.

Hosted e2e lives in `tests/e2e/hosted.spec.ts` and runs against the real
local server (Azurite + mock auth) that `playwright.config.ts` boots on
:4924; `signIn`, `createWorkspace` and the helpers in `tests/e2e/helpers.ts`
(`revealToolbar`, `landInPreview`) are the existing setup. E166 (line 253)
is the shortest example of reaching the hosted splash. The desktop-shim
splash test is E87 in `tests/e2e/shell-and-menus.spec.ts:712`.

Read `.sandcastle/CODING_STANDARDS.md` before writing code — citation
comments, test-id discipline, the `E<n>:`/`U<n>:` numbering rules and the
style lint the quick gate enforces.
