# Spec: Platform boundary: desktop-only workspace features & web resolver parity (#18)

## Goal

All acceptance criteria in specs/issue-18.md are satisfied for issue #18, with
evidence visible in the session: the production web build (`platform.kind ===
'web'`, dist-web) exposes no workspace features — no folder sidebar or folder
affordances, no workspace File-menu flows or reachable workspace commands, no
Workspace settings tab or scope selector — while all of them remain intact on
desktop; the same `resolveSettings` resolver runs on both platforms and on web
the effective config resolves from Global < Team < User (no Workspace layer),
pinned by unit tests and a web e2e test against the built web artifact; `npm
run build:web` followed by `npm run test:e2e:web` passes; `npm run
validate:quick` passes in the implementer's session; and a summary comment
from the implementer exists on issue #18.

## Acceptance criteria

- **§H25 — no workspace UI on web.** With the real web platform
  (`src/platform/web.ts`, `kind: 'web'` — not the dev/e2e `browser` shim,
  which intentionally implements desktop capabilities):
  - The folder sidebar never renders (today gated on
    `platform.readDirEntries && platform.openFolderDialog` in `src/App.tsx`;
    `web.ts` leaves both undefined — this gate must hold).
  - The workspace commands (`openFolder`, `openWorkspace`,
    `addFolderToWorkspace`, `saveWorkspaceAs`, `closeWorkspace`) are no-ops
    or unreachable on web, including via hotkeys — the existing capability
    guards in their handlers must hold, and `closeWorkspaceCmd` (which has no
    dialog to guard on) must also be inert on web.
  - The Settings UI shows no User | Workspace scope selector and no
    Workspace tab (today `scopeSelector={platform.kind !== 'web'}` in
    `src/App.tsx` — must hold).
  - No workspace or session stores are written on web: nothing under
    `<configDir>/session/` (pointer, untitled slot, per-workspace session
    files), no `.marky-workspace` writes, no `recent-workspaces.json` writes.
  - Any gap the audit finds in the above is fixed; where the boundary is
    already correct, no gratuitous rewrite — tests pin it instead.
- **§H26 — resolver parity.** The web code path calls the exact same
  `resolveSettings` (`src/lib/settings.ts`) as desktop — no web-specific
  resolver fork exists. Unit tests (extend
  `tests/unit/settings-resolver.test.ts` or a sibling) pin the web shape —
  resolution with the `workspace` layer absent:
  - effective values follow Global < Team < User precedence for U-scoped
    keys (User wins over Team wins over Global);
  - a W-scoped key (e.g. `commentStorage`) with no workspace layer falls
    through its remaining candidate layers to the default, and a User-layer
    value for it still does not win (scope rules unchanged);
  - `winningLayer` never reports `'workspace'` when the workspace layer is
    absent.
- **Web e2e coverage.** A new W-numbered test in `tests/e2e/web.spec.ts`
  (runs against the built dist-web artifact via `npm run test:e2e:web`)
  asserts the §H25 surface: no folder sidebar / folders affordance in the
  DOM, and the Settings panel opens with no scope selector or Workspace tab.
- **Desktop unchanged.** All workspace features keep working on desktop and
  under the `browser` shim: the existing unit and desktop-shim e2e suites
  pass unmodified except where a test itself pins the new boundary.
- **Verification (run each ONCE, in this order, right before declaring the
  goal met — not after every small change):** `npm run build:web` then
  `npm run test:e2e:web` pass, and `npm run validate:quick` passes, all in
  the implementer's session. While iterating, use `npm run typecheck` and
  `npm run test:unit` (or targeted vitest runs) only; baseline an attempt
  with the quick tier only, never the full gate.
- A summary comment from the implementer exists on issue #18.

## Context

PRD: `prd/002-workspaces-and-layered-configuration.md` §H25–§H26 (also §61,
§76 for the web non-goal). Parent: #13; builds on #15 (workspace model), #16
(menu/sidebar flows), #17 (Settings scope tabs) — all already merged on this
lineage. The platform seam is `src/platform/index.ts` + `types.ts`: `tauri`
(desktop), `browser` (dev/e2e shim — counts as desktop-capable), `web`
(production single-file build; leaves `readDirEntries`, `openFolderDialog`,
`openWorkspaceDialog` undefined). Most gating already exists in `src/App.tsx`
(sidebar render gate ~line 3694, session-store gate ~line 989, boot workspace
load gate ~line 1674, command guards ~lines 2027–2154, settings scope gate
~line 4047); the work is auditing that boundary, fixing any leaks (note
`closeWorkspace` lacks a capability guard), and pinning it with the unit and
web-e2e tests above. Web has no native menu and the in-app `Toolbar` carries
no workspace items — keep it that way. `npm run validate:quick` does NOT run
web e2e, which is why the explicit `build:web` + `test:e2e:web` pass is its
own criterion.
