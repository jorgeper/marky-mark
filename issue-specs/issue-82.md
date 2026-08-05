# Spec: make workspace files associated to marky mark (#82)

## Goal

All acceptance criteria in issue-specs/issue-82.md are satisfied for issue #82, with evidence visible in the session: the app bundle declares a `marky-workspace` file association in `src-tauri/tauri.conf.json` so double-clicking a `.marky-workspace` file on macOS opens Marky Mark, OS-opened `.marky-workspace` paths are routed through the existing workspace-open path (discard-guarded) instead of being opened as text documents, and `npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- `src-tauri/tauri.conf.json` → `bundle.fileAssociations` contains a second entry for `ext: ["marky-workspace"]` (Tauri exts are written without the leading dot; the runtime constant is `WORKSPACE_FILE_EXT = '.marky-workspace'` in `src/lib/workspace.ts`) with its own `name`/`description` and `role: "Editor"`. This is what makes macOS register the document type (and the Windows installer association) so double-click launches/activates the app.
- A path arriving via `platform.onOpenFile` that ends in `.marky-workspace` (case-insensitive) opens as a workspace, not as a document: it goes through `openWorkspaceFromPath` wrapped in `guardWorkspaceDiscard` — matching the recent-workspaces handling at `src/App.tsx:3130` — so a changed untitled workspace prompts before being replaced. All delivery routes funnel through the single registration at `src/App.tsx:2100` (macOS live `RunEvent::Opened` events, pre-frontend pending drains, and Windows/Linux CLI args), so one branch there covers every platform; no Rust changes are required.
- Paths that are not workspace files keep the current behavior (`openDocGuarded`).
- The workspace-vs-document decision is a pure, exported predicate (natural home: `src/lib/workspace.ts`) with unit tests covering match, case-insensitivity, and non-matches (e.g. a doc named `notes.marky-workspace.md`).
- An E-numbered e2e test (in `tests/e2e/tabs-and-workspace.spec.ts`, next free E number) drives the browser shim's `#open=<path>` deep link (the shim's `onOpenFile`, see `tests/e2e/helpers.ts:328`) with a seeded `.marky-workspace` file and asserts the workspace opens (its folder root appears in the sidebar) and no text tab opens for the workspace file itself.
- New behavior carries citation comments per repo convention (`// Issue #82: …`, format in `docs/COMMENT-FORMAT.md`).
- Iteration used `npm run typecheck` + `npm run test:unit` (or tests targeted at the changed code); the full gate `npm run validate:quick` was run ONCE, right before declaring the goal met — not after every small change and not as a baseline — and printed `QUICK VALIDATION: ALL PASSED` in the implementer's session.
- A summary comment from the implementer exists on issue #82.

## Context

The issue asks: on macOS, double-clicking a workspace file should open Marky Mark. Workspace files are `.marky-workspace` (PRD 002; parse/serialize in `src/lib/workspace.ts`). Today `tauri.conf.json` only associates `md`/`markdown`, and the frontend treats every OS-opened path as a document: `src-tauri/src/lib.rs` collects opens (macOS `RunEvent::Opened`, CLI args elsewhere) and the app registers `p.onOpenFile((path) => openDocGuarded(p, path))` at `src/App.tsx:2100`. The fix is two-sided: declare the association in the bundle config, and branch that one callback so workspace files reach `openWorkspaceFromPath` (`src/App.tsx:2366`) under `guardWorkspaceDiscard`. Note `openWorkspaceFromPath` is declared after the boot effect that registers the callback — mind the declaration order (the codebase's ref pattern, e.g. `startQuitWalkRef`, is available if needed). Drag-and-drop (`onFileDrop`) filters to markdown and is out of scope. Manual macOS Finder verification is not possible in this sandbox; the config entry plus the e2e-shim test are the evidence.
