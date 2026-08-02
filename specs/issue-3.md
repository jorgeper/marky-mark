# Spec: Folder pane chevron toggle (collapse/expand at the left edge) (#3)

## Goal

All acceptance criteria in specs/issue-3.md are satisfied for issue #3, with evidence visible in the session: the folder pane header's X close button is replaced in the same header slot by a left-pointing chevron (`data-testid="folder-collapse"`) that closes the pane, a right-pointing chevron (`data-testid="folder-expand"`) pinned at the workspace's top-left edge reopens it when closed, both chevrons flip only `settings.showFolders` and stay in sync with the View → Folders menu / `Mod+Shift+E` / reload persistence, and `npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- The folder pane header's X close button (`data-testid="folder-close"` in `src/components/FolderPanel.tsx`) is replaced, in the same header slot, by a left-pointing chevron button that closes the pane (`showFolders → false`). It carries `data-testid="folder-collapse"`, a tooltip, and an `aria-label` (e.g. "Hide the folder panel"). (PRD Req 1)
- When the folder pane is closed — in workspace mode, on platforms that have the folder seam (desktop and the dev/e2e shim) — a right-pointing chevron button is pinned at the top-left edge of the workspace, vertically aligned with where the pane header sits when open. Clicking it reopens the pane (`showFolders → true`). It carries `data-testid="folder-expand"`, a tooltip, and an `aria-label` (e.g. "Show the folder panel"). (PRD Req 2)
- The closed-state chevron's hit target is compact (comparable to the existing folder-pane header buttons) and does not overlap or obscure document content beyond that target; it renders correctly in both light and dark themes. (PRD Req 3)
- The chevrons flip only `settings.showFolders` — no new settings or state keys. The View → Folders checkmark, `Mod+Shift+E`, and reload persistence all reflect chevron clicks (e2e E94 in `tests/e2e/app.spec.ts` is extended to cover this), and a pane closed via chevron stays closed until explicitly reopened (e2e E95 extended). (PRD Req 4)
- In the web build there is no folder chevron in either state, and outside workspace mode (splash, single-file) neither folder chevron renders. (PRD Req 5)
- All existing tests that reference the removed `folder-close` testid (e.g. `tests/e2e/app.spec.ts` around lines 3026, 3118, 3156) are updated to the new chevrons so the suite stays green; the full new-coverage sweep is a later sub-issue and is out of scope here, as are the split-preview chevrons and slide animations (PRD Reqs 6–11).
- `npm run validate:quick` passes, run in the implementer's session. Iterate with `npm run typecheck` and `npm run test:unit` (or Playwright tests targeted at the changed specs, e.g. `npx playwright test -g "E94|E95"`) while developing; run the full `npm run validate:quick` gate ONCE, right before declaring the goal met — not after every small change, and not as a start-of-attempt baseline.
- A summary comment from the implementer exists on issue #3.

## Context

The X button lives at `src/components/FolderPanel.tsx:418` (`data-testid="folder-close"`, `onClick={p.onClose}`); the same file already has a hand-written inline `Chevron` SVG component to reuse (add a direction variant or rotation — no icon library). `settings.showFolders` is wired through `src/App.tsx`, `src/lib/menuSpec.ts`, and `src/lib/settings.ts`; the chevrons are a new surface over that existing state, not new state. The closed-state chevron must only render in workspace mode on platforms with the folder seam — the web build keeps zero folder-pane DOM (web e2e W12 stays green, though the web e2e tier is outside `validate:quick`). E94 (~line 3084) and E95 (~line 3130) in `tests/e2e/app.spec.ts` are the tests to extend; `validate:quick` runs typecheck + unit tests + the desktop-shim e2e suite, so those updated tests are part of the gate. PRD: `prd/003-pane-chevrons-and-slide-animations.md` (Requirements 1–5 only for this issue).
