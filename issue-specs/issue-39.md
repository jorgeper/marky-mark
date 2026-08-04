# Spec: initial screen bugs (#39)

## Goal

All acceptance criteria in issue-specs/issue-39.md are satisfied for issue #39, with evidence visible in the session: with a workspace open and no document open, the preview shows a "select a file in the folder view" hint instead of the Marky Mark splash logo; the splash (logo, version, About info) still renders when nothing at all is open (no workspace, no document); `npm run validate:quick` passes in the implementer's session; and a summary comment from the implementer exists on issue #39.

## Acceptance criteria

- With a workspace open (folder or multi-folder) and no document open — e.g. after opening a workspace and then closing the open file via Close File — the preview area does NOT render the splash (`data-testid="empty-hint"` splash content: app badge/logo, version, alpha notice, developer/license lines, drop hint). Instead it shows a short hint message along the lines of "Select a file in the folder view to open it".
- The splash never appears while a workspace is open, in any path that lands on the empty preview state (closing the last tab, Close File command, deleting the open file from the folder tree, etc.). `appMode === 'workspace'` (see `src/lib/appMode.ts`) is the discriminator: workspace open → hint; no workspace and no doc → splash.
- The full splash (logo + About info + drop hint) still renders at true initial state: no workspace and no document open, including after Close Workspace and after closing the last file with no workspace.
- The workspace empty hint has a stable test id so tests can distinguish it from the splash, and existing e2e assertions on `empty-hint` are updated where they assert the splash in a workspace-open state (see `tests/e2e/folder-tree.spec.ts:482,499` and several sites in `tests/e2e/tabs-and-workspace.spec.ts`; `tests/e2e/helpers.ts` uses `empty-hint` as the shim-ready signal at true splash, which should keep working).
- An e2e or unit-level test exists covering the new behavior: workspace open + file closed shows the hint, not the splash; and the splash still shows with no workspace.
- The hint text is styled as muted, unobtrusive app UI (reuse existing `--mm-*` theme tokens in `src/styles.css`; no images, consistent with the splash's "pure app UI" rule from SPEC27 §3).
- The implementer iterated with `npm run typecheck` and `npm run test:unit` (or tests targeted at the changed code, e.g. `npx playwright test -g '<title>'` for a single e2e), and ran `npm run validate:quick` ONCE right before declaring the goal met — not after every small change, and not as a full-suite baseline at the start.
- A summary comment from the implementer exists on issue #39.

## Context

The issue: opening a workspace and then closing a file drops the user on the splash (Marky Mark logo) in the preview pane. The splash should be reserved for the true initial screen (no workspace, no document); with a workspace open, the empty state should instead invite the user to pick a file from the folder view. The only comment on the issue asks that #38 be fixed first — #38 is already CLOSED, so there is no ordering blocker.

The splash renders in `src/App.tsx` around line 4321, gated only on `!docPath && !untitled` — it ignores whether a workspace is open. The app already derives the three-mode model (`splash | file | workspace`) via `deriveAppMode` in `src/lib/appMode.ts` (`appMode` at `src/App.tsx:3129`); branching the empty-preview render on `appMode` (or `wsKind !== 'none'`) is the natural fix. All paths back to the empty state funnel through `closeToSplash` (`src/App.tsx:1702`), so no state changes should be needed — this is a render-time branch. Splash styling lives under `.splash` / `.empty-center` in `src/styles.css` (SPEC27 §3 citations). Grep `SPEC27` and `Issue #22` for the relevant citation sites before editing; never read `App.tsx` whole.
