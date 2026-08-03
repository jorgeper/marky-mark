# Spec: animation smoothing (#8)

## Goal

All acceptance criteria in issue-specs/issue-8.md are satisfied for issue #8, with
evidence visible in the session: the folder-pane and split-preview open/close
slides run on a shared, expressive acceleration/deceleration curve applied to
every transition that participates in a slide (transform *and* width, so the
pane edge and the editor edge stay in step), `prefers-reduced-motion` still
switches both panes instantly, automated coverage asserts the motion is
measurably non-linear, `npm run validate:quick` prints
`QUICK VALIDATION: ALL PASSED`, and a summary comment from the implementer
exists on issue #8.

## Acceptance criteria

- The two pane open/close slides — folder pane (left) and split preview
  (right), PRD 003 Reqs 9–12 — animate on a custom `cubic-bezier` curve with
  a pronounced accelerate-then-decelerate character, not the browser `ease` /
  `linear` / `ease-in-out` keywords they use today. Opening reads as easing
  into its resting position; closing reads as picking up speed on its way off
  the edge. Choosing a single expressive symmetric curve is acceptable only if
  the enter/exit character above is still legible in the sampled motion.
- The curve is defined once — a motion token (e.g. a `--mm-slide-ease` custom
  property) in `src/styles.css` — and referenced by **all four** slide
  transitions: `.folder-slide.sliding` (width),
  `.folder-slide.sliding .folder-panel` (transform),
  `.workspace.split.preview-sliding .split-editor` (width) and
  `.workspace.split.preview-sliding .split-preview` (transform). A pane whose
  transform and companion width run on different curves tears mid-flight; the
  criterion below tests for it. This is an internal stylesheet token, not a
  new theme variable — `THEMES.md` and the `themes/*.css` files are untouched.
- Timing stays self-consistent. If the slide duration changes, `SLIDE_MS` in
  `src/lib/paneSlide.ts` changes with it, `SLIDE_SETTLE_MS` still outlasts the
  full animated run (including any overshoot tail), and U123's `SLIDE_MS`
  assertion plus E133's title/comments (which say "180ms") are updated to
  match. If the duration is unchanged, all three keep saying 180ms.
- If the chosen curve overshoots, the overshoot stays contained: no frame of
  either slide produces a horizontal scrollbar, a visible gap at the seam, or
  a pane overlapping content it does not own at rest.
- `prefers-reduced-motion: reduce` still switches both panes instantly with no
  slide (PRD 003 Req 11). The `@media (prefers-reduced-motion: reduce)`
  carve-out in `src/styles.css` covers every transition the new token touches,
  and E133's reduced-motion block stays green unmodified.
- Everything else about the slides is unchanged: the `paneSlide.ts` phase
  machine and mount lifecycle, the chevron / menu / hotkey / Settings-checkbox
  toggles and their sync, and `showFolders` / `splitEdit` persistence to
  `settings.json`. No new persisted setting or state key.
- The change is scoped to the two pane slides. The toolbar auto-hide slide
  (`.toolbar-shell`), the preview/edit mode swap, and every other transition in
  `src/styles.css` keep their current motion — E25 stays green.
- Automated coverage exists for the new motion: E133 is extended (or a new
  numbered desktop e2e — E135 is the next free id — is added) that, from the
  existing per-frame `transform` sampler, asserts (a) the motion is measurably
  non-linear — the pane's position at the midpoint of the sampled slide
  deviates from straight linear interpolation between the endpoints by a clear
  margin (≥10% of the travel distance) — and (b) during the split-preview
  slide the editor's right edge tracks the preview's left edge within a few px
  on every sampled frame. Existing assertions are extended, never weakened,
  skipped, or deleted.
- The implementer iterated with `npm run typecheck`, `npm run test:unit`, and
  e2e targeted at the changed behavior (`npm run test:e2e -- -g "E133"`), and
  ran the full gate below exactly once, right before declaring the goal met —
  not after every change. Any baseline at the start of the attempt used the
  quick tier only.
- `npm run validate:quick` has been run in the implementer's session and
  printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #8, naming the files
  changed, the curve chosen (and why it reads as acceleration/deceleration),
  and the gate evidence.

## Context

The "open and close animations" are the pane slides that landed with
`prd/003-pane-chevrons-and-slide-animations.md` (Reqs 9–12): the folder pane
slides from/to the left edge, the split preview from/to the right, both
currently `180ms ease` — the same flat curve the toolbar uses, which is why
they feel unremarkable. This issue is a motion-design change on top of that
work, not a behavior change.

Where things live: `src/lib/paneSlide.ts` is the pure phase machine
(`closed → pre-open → opening → open → closing → closed`) plus `SLIDE_MS` /
`SLIDE_SETTLE_MS`; `src/App.tsx` wires it (layout effect, rAF pre-open frame,
settle timer) and emits the `sliding` / `out` class hooks; `src/styles.css`
holds the four transitions and the `prefers-reduced-motion` carve-out (search
`folder-slide`, `preview-sliding`). Tests: `tests/unit/pane-slide.test.ts`
(U123) and `tests/e2e/app.spec.ts` E133, which already contains a per-frame
in-page `transform` sampler — reuse it rather than inventing a new harness.
E84/E94/E95 cover the toggle-surface sync that must keep passing.

Note the slide is a transform on the pane *plus* a width transition on its
neighbor moving in lockstep — that pairing is why the easing has to be one
shared token. The web build has no folder pane; the change is CSS-only there,
so the web suites are only exercised by the full `npm run validate` gate,
which this spec does not require.
