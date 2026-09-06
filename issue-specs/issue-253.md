# Spec: Hosted: opening a workspace flashes through intermediate screens before landing (#253)

## Goal

All acceptance criteria in issue-specs/issue-253.md are satisfied for issue
#253, with evidence visible in the session: on the hosted (cloud) build, an
entry into a workspace — a row clicked on the home page or in Open Workspace,
a path deep link, the legacy `?workspace=` form, or a scratchpad route —
paints no intermediate screen on the way (no sign-in page, no "Checking
session…" frame, no home page/splash, no blank frame), holding one stable
frame until the workspace surface itself is ready; the desktop, dev-shim and
single-file builds are untouched and the existing hosted deep-link, scratchpad
and canonical-URL contracts still hold; `npm run validate:quick` passes in the
implementer's session; and a summary comment from the implementer exists on
issue #253.

## Acceptance criteria

**No intermediate screens — the load-bearing behaviour**

- Entering a workspace on the hosted build never attaches an intermediate
  screen to the DOM. For a signed-in session, from the moment the destination
  page starts loading until the workspace surface is on screen, none of these
  ever exist in the document: `hosted-sign-in` (including its "Checking
  session…" frame), `hosted-not-found`, the home page/splash (`start-actions`,
  `empty-hint`), or a bare empty `.theme-root` shell with nothing in it.
  "Never attached", not "gone by the end" — the assertion is made by an
  observer registered before boot, not by a poll after it.
- This holds for every entry path into a workspace:
  - a workspace row clicked on the home page and in the Open Workspace dialog
    (`hostedWorkspaces.ts` `navigateTo`);
  - a path deep link `/<workspace-name>` and `/<workspace-name>/<file…>`
    (PRD 020), with and without a `#fragment`;
  - the legacy `/?workspace=<uuid>` form;
  - `/scratchpad`, `/<username>/scratchpad[/<file…>]` and the legacy
    `/scratch` spellings (PRD 019/023, issue #244);
  - a reload of any of the above.
- Whatever holds the screen while the destination resolves is ONE stable
  frame for the whole wait — the previous screen, or a single quiet loading
  surface. The app never alternates between two holding surfaces, and never
  paints a holding surface *after* having painted real content. If a loading
  surface is introduced it carries its own `data-testid` and `role="status"`
  (the `search-scanning` pattern in `src/components/SearchPanel.tsx`), is
  styled from PRD 018 tokens, and is itself entered at most once per boot.
- A signed-out visitor is unaffected: the sign-in page is still the first
  screen they see, and `hosted-sign-in` / `hosted-sign-in-microsoft` /
  `hosted-sign-in-username` keep their ids and behaviour (existing sign-in
  e2e coverage stays green). Returning from the Entra redirect leg with a
  stored visit intent lands in the intended workspace with no home page or
  sign-in page painted in between.
- An unresolvable visit still lands on the not-found page (`hosted-not-found`,
  PRD 020 Req 8) as the FIRST screen painted — never after a flash of the
  home page or the sign-in page.

**Boot sequence**

- The boot issues no duplicate probe: for a scratchpad or workspace entry,
  `GET /api/me` is requested at most once between page load and the workspace
  being on screen (today `HostedShell`'s session validation and
  `resolveHostedVisit`'s `myHandle` each fetch it). The session record the
  hosted platform holds for the session (PRD 017 Req 3) is not re-fetched by
  the gate either.
- Independent probes are started together rather than strictly one after
  another — e.g. the session validation and the workspace listing are in
  flight concurrently, not chained through an `await` that has no data
  dependency. Visible in the diff as `Promise.all`/concurrent starts.
- The PRD 020 Req 5+6 ordering is preserved: the visit is resolved and the
  address bar rewritten to the canonical form (`/<workspace-name>[/<file…>]`,
  `/<username>/scratchpad[/…]`) via `history.replaceState`, and the
  `hostedGate` boot record stored, BEFORE `<App/>` mounts and reads it. The
  `#<heading-slug>` / `#hl-<id>` fragment still rides the rewrite untouched
  and still lands (E430/E431 and the deep-link tests stay green).
- The single-use `code`/`state` are still stripped from the address bar
  before any await in the Entra callback leg.
- The PRD 023 scratch-buffer rules are unchanged: a bare own-scratch entry
  still boots the fresh untitled buffer, a file segment still suppresses it,
  and someone else's scratch never boots one.

**Scope and non-regression**

- Hosted (cloud) only, per the issue's build-applicability note. `main.tsx`
  still mounts `<App/>` directly when `detectHostedMode` answers null, and the
  desktop (Tauri), dev-shim and single-file web builds paint exactly what they
  paint today — no new holding screen, no changed splash, no changed timing
  path. Any App-side change is gated on the hosted flavor or is behaviourally
  inert elsewhere.
- No existing `data-testid` is renamed.
- Every existing unit and e2e test still passes. Tests are adjusted only where
  the new contract genuinely requires it, keeping their IDs — never weakened,
  skipped, deleted, or marked `.only`/`.fixme`.

**Tests**

- New e2e tests in `tests/e2e/hosted.spec.ts` (the hosted lane owns this)
  prove the no-flash contract on at least: a signed-in boot at a
  `/<workspace-name>/<file>` deep link, a click-through from the home page /
  Open Workspace, a `/<username>/scratchpad` entry, and the legacy
  `?workspace=` form. Each registers a `page.addInitScript` MutationObserver
  before the boot that records whether any of the forbidden screens ever
  attached (the existing pattern near `tests/e2e/hosted.spec.ts:5269`), and
  asserts it recorded none while the workspace surface did arrive — so the
  test cannot pass vacuously by never reaching the workspace.
- One test also pins the "one stable frame" rule: the sequence of holding
  surfaces observed during a boot has at most one distinct entry.
- Any new pure logic lands in a `src/lib/` module (no React, no platform
  imports) with unit tests in the matching `tests/unit/<kebab-case>.test.ts`.
- New IDs start above the current high-water marks: E504 for desktop e2e,
  U1198 for unit, W18 for web e2e.

**Repo hygiene and verification**

- Every behavioural change carries a citation comment in the house format
  (`.sandcastle/CODING_STANDARDS.md`) naming the contract it implements —
  here `// PRD 020 Req 5+6 (issue #253): …` and PRD 007 Req 5 for the gate.
- Any CSS touched satisfies the style lint in `scripts/validate.mjs` and
  `docs/STYLE-GUIDE.md` (scale tokens for font-size / border-radius /
  box-shadow, no raw colour literals in chrome rules, no bare descendant
  element selectors, ui/ primitives for buttons).
- `docs/MAP.md` is regenerated with `npm run map` only if a `SPEC<n>` citation
  set changed; the e2e count in `scripts/validate.mjs` is a floor, so added
  tests need no edit there.
- Iteration used `npm run typecheck` + `npm run test:unit` (plus targeted
  `npx playwright test -g '<title>'` runs for the hosted tests being touched).
  The full gate was **not** run as a start-of-attempt baseline and not after
  every change — baseline with the quick pair only.
- `npm run validate:quick` has been run ONCE, at the end, in the implementer's
  session, and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #253, naming what
  now holds the screen during a workspace open and the validate:quick
  evidence.

## Context

Today's hosted boot paints three or four frames on the way into a workspace,
which is exactly the flashing the issue describes:

1. `src/main.tsx` mounts `<HostedShell>` (hosted marker only). Its initial
   phase is `checking`, which renders the sign-in page shell with the badge
   and "Checking session…" — the sign-in flash, even for a signed-in user
   (`src/components/HostedSignIn.tsx`, the `Phase` union and the boot
   `useEffect`).
2. The boot effect awaits `/api/me`, then `resolveHostedVisit()`, which awaits
   `/api/workspaces`, sometimes `/api/me` again (`myHandle`), sometimes a
   files listing — serially. Only then does it flip to `ready`.
3. `<App/>` mounts and returns a bare `<div className="theme-root" />` until
   its async bootstrap sets `platform` (`src/App.tsx:7446`, the bootstrap
   `useEffect` around `src/App.tsx:2777`).
4. With the platform set but nothing open yet, App renders the splash / start
   page (`empty-hint`, `StartPage`'s `start-actions`) — the home-page flash —
   until `platform.onOpenFile` delivers the bound workspace's virtual path
   (`src/platform/hosted.ts:584`) and `openWorkspaceFromPath`
   (`src/App.tsx:3260`) populates the sidebar and opens `bootDocument`.

Clicking a row is a real navigation: `navigateTo` in
`src/platform/hostedWorkspaces.ts:255` fetches the listing and then
`window.location.assign`s the canonical path, so the whole sequence above runs
again on the new document.

Files most likely in play: `src/components/HostedSignIn.tsx` (phases, the
boot effect, `resolveHostedVisit`), `src/main.tsx`, `src/platform/hosted.ts`
and `src/lib/hostedGate.ts` (the boot record hand-off),
`src/platform/hostedWorkspaces.ts` (`navigateTo`), and the App-side seam that
decides what shows while a bound workspace is still opening (`src/App.tsx`,
`hostedNothingOpen` around line 4895, the splash render around line 7872).
`src/lib/hostedPaths.ts` owns the URL shapes and is already unit-tested.

The hosted e2e lane runs against the real local backend (Azurite + seeded mock
auth) started by `playwright.config.ts` on `http://localhost:4924`; helpers at
the top of `tests/e2e/hosted.spec.ts` do the sign-in and blob setup. Because
that store is shared across parallel workers, tests that need a specific
workspace row should search for it rather than assume it is visible.

The implementer is free to choose the mechanism (holding the previous frame,
one quiet loading surface, deferring the mount until the destination is
resolved, or a combination) as long as the observable contract above holds.
