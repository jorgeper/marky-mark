# Spec: Azure web sign-in: back button returns to a dead sign-in page (#242)

## Goal

All acceptance criteria in issue-specs/issue-242.md are satisfied for issue
#242, with evidence visible in the session: a hosted sign-in page restored
from the browser's back/forward cache with a valid stored token continues
into the app instead of showing itself, the same restore without a token
renders an enabled sign-in button with no stale `busy` state, a disabled
sign-in button is never on screen without a visible "signing you in" status,
the existing hosted flows (E165–E168, E215, E390, E391) still pass,
`npm run validate:quick` passes in the implementer's session, and a summary
comment from the implementer exists on issue #242 carrying the manual
Azure-verification note.

## Acceptance criteria

### 1. A restored sign-in page with a session continues into the app

- When the hosted sign-in page is re-shown after having been left behind by
  the Entra redirect — a bfcache restore (`pageshow` with `persisted === true`),
  or any equivalent re-show such as the tab becoming visible again — and
  `localStorage['marky-mark.hosted.token']` holds a token, the page resolves
  the session the same way a fresh load with that token does (the boot effect
  at `src/components/HostedSignIn.tsx:394-462`: `startBootSession` →
  `resolvedPhase`) and lands the user in the app.
- The user never sees the sign-in page as the resting surface of that
  restore. Whatever holding surface a fresh load would paint (the issue #253
  boot frame, `hosted-booting`) is the only thing allowed in between.
- A token that the API guard rejects behaves like it does on a fresh load:
  the token is cleared and the page settles on a usable signed-out sign-in
  page, not a dead one.

### 2. A restored sign-in page without a session is usable

- The same restore with no stored token leaves the page identical to a fresh
  signed-out load (E165): `phase.busy` is false, the sign-in button
  (`hosted-sign-in-microsoft` in azure mode, `hosted-sign-in-submit` in local
  mode) is enabled, and no stale error from a previous attempt is shown.
- Back → Forward → Back does not accumulate state: each re-show re-evaluates
  from scratch, so repeated restores cannot leave the page stuck busy or
  double-run the boot resolve.
- The PRD 020 Req 9 deep-link intent is not damaged by any of this: a
  restore must not consume or clobber a `sessionStorage` visit intent or
  pending sign-in that a still-in-flight sign-in will need.

### 3. A disabled sign-in button is never shown without explanation

- While a sign-in redirect is in flight (`phase.busy`), the page shows a
  visible status — e.g. "Signing you in…" — alongside or in place of the
  disabled button, in both the azure and the local branch. It carries a
  stable test id (suggested `hosted-sign-in-status`) and an appropriate live
  role (`role="status"`), matching the treatment of the existing error
  paragraph (`hosted-sign-in-error`, `role="alert"`).
- Styling follows what the page already cites: the splash shape (SPEC27 §3,
  issue #196) and `docs/STYLE-GUIDE.md` — reuse `.hosted-signin-*` /
  existing chrome tokens, no one-off colour, size or font literals, no new
  card box or title text on this page.
- The failure path is unchanged in kind: an error still replaces the status
  and re-enables the button (E168).

### 4. No regression on the flows that already work

- E165 (signed-out visit shows only the sign-in page), E166 (local mock sign-in
  reaches the app shell), E167 (session survives a reload), E168 (failed
  sign-in shows the on-page error and the guard still 401s), E215 (sign out),
  E390/E391 (splash styling and badge anchoring) all pass unmodified in
  substance; if any needs an edit it is because the contract changed here, and
  the edit is to the new contract rather than a deletion.
- PRD 007 Req 5 still holds: nothing of the app — editor, sidebar, menus,
  document content — renders pre-auth on any restore path.
- Swapping `window.location.assign` for `window.location.replace` at
  `HostedSignIn.tsx:527` (so the sign-in page drops out of the back stack) is
  an acceptable part of the fix, but is not sufficient on its own: criteria
  1–3 must hold regardless, because Back behaviour after that point is
  Microsoft's history handling, not ours.
- Desktop (Tauri) and single-file web builds are untouched: this is
  hosted-only code, and the bundle scan's single-network-call-site rule
  (`hostedFetch`, SPEC11 §6.6) still passes.

### 5. Tests, citations and the gate

- Unit coverage exists for the restore decision. `tests/unit` runs in the
  **node** environment with no React renderer (`vitest.config.ts`), so the
  decision must be expressed as a pure, exported helper — in `src/lib/`
  (e.g. beside `hostedGate.ts` / `hostedBootHold.ts`) rather than inline in
  the component — and tested for both branches of criteria 1 and 2: restore
  with a stored token → resolve the session; restore without one → reset to a
  clean signed-out page; a non-persisted `pageshow` (the ordinary first load)
  → no extra work.
- E2E coverage exists where the local mock-auth lane can drive it
  (`tests/e2e/hosted.spec.ts`): at minimum the busy status of criterion 3,
  which can be held on screen by delaying `**/api/auth/sign-in` with
  `page.route`, and the restore handling to whatever depth a synthetic
  `pageshow`/re-show can reach. New tests take fresh `E<n>` numbers in the
  file's house style; the desktop-shim e2e collection stays at or above
  `E2E_TEST_FLOOR` in `scripts/validate.mjs`.
- The Entra (`mode === 'azure'`) branch cannot be driven in e2e, so the
  implementer's issue comment carries an explicit manual-verification section:
  either the dogfood results from the Azure deployment (sign in → Back, and
  sign in → Back → Forward, each ending in the app or on a usable sign-in
  page), or — if that deployment is not reachable from the session — a clearly
  labelled note saying so plus those exact steps for the owner to run. Do not
  claim a verification that did not happen.
- Citations agree with the code: new and changed behaviour carries the house
  citation comment naming the contract it implements (`PRD 007 Req 5`,
  `PRD 020 Req 9`, issue #242 — there is no `SPEC<n>` for hosted auth), and
  `docs/MAP.md` matches what `npm run map` derives if citations or E-numbers
  moved (the quick gate diffs it).
- Iterate with `npm run typecheck` and `npm run test:unit` (plus targeted
  `npx playwright test -g '<title>'` runs for the touched hosted tests). Run
  `npm run validate:quick` **once**, right before declaring the goal met — not
  after every change, and not as a start-of-attempt baseline beyond that same
  quick tier — and it prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #242 describing what
  changed, the manual-verification section above, and the gate evidence.

## Context

Everything lives in `src/components/HostedSignIn.tsx`. `signInMicrosoft`
(~line 491) sets `{ kind: 'signed-out', error: null, busy: true }` and then
does a full-page `window.location.assign(authorizeUrl)` (~line 527); only the
failure paths clear `busy`, so a bfcache restore brings the page back with
`busy: true` frozen in React state. The button is `disabled={phase.busy}`
(~line 634) and the only explanatory text is the error paragraph, which
renders only when `phase.error` is set (~line 648) — hence a badge and a dead
button. The boot effect (~lines 394–462) that would notice the stored token
runs on mount only, so a restored page never re-checks it.

Session/storage helpers are exported from `src/lib/hostedGate.ts`
(`readStoredToken`, `clearToken`, `takePendingSignIn`, `storeVisitIntent`,
`takeVisitIntent`), and the boot holding frame from `src/lib/hostedBootHold.ts`
— both already unit-tested (`tests/unit/hosted-gate.test.ts`,
`hosted-boot-hold.test.ts`), which is the pattern criterion 5 asks for. The
served HTML sets no `Cache-Control`, and `server/` has no header for it; the
fix stays client-side, as the owner's triage comment concluded.

Grep before opening files (`rg 'PRD 007' src`, `rg 'PRD 020' src`) and never
read `src/App.tsx` end-to-end.
