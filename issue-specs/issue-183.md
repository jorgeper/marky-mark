# Spec: Settings: People as its own tab under Editor; consistent text-input styling; name autocomplete in Add people (#183)

## Goal

All acceptance criteria in issue-specs/issue-183.md are satisfied for issue #183, with evidence visible in the session: with a hosted workspace open the settings tab list shows a People tab immediately after Editor holding the members section (Roles and the danger zone reachable from it, no longer appended to unrelated tabs, absent without a workspace or permission); the Add people input and the role select share padding, height, border colour/radius and edge alignment via one shared text-input rule in src/styles.css; typing in Add people shows a keyboard-navigable autocomplete dropdown (including a guest entry with its badge) with inline empty/error messages, covered by e2e against the local mock directory; and `npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

### §1 — People tab

- With a hosted workspace open (workspace lifecycle capability present) and the `workspace.members` permission, the settings tab list reads General, Appearance, Editor, **People**, Hotkeys, … — the People entry sits immediately after Editor in `TABS` (`src/components/SettingsPanel.tsx`).
- The People tab shows the members section (today's `WorkspaceAccessSettings` people list + picker). Roles and the danger zone (`WorkspaceDangerZone`) are reachable from that tab — same tab below People, or their own tabs beneath it (implementer's call) — and are **no longer appended to other tabs' content** (the current `{scope === 'workspace' && workspaceActions}` append at the end of the General tab is gone or repurposed into the tab).
- Without an open hosted workspace, or without the relevant permission, the People tab is absent — the same capability + per-permission gating the sections use today (`platform.workspaces` mount in `src/App.tsx` ~7350; `workspace.members` / `workspace.roles` / `workspace.delete` checks per PRD 007 Req 17). No permission-denied placeholder tab.

### §2 — Consistent text-input styling

- One shared CSS rule in `src/styles.css` styles text inputs in the settings panel (at minimum the Add people `.membership-input` and any other settings text field), instead of per-component tweaks.
- Under that rule the Add people input and the role `<select>` beneath it share vertical/horizontal padding, height, border colour, border radius and font, and their left/right edges align.
- The rule uses the theme variables (`--mm-*`) so it holds in every bundled theme, light and dark; visually checked in at least two themes (screenshot or e2e style assertion — state which in the summary comment).

### §3 — Autocomplete in Add people

- Typing in the Add people input shows a suggestions dropdown after the existing debounce (`createDirectorySearch` in `src/lib/membership.ts`), sourced from the existing injected `GET /api/directory/search` — no new server work.
- Matches cover display name, username/UPN and email; guest entries appear with the existing guest badge from #180.
- Keyboard: ↑/↓ move the highlighted suggestion, Enter adds it, Esc closes the dropdown; click adds as today.
- Empty results (after a non-empty query resolves) and a directory error each show an inline message in the dropdown area instead of silent nothing. Note `createDirectorySearch` currently collapses failures into an empty list — the two states must become distinguishable to the picker.
- E2e coverage against the local mock directory (`server/app.ts` `/api/directory/search`, exercised by `tests/e2e/hosted.spec.ts`) demonstrates autocomplete including a guest entry and keyboard selection.

### Process

- Existing E-numbered settings and hosted-membership tests are updated to the new structure rather than deleted; unit tests for changed `src/lib/` logic updated/added.
- New/changed behaviour carries `// SPEC<n> §x.y` or issue citations per `.sandcastle/CODING_STANDARDS.md`, and `docs/MAP.md` is regenerated via `npm run map` if the spec→code table changes.
- Iterate with `npm run typecheck` and `npm run test:unit` (or a single targeted e2e via `npx playwright test -g '<title>'`); run `npm run validate:quick` ONCE, right before declaring the goal met — not after every change and not as a full-suite baseline.
- `npm run validate:quick` passes in the implementer's session (`QUICK VALIDATION: ALL PASSED`).
- A summary comment from the implementer exists on issue #183.

## Context

The workspace sections are mounted from `src/App.tsx` (~line 7350) as the `workspaceActions` prop and appended inside SettingsPanel's General tab under Workspace scope (`src/components/SettingsPanel.tsx:803`); §1 replaces that append with a real tab. Mind the existing scope machinery (`USER_ONLY_TABS`, the user/workspace scope tabs) — People is workspace-tied, so decide deliberately how it behaves across the scope selector. The picker is `src/components/MembershipPicker.tsx` (already renders a results list, but with no keyboard nav and no empty/error states) over `src/lib/membership.ts`; picker CSS sits in `src/styles.css` ~3561. The issue comment notes live-tenant autocomplete was blocked by the #184 OBO failure — #184 is already merged on main, and §3's acceptance runs against the local mock directory regardless. Grep `SPEC` citations and `docs/MAP.md` before opening files; never read `App.tsx` whole.
