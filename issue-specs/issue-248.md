# Spec: Rename the "People" settings tab — it's the whole workspace's settings now (#248)

## Goal

All acceptance criteria in issue-specs/issue-248.md are satisfied for issue
#248, with evidence visible in the session: the hosted workspace tab in the
Settings dialog is labeled **Workspace** (not "People") with its id, testid and
internal `people*` names renamed to match, its gating and section contents
unchanged, the deployment-admin Management → People tab left alone, `npm run
validate:quick` run once at the end and passing, and a summary comment from the
implementer on issue #248.

## Acceptance criteria

- The settings tab is labeled **Workspace**. In `src/components/SettingsPanel.tsx`
  the `TABS` entry currently reading `{ id: 'people', label: 'People' }` reads
  `{ id: 'workspace', label: 'Workspace' }`, and the `SettingsTab` union member
  `'people'` is `'workspace'`. The label choice is settled by this spec — "Settings"
  was the owner's working suggestion, but a tab named "Settings" inside the Settings
  dialog (and beside Management's own deployment-level "Settings" tab) is the
  awkward reading the issue anticipated; "Workspace" names the scope, sits
  naturally next to General / Appearance / Editor, and says what the tab holds.
- The tab keeps its position immediately after Editor in the rail, and the rail's
  render-time filter still hides it when no hosted workspace is open or the member
  holds none of the permitted verbs (no placeholder tab).
- Gating and contents are unchanged — this is a naming change only. Same four
  verbs in the permission list (`workspace.settings`, `workspace.members`,
  `workspace.roles`, `workspace.delete`), same per-section permission checks, same
  fallback to General when the tab disappears while it is open, same sections in
  the same order (Names, Members, Roles, Danger Zone), same section testids
  (`workspace-members-section`, `workspace-roles-section`, `workspace-delete-section`,
  …), same behaviour in both scopes of the desktop scope rail.
- The internal names on the settings path no longer spell the tab "people":
  the tab testid is `settings-tab-workspace`; `WorkspaceAccess.peopleTab`,
  `PEOPLE_TAB_PERMISSIONS` and the exported `WorkspacePeopleTab` component in
  `src/components/WorkspaceAccessSettings.tsx` carry workspace-tab names (e.g.
  `workspaceTab`, `WORKSPACE_TAB_PERMISSIONS`, `WorkspaceSettingsTab`) and every
  import/use site is updated. `grep -rn "settings-tab-people\|peopleTab\|WorkspacePeopleTab\|PEOPLE_TAB" src tests`
  returns no matches, and the prose comments that call it "the People tab"
  (SettingsPanel.tsx, WorkspaceAccessSettings.tsx, App.tsx, `src/platform/hostedWorkspaces.ts`,
  `src/platform/hostedAdmin.ts`, `src/lib/deploymentAdmin.ts` where they mean the
  *settings* tab) name the Workspace tab instead.
- Management → People is untouched. `src/components/ManagementPanel.tsx`'s
  `people` tab is the deployment-wide user directory (PRD 017 Req 19) — a genuine
  list of people, not a mirror of the settings tab — so its label, its
  `management-tab-people` testid, its `Filter people…` placeholder and the
  `ManagementTab` union keep their current names. The issue's "mirrored in
  ManagementPanel.tsx" parenthetical is verified against the file rather than
  followed blindly; renaming that tab would misname a real people list.
- The `<h2>People</h2>` members-section heading in `src/components/WorkspaceMembers.tsx`
  stays "People" — it labels the members section inside the tab, which is people.
- Tests are updated to the new names and still cover the same behaviour:
  `tests/e2e/helpers.ts`'s `openSettings` tab union, `tests/e2e/styling.spec.ts`
  and `tests/e2e/hosted.spec.ts` (including E364's tab-rail label assertion, which
  now expects `General, Appearance, Editor, Workspace, Hotkeys, LLM providers,
  Experimental`, its absent-tab assertions, and its title/comments). No e2e test is
  deleted or weakened to make the rename pass.
- Any doc that names the *settings* tab says Workspace; docs that name the members
  section ("People section") or `Management → People` in `docs/AUTHENTICATION.md`,
  `docs/HOSTING-AZURE.md`, `docs/HOSTING-AZURE-PORTAL.md` are correct as they stand
  and are left unchanged. `docs/MAP.md` is regenerated with `npm run map` only if a
  `SPEC<n>` citation moved between files.
- Changed lines carry a citation comment in the repo's existing style — e.g.
  `// Issue #248: …` next to the renamed TABS entry, saying the tab holds the
  workspace's own settings (names, members, roles, danger zone), per
  `.sandcastle/CODING_STANDARDS.md`.
- Iteration used `npm run typecheck` and `npm run test:unit` (or tests targeted at
  the changed code, e.g. `npx playwright test -g 'E364'`); the full quick gate was
  not run after every change or as a start-of-attempt baseline beyond the quick tier.
- `npm run validate:quick` has been run ONCE, right before declaring the goal met,
  and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #248, naming the label
  chosen, the files touched, and the gate result.

## Context

The tab lives in `src/components/SettingsPanel.tsx` (`TABS`, the `SettingsTab`
union, the rail filter near the bottom of the render, and the
`tab === 'people' && workspaceLifecycle` body), with its access hook and body in
`src/components/WorkspaceAccessSettings.tsx` (`useWorkspaceAccess`,
`PEOPLE_TAB_PERMISSIONS`, `WorkspacePeopleTab`). The body composes
`WorkspaceNames` (PRD 020 Req 4), `WorkspaceMembers`, `WorkspaceRoles` and
`WorkspaceDangerZone`; grep `Issue #183` for the tab's original contract.

Build applicability is hosted (cloud) only — nothing in the desktop or single-file
build shows this tab. Note the desktop-only scope rail already has a **Workspace**
button (`settings-scope-workspace`); it is a separate rail above the tab rail and
the e2e hosted shim renders both, so keep the new tab testid distinct
(`settings-tab-workspace`) and expect no styling changes — no CSS selector targets
the tab by testid.

Blocked-by #246 (same file) has already landed on this branch's history, so no
conflict is expected. Citation-grep first (`rg 'Issue #183' src tests`); never read
`App.tsx` end-to-end.
