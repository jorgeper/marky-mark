# Spec: Hosted mode: Sign out menu item (#95)

## Goal

All acceptance criteria in issue-specs/issue-95.md are satisfied for issue #95,
with evidence visible in the session: the in-app menu's app group opens with a
**Sign out** row on the hosted flavor and on no other, gated by a capability on
`Platform` rather than a `kind === 'hosted'` check; activating it runs the
existing dirty-file prompts over open work (Cancel leaves the session signed in
and nothing closed), then clears the stored bearer token and lands the browser
back on the sign-in screen with no `?workspace=` binding, so a reload stays
signed out; the sign-in experience itself (PRD 007 Req 4–6) is untouched; the
frozen hamburger item-set tests that the new row changes are updated in this
change rather than left failing; `npm run validate:quick` has been run in the
implementer's session and passes; and a summary comment from the implementer
exists on issue #95.

## Acceptance criteria

### The row (PRD 009 Req 8/17)

- `buildAppMenu` (`src/lib/appMenu.ts`) emits a **Sign out** row as the
  **first** row of the `app` group — ahead of `Settings…`, `Help`,
  `About Marky Mark` — with label exactly `Sign out` and test id
  `menu-sign-out`. The placeholder comment at `src/lib/appMenu.ts:118` that
  reserves the slot for #95 is replaced by the real row.
- The row dispatches a command, not an inline callback: a new `signOut`
  `CommandId` in `src/lib/commands.ts`, handled in `App.tsx`'s
  `registerCommands` map like every other menu row
  (`.sandcastle/CODING_STANDARDS.md` — a user-visible action is a named
  command). `src/components/Toolbar.tsx` keeps rendering whatever
  `buildAppMenu` hands it and gains no per-row callback.
- No new hotkey and no accelerator (PRD Non-goals); the row shows no hotkey
  hint. The native desktop menu (`src/lib/menuSpec.ts`, `buildMenuSpec`) gains
  nothing — its frozen fixtures and U317–U319 / U324 / U325 stay green
  untouched.

### Gating: capability, never flavor (Req 17)

- `AppMenuState` gains one flag (e.g. `canSignOut`) and the row appears only
  when it is true. `App.tsx` derives it from a **capability on `Platform`** —
  a new optional member on `src/platform/types.ts` (e.g. `signOut?(): void`)
  implemented only by `createHostedPlatform()` (`src/platform/hosted.ts`) —
  never from `platform.kind`, matching the rule the workspace rows already
  follow. `tauri.ts`, `browser.ts` and `web.ts` omit it (the optional-seam
  route the standards allow), so the row is absent on desktop, the dev shim
  and the static web build.
- The row is present on the hosted flavor in **every** UI state that renders
  the menu — initial page, single-file mode, workspace mode — since signing out
  is never mode-dependent. It is never merely disabled; on a flavor without
  hosted auth it is absent.

### What activating it does (Req 17)

- Open work runs the **existing** dirty-file prompts before anything is
  cleared — the same walk Close File / Close Workspace use
  (`dirtyDocsQueue` / `processQuitWalk`, and the changed-workspace prompt where
  a workspace is open). No new prompt UI is invented.
- **Cancel anywhere in those prompts aborts the sign-out entirely**: the token
  is still stored, the session is still signed in, no document or workspace was
  closed, and the app stays exactly where it was.
- On completion the stored bearer token is cleared through
  `clearToken(window.localStorage)` (`src/lib/hostedGate.ts`) — the one owner
  of that key — and the browser lands on the sign-in screen
  (`data-testid="hosted-sign-in"`).
- The landing URL carries **no `?workspace=<id>` binding**: after signing out
  of a workspace, a reload shows the sign-in screen and signing back in lands
  on the initial page, not back inside the workspace. Reuse the existing
  navigation seam (`platform.workspaces.navigateTo(null)` assigns `/`) or an
  equivalent origin-root navigation rather than a second URL-writing path.
- **No new network call site.** Sign-out is client-side only: there is no
  `/api/auth/sign-out` endpoint and none is added, and no `fetch(` is added
  anywhere in `src/` outside the existing allowlisted hosted wrapper — the
  bundle scan in `scripts/validate.mjs` allows exactly zero new ones.
- `src/components/HostedSignIn.tsx`'s sign-in behaviour is unchanged (PRD
  Non-goals): the local-username form, the Microsoft PKCE redirect, the
  callback handling and the `/api/me` revalidation on boot all behave exactly
  as today. If the signed-out landing is reached by a navigation, `HostedShell`
  needs no new state at all; any change to it must be limited to what the
  sign-out landing requires.

### Tests and citations

- New and changed behaviour carries `// PRD 009 Req 17:` citation comments per
  `.sandcastle/CODING_STANDARDS.md`; `docs/MAP.md` is regenerated with
  `npm run map` and committed if any citation moved.
- Unit coverage in `tests/unit/app-menu.test.ts`: the Sign out row is the first
  row of the `app` group when the capability is present, absent when it is not,
  present in every `AppMode` (splash / file / workspace), never `disabled`, and
  carries the `menu-sign-out` test id and a `CommandId`. Titles start at the
  next free `U` number — U348–U353 went to issue #94 in the merge, so these
  landed at **U354**–**U357**.
- The frozen hosted item-set test **E201** (`tests/e2e/hosted.spec.ts`, the
  exact `rows` array and separator count) is updated in this change to include
  `menu-sign-out`, rather than left failing. **E13**
  (`tests/e2e/shell-and-menus.spec.ts`) and **W13** (`tests/e2e/web.spec.ts`)
  must keep asserting item sets **without** a Sign out row — that is the
  gating's evidence; if either needs touching, the row must not be what was
  added.
- One new e2e in `tests/e2e/hosted.spec.ts`, numbered **E215** (E214 went to
  issue #94 in the merge), covers the flow end to end: signed in, the menu offers Sign
  out; with unsaved work open, activating it prompts and **Cancel** leaves the
  app signed in with the work still open; going through again and discarding
  lands on `hosted-sign-in`, and a reload stays on the sign-in screen (the
  token is gone) with no workspace bound. #96 audits Req 18 coverage — it does
  not duplicate this test.
- No existing test is weakened, skipped, deleted or renumbered to get the gate
  green.

### Scope

- Out of scope: the View submenu's contents (#94), the wider Req 18 e2e sweep
  (#96), any change to the mode model, the workspace pickers, or the sign-in
  flow.
- Desktop (Tauri) behaviour is unchanged.

### Gate

- Iterate with `npm run typecheck` and `npm run test:unit` (or
  `npx playwright test -g '<title>'` for a single e2e), not the full suite.
  Run `npm run validate:quick` **once**, right before declaring the goal met;
  it prints `QUICK VALIDATION: ALL PASSED`. Do not use it as a start-of-attempt
  baseline beyond a single optional quick-tier check.
- A summary comment from the implementer exists on issue #95 (what changed, the
  capability chosen for the gating, where the token is cleared and how the
  sign-in screen is reached, files touched, gate evidence).

## Context

PRD: `prd/009-server-mode-menu.md` Req 17 (plus Req 8's group order and the
"Sign-in flow changes" non-goal); parent #88; blocked-by #93, which landed the
grouped menu and deliberately left Sign out the first slot of the `app` group.

The item set is data: `src/lib/appMenu.ts` (`buildAppMenu`, `AppMenuState`),
rendered by `src/components/Toolbar.tsx` (~line 148) and fed from `App.tsx`
(~line 3696, the `appMenu` `useMemo`). Commands live in `src/lib/commands.ts`
and are wired in `App.tsx`'s handler map (~line 3480+); `closeWorkspaceCmd`
(~line 2708) and `crossModes` (~line 2729) show the dirty-walk idiom —
`guardWorkspaceDiscard` → `quitDoneRef` / `quitQueueRef` → `processQuitWalk` —
to reuse.

Hosted auth: the token lives behind `readStoredToken` / `storeToken` /
`clearToken` in `src/lib/hostedGate.ts` (key `marky-mark.hosted.token` in
`localStorage`); `src/components/HostedSignIn.tsx` is the gate that renders the
sign-in page until a session exists and then mounts `<App/>`; the hosted
platform reads the token per request in `src/platform/hosted.ts`
(`createHostedPlatform`, ~line 84). The `?workspace=<id>` binding and its
`navigateTo` / `unbind` seam are in `src/platform/hostedWorkspaces.ts`
(~lines 203–215). Hosted e2e signs in via the `signInTo` helper in
`tests/e2e/hosted.spec.ts` (~line 383); the local `openAppMenu` helper
(`tests/e2e/hosted.spec.ts:611`) opens the menu.
