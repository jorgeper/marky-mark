# Spec: marky mark icon moves (#200)

## Goal

All acceptance criteria in issue-specs/issue-200.md are satisfied for issue #200, with evidence visible in the session: the big Marky Mark badge occupies the same viewport position (no vertical shift) across the hosted sign-in screen, the "Checking session…" screen, and the post-login splash, with the splash's badge position as the reference; all pre-auth sign-in page text renders in the app's body font (`--mm-font-body` sans stack) instead of the browser's default serif; `npm run validate:quick` passes in the implementer's session; and a summary comment from the implementer exists on issue #200.

## Acceptance criteria

- At any given viewport size, the big badge's rendered bounding box is
  identical (same position, same 132px size) on all three screens of the
  hosted flow: (1) the signed-out sign-in screen — both the azure
  "Sign in with Microsoft" variant and the local-mode username form,
  including when an error message is showing, (2) the
  "Checking session…" screen, and (3) the post-login landing splash (the
  one showing the version, alpha note, and meta lines). The shared
  position is the splash's badge position — the pre-auth screens match
  the landing screen, not the other way into some new layout.
- The badge's position no longer depends on the height of the content
  below it (hint vs. button vs. form vs. splash text): advancing through
  the flow produces no vertical movement of the icon. In practice this
  means anchoring the badge (absolute positioning or equivalent) rather
  than letting the flex-centered column height determine it. If the
  splash's own layout is touched to achieve this, its visible design must
  be preserved (badge above version/meta/drop-hint/start actions, all
  still centered) and the existing splash e2e tests (E78, E1, E87 — see
  `docs/MAP.md` row SPEC27) must still pass unmodified in intent.
- All text on the pre-auth hosted page — "Sign in with Microsoft",
  "Checking session…", the local-mode hint/placeholder, and error
  messages — renders in the app's body font: `.hosted-signin` (or an
  equivalent pre-auth root) declares
  `font-family: var(--mm-font-body, …)` with the same sans-serif
  fallback stack used at `src/styles.css` `.theme-root`, because the
  pre-auth page mounts outside `.theme-root` and currently falls back to
  the browser default serif (the "Times New Roman" the issue reports).
- Automated coverage exists for the fixed behaviours: an e2e test (the
  hosted suite `tests/e2e/hosted.spec.ts` already drives the sign-in
  flow) asserts the badge's bounding box on the sign-in screen equals
  its bounding box on the splash after signing in, and asserts the
  pre-auth text's computed font is not a serif fallback (or equivalently
  that `.hosted-signin` carries the body-font declaration).
- New/changed code carries `// SPEC<n> §x.y` / issue citation comments
  per `.sandcastle/CODING_STANDARDS.md`.
- Iteration was done with `npm run typecheck` and `npm run test:unit`
  (plus individually targeted Playwright tests via
  `npx playwright test -g '<title>'` when debugging one behaviour); the
  full gate `npm run validate:quick` was run ONCE, right before declaring
  the goal met — not after every small change and not as a baseline —
  and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #200.

## Context

The pre-auth page is `src/components/HostedSignIn.tsx` (`HostedShell`,
mounted from `src/main.tsx` when the hosted marker is present); it renders
`<AppBadge size={132}>` inside `.splash-mark` within `.hosted-signin`
(`src/styles.css` ~line 3522), a fixed full-viewport flex column that
centers badge + controls together — so the badge's vertical position
shifts as the phase content changes. The landing splash is in
`src/App.tsx` ~line 7151 (`.splash` inside `.empty-center`,
`src/styles.css` ~lines 1593–1660), flex-centered as a whole block —
a third, different badge position. The font bug: `--mm-font-body` is
applied on `.theme-root` (`src/styles.css` line 38), which only exists
inside `<App/>`, so everything in `.hosted-signin` inherits the browser
serif default. Grep `SPEC27` for the splash contract and issue #196 for
the recent sign-in restyle. Hosted e2e helpers/fixtures live in
`tests/e2e/hosted.spec.ts` (E160–E168 area).
