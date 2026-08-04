# Spec: Comments not working for latest Windows download (#38)

## Goal

All acceptance criteria in specs/issue-38.md are satisfied for issue #38, with
evidence visible in the session: every conjunct of the floating "Add comment"
gate (`src/App.tsx:4347`) has a written, test-backed verdict on whether it can
produce the reported symptom; selecting text in **plain edit mode** no longer
dead-ends — it surfaces a comment affordance that lands a real comment on that
selection; a native-menu install that fails or is unsupported no longer leaves a
desktop platform with neither a menu nor the in-app toolbar; new numbered tests
(U155+ / E141+) fail if any of that regresses; `npm run validate:quick` has been
run once and printed `QUICK VALIDATION: ALL PASSED`; and a summary comment from
the implementer exists on issue #38 stating what was and was not reproduced and
what still needs to be asked of the reporter.

## Acceptance criteria

### The gate has a verdict, not a guess

The button renders only when all six conjuncts hold (`src/App.tsx:4347`):

```
selInfo && showComments && settings.commentsEnabled && !pending && commentSurfaceUp && !authoringFrozen
```

- The implementer's summary comment carries a per-conjunct verdict table: for
  each one, whether it is already covered by a test, whether it can produce
  "no affordance on selection", and whether it is plausibly platform-specific.
  This is the deliverable the issue's "Notes for whoever picks this up" asks
  for — it must be grounded in the code, not restated from the issue body.
- Two verdicts are already determinable from the code and must be stated
  explicitly (correcting the issue's hypotheses where the code disagrees):
  - `commentSurfaceUp` (`src/App.tsx:3946`) is `mode === 'preview' || (mode ===
    'edit' && settings.splitEdit)`. Plain edit mode has **never** offered the
    button, on any platform. This is a real, reproducible, platform-independent
    dead end — see the next section.
  - `authoringFrozen` is `hasUnreadableStore(stores)` (`src/App.tsx:220`), which
    is set **only** when a store declared a comment-format version this build
    cannot interpret. A sidecar that fails to read for OS reasons — permissions,
    OneDrive, `Program Files`, a path that does not resolve — is swallowed by the
    `catch` at `src/App.tsx:1036` and leaves the verdict *clean*, and a payload
    with no `version` key reads at 1.0.0 (`readCommentPayload`,
    `src/lib/commentFormat.ts:333`). So the issue's hypothesis 2 as written
    (Windows path/permission trouble → frozen doc) is **not** reachable through
    this code path. Say so, and say what the residual risk is (a genuinely
    newer-format sidecar), rather than leaving it as an open suspicion.
- Coverage gaps in the gate are closed with new e2e tests (E141 onward — E140 is
  the current maximum in `tests/e2e/app.spec.ts`; numbers are never reused, per
  `CONTRIBUTING.md`). E36 already covers `commentsEnabled` off and E138–E140
  cover `authoringFrozen`; the conjuncts with no test of their own today
  (`showComments` off with `commentsEnabled` on, an open composer suppressing a
  second button, and the plain-edit-mode surface) get one.

### Plain edit mode no longer dead-ends

- With comments enabled, selecting text in plain edit mode (`mode === 'edit'`,
  `settings.splitEdit` false) surfaces a discoverable comment affordance, and
  acting on it results in a comment anchored to **that** selection. Today it
  offers nothing at all, and there is no menu item or command to fall back on —
  `buildMenuSpec` (`src/lib/menuSpec.ts:190`) exposes only toggle/next/prev, never
  "Add comment". A user who highlights words while editing has literally no
  route to a comment, which is exactly the reported symptom.
- Anchoring correctness is not traded for discoverability. Comments anchor to
  **rendered** offsets (`rangeToOffsets` over the preview DOM), so the affordance
  must not invent an anchor from source offsets. The machinery to bridge this
  already exists and should be reused rather than reinvented: `toggleMode`
  (`src/App.tsx:2454`) parks the editor selection in `pendingPreviewSelRef`, and
  the `useLayoutEffect` at `src/App.tsx:3494` (SPEC25 §2) re-establishes it as a
  native preview selection once the preview DOM is final — which then feeds
  `selInfo` through the existing effect at `src/App.tsx:3808`. Routing the
  edit-mode affordance through that carry (switch surface, then compose) is an
  acceptable and preferred implementation; so is showing the button directly if
  the anchor it produces is the same one preview would produce.
- The resulting comment is verified end-to-end by a new e2e test: select a phrase
  in plain edit mode, use the affordance, submit a body, and assert the comment
  card exists, the highlight covers the originally selected phrase, and the
  persisted store contains it.
- The affordance obeys the same gates as the preview one: nothing appears when
  `settings.commentsEnabled` is off, when `showComments` is off, or when the
  document is `authoringFrozen`. A new test covers at least the frozen case in
  edit mode, since PRD 004 Req 15 closes *every* authoring route.
- Preview and split-edit behaviour is unchanged: E37, E138–E140, and the other
  existing `add-comment-btn` assertions pass untouched.

### A desktop platform is never left with no chrome

- `nativeMenu` is inferred from mere capability existence — `!!platform?.setAppMenu`
  (`src/App.tsx:472`) — and when it is true the in-app toolbar does not render at
  all (`src/App.tsx:4049–4051`, SPEC12 §2.1). The install itself is fire-and-forget:
  `void platform.setAppMenu(...)` at `src/App.tsx:3039` has no `catch`. If the
  native menu fails to install, the user gets no menu **and** no toolbar — no
  Comments toggle, no mode switcher, no way to reach the settings that control
  any of this. That end state is consistent with the report and must be made
  impossible.
- Required end state: a `setAppMenu` that rejects (or is otherwise known not to
  have installed) results in the in-app toolbar rendering, so the app always has
  exactly one working menu surface. No unhandled promise rejection is left behind.
- The implementer establishes and records whether Tauri v2's
  `Menu.setAsAppMenu()` (`src/platform/tauri.ts:298`) actually installs a menu on
  Windows, or whether the Windows in-window menu bar needs
  `Menu.setAsWindowMenu(window)` instead — the comment at
  `src/platform/tauri.ts:252` claims "in-window menu bar on Windows", and that
  claim is unverified. If the correct call differs on non-macOS desktop, use it;
  if the answer cannot be established from the sandbox, say so in the summary
  comment and ship the fallback anyway. **The fallback is required regardless of
  what the investigation concludes** — it is what makes the failure survivable.
- A new test drives this: a shim platform whose `setAppMenu` rejects ends up with
  the toolbar visible. `src/platform/browser.ts:241` already attaches `setAppMenu`
  only under `?nativeMenu=1`, so the shim is the right place to exercise it.
- `docs/WINDOWS.md`'s closing claim — "Nothing else is macOS-specific" — is
  corrected if this investigation shows the menu path is macOS-specific.

### Regression guards and scope

- New numbered tests only: unit **U155** onward (U154 is the current maximum
  across `tests/unit/*.ts`), desktop e2e **E141** onward, web e2e **W13** onward
  if the web surface is touched. Numbers are never reused; existing tests are not
  weakened, skipped, renumbered, or deleted.
- Pure logic that can be unit-tested (any new predicate deciding where the
  affordance may appear) lives in a module under `src/lib/` with its own unit
  test, following the repo's existing split between pure helpers and `App.tsx`
  wiring. Do not add a dependency for any of this.
- Out of scope: no version bump (`package.json` is `0.4.0-alpha.5`, and the
  four version files are lock-stepped by `scripts/validate.mjs`), no edits to
  `docs/specs/*`, no changes to the comment containers (the trailer marker, its
  read alias, and the `<doc>.comments.json` sidecar filename are frozen by
  `CONTRIBUTING.md` rule 3), and no changes to the release workflows.
- The issue body and title are not edited — the issue text belongs to the owner.

### Gate

- The implementer iterated with `npm run typecheck` and `npm run test:unit` (or
  a tight target such as `npx vitest run tests/unit/<file>.test.ts`, and
  `npx playwright test -g 'E14'` for a single e2e), not the full suite after every
  change. Any baseline at the start of the attempt used the quick tier only.
- `npm run validate:quick` has been run **once**, in the implementer's session,
  right before declaring the goal met, and printed `QUICK VALIDATION: ALL PASSED`.
  This is the repo's configured verify command (`.sandcastle/config.mts:57`) and it
  includes the Playwright desktop-shim e2e suite, so the new E-tests are covered
  by it. The full `npm run validate` is welcome as extra evidence but is not
  required — note that `cargo check` cannot run in this sandbox (no cargo
  registry), so the full gate is expected to fail at that step for environmental
  reasons only.
- A summary comment from the implementer exists on issue #38 containing: the
  per-conjunct verdict table, what was reproduced and what was **not** (nobody
  has a Windows box here — do not claim a Windows repro), the files changed, the
  new test ids, the native-menu finding, and the gate output. It closes by
  restating the issue's open questions for the reporter, narrowed by what the
  investigation ruled out — at minimum: which mode the document was in, and
  whether any menu bar or toolbar was visible at all.

## Context

The gate lives at `src/App.tsx:4347`; the selection→`selInfo` effect that feeds it
is at `src/App.tsx:3808` and registers only for preview or split-edit.
`commentSurfaceUp` is `src/App.tsx:3946`, `authoringFrozen`/`hasUnreadableStore` at
`src/App.tsx:220`/`267`, and the sidecar read whose failures are swallowed is
`src/App.tsx:1024–1041`. The editor↔preview selection carry (SPEC25) is
`toggleMode` at `src/App.tsx:2454` plus the layout effect at `src/App.tsx:3494`;
`src/lib/selectionMap.ts` holds the pure mapping helpers on both sides.

The native-menu install effect is `src/App.tsx:3038`, `nativeMenu` is derived at
`src/App.tsx:472`, the toolbar is gated at `src/App.tsx:4049`, and the Tauri
implementation is `src/platform/tauri.ts:257–298`. The browser shim
(`src/platform/browser.ts:153, 241`) exposes `setAppMenu` only under
`?nativeMenu=1` — that is the seam the new test should use.

Test conventions: `CONTRIBUTING.md` (stable numbered ids, never reused, never
weakened). Highest ids today: U154, E140, W12. E36/E37 (`tests/e2e/app.spec.ts`
~lines 985–1035) and E138–E140 (~6300–6390) are the closest existing coverage,
and `tests/e2e/helpers.ts` has `selectPhrase` and `clickClearOfToolbar` (the
latter exists because the toolbar shell used to swallow this button's clicks —
issue #18).

Background: the reporter is on `Marky.Mark_0.4.0-alpha.5_x64-setup.exe`, built by
`.github/workflows/release-windows.yml` from the same tree as the macOS build, so
a divergent frontend is not a plausible cause. The issue thread has no replies —
the open questions are still open. `docs/WINDOWS.md` is the standing account of
what is and is not platform-specific.
