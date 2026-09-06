# Spec: Open Scratchpad: menu entry and home-page button (#275)

## Goal

All acceptance criteria in issue-specs/issue-275.md are satisfied for issue
#275, with evidence visible in the session: on the hosted (cloud) build an
"Open Scratchpad" row sits in the hamburger's workspace group — ordered New
Workspace, Open Workspace…, Open Scratchpad, Close Workspace, Management… —
and an "Open Scratchpad" button sits beside Open Workspace on the home page,
each landing on the signed-in user's own scratchpad exactly as visiting the
scratchpad URL does (fresh buffer, cursor ready); neither surface exists on
Tauri, the dev shim or the single-file web build; `npm run validate:quick`
passes in the implementer's session; and a summary comment from the
implementer exists on issue #275.

## Acceptance criteria

**The entry action**

- A fifth entry action exists alongside `openFile` / `openFolder` /
  `newWorkspace` / `openWorkspace` / `management` — an `openScratchpad`
  `StartActionId` in `src/lib/startActions.ts` with the label
  `Open Scratchpad` (no ellipsis: it opens straight through, it does not ask
  a question) in `START_ACTION_LABELS`, and a matching `openScratchpad`
  `CommandId` in `src/lib/commands.ts` with a handler in `src/App.tsx`. The
  one list feeds all three surfaces (start page, native File menu, hamburger)
  exactly as `management` does today — no surface invents a second list.
- It is ordered **immediately after `openWorkspace`** in the derived list, so
  the start page renders it beside Open Workspace and `management` (appended
  later, admin-only) still comes last.
- Its presence is a **capability** test, never a `platform.kind` sniff — the
  rule `src/lib/startActions.ts`'s doc comment already states. Either a new
  platform seam only the hosted flavor defines (e.g. an `openScratchpad`
  member on `WorkspaceLifecycle` in `src/platform/types.ts`, implemented in
  `src/platform/hostedWorkspaces.ts`) or an App-side append next to the
  `management` one gated on a hosted-only capability plus the session record.
  Whatever the mechanism, `startActions`/`startCapabilities` keeps its purity
  (no DOM, no platform import) and the derivation is unit-tested.
- **Hosted only.** The action is absent from the entry list on the Tauri
  desktop, the dev shim and the single-file web build, so no menu row and no
  home-page button renders there — proven by the existing desktop-shim and
  web e2e menu/splash assertions passing unedited.

**The hamburger's workspace group**

- `buildAppMenu` (`src/lib/appMenu.ts`) emits the `workspace` group in exactly
  this order, each row present under its existing gating: New Workspace
  (`menu-new-workspace`), Open Workspace… (`menu-open-workspace`), Open
  Scratchpad (`menu-open-scratchpad`), Close Workspace
  (`menu-close-workspace`), Management… (`menu-management`). Two changes from
  today: the new row, and `menu-management` moving from third place to last.
- Labels are unchanged for the existing four rows — the issue's numbered list
  fixes the *order*, not the wording, and `New Workspace` keeps its
  ellipsis-free label (pinned by U854). No existing `data-testid` is renamed.
- Reading of the issue, stated because it drives the above: "the workspace
  group" is `AppMenuGroupId = 'workspace'` in `src/lib/appMenu.ts` — the only
  surface where Close Workspace and Management… sit together. In the native
  File menu (`src/lib/menuSpec.ts`) Open Scratchpad joins the capability-gated
  `entryItems` — after Open Workspace…, before Management… — and Close
  Workspace stays in its existing SPEC12 close cluster; that layout is
  otherwise untouched.

**Behaviour**

- Activating either surface reaches the same destination and behaviour as
  navigating to the scratchpad URL: the page ends up at
  `/<username>/scratchpad` (`buildScratchPath` in `src/lib/hostedPaths.ts`,
  the canonical form PRD 020 Req 10 pins) with the PRD 023 Req 1 fresh
  untitled scratch buffer — `docname` reads "Scratchpad file", edit mode,
  cursor ready — including when the user is already inside their scratchpad
  (activating it again re-lands on a fresh buffer). Re-using the existing
  navigation route (`window.location.assign(buildScratchPath(handle))`, the
  `navigateTo` branch in `src/platform/hostedWorkspaces.ts:269`) is preferred
  over a second copy of the URL construction.
- It opens no dialog and asks no question: unlike New/Open Workspace on
  hosted, there is no picker step.
- It introduces no data-loss path: leaving a dirty document behaves exactly as
  opening a workspace does today — the command routes through the same
  unsaved-changes guard `openWorkspace` uses (`crossModes`, `src/App.tsx:4618`)
  rather than navigating away unguarded. The PRD 019 Req 11 scratch-buffer
  exemption (a dirty scratch buffer discards silently) is unchanged.
- The row/button is present for any signed-in hosted session — it is not
  admin-gated and not workspace-mode gated: it shows on the home page and
  inside a workspace alike.

**Non-regression**

- Every existing unit and e2e test still passes. The hosted e2e assertions
  that pin the hamburger's exact row list (`tests/e2e/hosted.spec.ts` around
  lines 2101 and 2696) and the `app-menu` unit fixtures are updated only where
  the new row or the Management move genuinely requires it — keeping their
  ids, never weakened, skipped, deleted or marked `.only`/`.fixme`.
- The desktop-shim menu tests (`tests/e2e/shell-and-menus.spec.ts`) and the
  web suite pass **unedited** — the proof the change is hosted-only.
- The scratchpad's own contracts are untouched: `/scratchpad`,
  `/<username>/scratchpad[/<file…>]` and the legacy `/scratch` spellings still
  resolve (E397), the first-save naming still holds (E399), and the boot
  hand-off in `src/lib/hostedGate.ts` / `src/platform/hosted.ts` is unchanged.

**Tests**

- Unit coverage in `tests/unit/start-actions.test.ts`, `tests/unit/app-menu.test.ts`
  and `tests/unit/menu-spec.test.ts` with the next unused ids (**U1206**
  onward): the hosted capability set yields `openScratchpad` directly after
  `openWorkspace` while the desktop/shim and static-web sets do not carry it
  at all; the hamburger's workspace group renders the five rows in the exact
  order above for a hosted admin state, and is unchanged for the desktop set;
  the File menu's entry items place Open Scratchpad between Open Workspace…
  and Management….
- New hosted e2e in `tests/e2e/hosted.spec.ts` with the next unused ids
  (**E509** onward), titles starting `E<n>:`: signed in as a seeded mock user,
  (a) the home page shows the Open Scratchpad button beside Open Workspace and
  clicking it lands on `/<username>/scratchpad` with `docname` reading
  "Scratchpad file"; (b) the hamburger's rows appear in the exact order above
  and `menu-open-scratchpad` lands on the same destination from inside a
  workspace. The button's test id follows `StartPage`'s existing
  `start-${id}` derivation.
- Any new pure logic lands in a `src/lib/` module with unit tests in the
  matching `tests/unit/<kebab-case>.test.ts`.

**Docs and repo hygiene**

- Every behavioural change carries a citation comment in the house format
  (`.sandcastle/CODING_STANDARDS.md`) naming the contract it implements.
- The PRDs whose text this makes inaccurate are **amended, not rewritten**, in
  this repo's existing blockquote style
  (`> **Amendment (issue #275, 2026-09-06):** …`): PRD 009 Req 8 (the
  workspace group's order — the new row, and Management… now last), PRD 007
  Req 21 (the hosted start page's "offers exactly" list), and PRD 019 (the
  scratchpad now has two in-app entry points beside its URL, hosted-only).
- `docs/MAP.md` is regenerated with `npm run map` and committed if any
  `SPEC<n>` citation was added, moved or removed in `src/` or `tests/`; the
  e2e count in `scripts/validate.mjs` is a floor, so added tests need no edit
  there.
- Any CSS touched satisfies the style lint in `scripts/validate.mjs` and
  `docs/STYLE-GUIDE.md`; the home-page button uses the existing `ui/Button`
  primitive `StartPage` already renders, so no new button styling is added.

**Verification**

- Iteration used `npm run typecheck` and `npm run test:unit` (or tests
  targeted at the changed code, e.g. `npx vitest run tests/unit/app-menu.test.ts`
  and `npx playwright test -g '<title>'` for the new hosted tests). The full
  gate was **not** run as a start-of-attempt baseline and not after every
  change — baseline with the quick pair only.
- `npm run validate:quick` has been run ONCE, at the end, in the implementer's
  session, and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #275, naming what
  changed, the new test ids, and the validate:quick result.

## Context

The entry surface is already one list feeding three renderers, which is the
whole shape of this change: `src/lib/startActions.ts` derives an ordered
`StartActionId[]` from platform capabilities; `src/components/StartPage.tsx`
maps it to `start-<id>` buttons; `src/lib/menuSpec.ts` maps it to the native
File menu's `entryItems` (line ~276); `src/lib/appMenu.ts` maps it to the
hamburger's `workspace` group (the `buildAppMenu` block that currently emits
New Workspace → Open Workspace… → Management… → Close Workspace). `src/App.tsx`
assembles the list in the `entryActions` memo (~line 4833, where `management`
is appended as a session fact) and dispatches from `runEntryAction`, which
maps an action id straight to the command id of the same name.

The scratchpad: PRD 019 (+ PRD 023 for the fresh-buffer rules, PRD 020 Req 10
for the canonical URL). `buildScratchPath(username)` in
`src/lib/hostedPaths.ts` builds `/<username>/scratchpad`; visiting it is a real
navigation that `HostedSignIn`'s gate resolves into a `HostedBoot` record with
`scratch: true` (`src/lib/hostedGate.ts`), which `src/platform/hosted.ts` turns
into the `scratchStart` hook App uses to open the prompt-exempt buffer. The
existing precedent for going there from inside the app is `navigateTo` in
`src/platform/hostedWorkspaces.ts:269` — it reads the caller's handle from
`sessionMe()` and `window.location.assign`s the scratch path for a flagged
row. Only `src/platform/hosted.ts` defines `platform.workspaces`, so a seam
hung there is hosted-only by construction.

Hosted e2e runs against the real local backend (Azurite + seeded mock auth)
that `playwright.config.ts` boots on :4924; `signIn`, `createWorkspace`,
`openAppMenu` and the helpers at the top of `tests/e2e/hosted.spec.ts` are the
setup, and E397/E399 (line ~4097) are the closest scratchpad examples. Because
the store is shared across workers, a test needing a specific row should search
for it rather than assume it is visible.

Read `.sandcastle/CODING_STANDARDS.md` before writing code — citation comments,
test-id discipline, and the `E<n>:`/`U<n>:` numbering rules the gate enforces.
