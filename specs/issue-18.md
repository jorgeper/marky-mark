# Spec: macOS release e2e suite is unstable: one-shot sampling of async-settled UI state (#18)

## Goal

All acceptance criteria in specs/issue-18.md are satisfied for issue #18, with
evidence visible in the session: every one-shot read of animation- or
observer-driven UI state in `tests/e2e/app.spec.ts` has been converted to an
auto-retrying assertion (`expect.poll` / web-first `expect`) on the property
actually under test, E129's `add-comment-btn` click no longer races the
transitioning toolbar shell, no assertion is weakened, skipped, forced or
deleted and `retries` stays `0` in `playwright.config.ts`, the audit is
recorded site-by-site (converted, or deliberately left alone and why),
`npm run validate:quick` prints `QUICK VALIDATION: ALL PASSED`, and a summary
comment from the implementer exists on issue #18.

## Acceptance criteria

- **E129 is fixed** (the one outstanding failure from the issue's table). In
  `tests/e2e/app.spec.ts` E129 (~line 5340), the
  `page.getByTestId('add-comment-btn').click()` that timed out for 30s with
  `.docname` inside `.toolbar-shell` intercepting pointer events now cannot be
  covered by the toolbar at click time — either because the test no longer
  parks the pointer in the top hot zone before selecting, or because it waits
  for the shell to settle out of the way, or because the button is provably
  clear of the shell's rect before the click. The fix is a real settle/avoid,
  **not** `{ force: true }`, not `dispatchEvent`, not a bumped timeout: the
  intercepted-click failure mode must be gone, not merely slower to fire.
- **The sweep is done, not sampled.** Every read in `tests/e2e/app.spec.ts` of
  a value the app settles asynchronously — `getComputedStyle`,
  `getBoundingClientRect`, `boundingBox()`, `evaluate` on transform/scroll
  geometry, `textContent`, `inputValue` — that is taken *immediately* after an
  action that defers state is either wrapped in `expect.poll` (or an equivalent
  auto-retrying `expect`) on the property under test, or explicitly left alone
  with a one-line reason. The deferring actions to look for are the ones named
  in the issue: menu toggles, theme changes, margin/settings changes, pane
  slides (`paneSlide.ts`, ~180ms + ~2 rAFs — #5, #8), split-column changes
  (#7), gutter changes (`Editor.tsx:1238` — `.gutter-inset` applied in a
  `requestAnimationFrame` scheduled by a `ResizeObserver`, #10/#12), and the
  toolbar shell's own 180ms show/hide transition (`src/styles.css:66`).
- **Assertions are preserved exactly.** No threshold is loosened, no
  `toBe`/`toMatch` becomes a weaker matcher, no test is `skip`ped, `fixme`d,
  renamed away or deleted, and no `.click()` gains `{ force: true }` to paper
  over an overlap. `git diff` on `tests/e2e/app.spec.ts` shows waiting added
  and one-shot reads relocated — nothing asserted less. Test count stays at
  136 or grows; the E-id set is unchanged.
- **The retry knob is untouched.** `playwright.config.ts` still has
  `retries: 0` and `workers: 2`; the issue explicitly rejects `retries: 1` as a
  fix. `webServer.timeout` and per-test timeouts are not raised as a substitute
  for waiting on the right thing.
- **The five known local flakes are each accounted for**: E15 (line 325), E101
  (3625), E102 (3694), E119 (4611) and E129 (5340) are each either changed, or
  named in the summary comment with a one-line reason why they were found sound
  as written. "Passed on my run" is not a reason.
- **Shared helpers carry the fix where the race is shared.**
  `tests/e2e/helpers.ts`'s `addComment()` performs the same
  `add-comment-btn` click as E129 and is used by 29 tests — if the E129 race
  can reach that helper, the guard lives in the helper rather than being
  copy-pasted per call site. `revealToolbar`, `openSettings` and
  `openWelcomeViaHelp` all drive the toolbar and are the natural home for any
  "toolbar has settled" wait.
- **The convention is written down** so the next deferred-state feature does
  not re-introduce the bug: a short note (a few lines, not a new document) in
  `docs/DEVELOPING.md` — under "Odds and ends" or a small sibling section —
  says that e2e reads of animation- or observer-driven state must poll rather
  than sample once, and names the two model commits (`07da43e` for E25,
  `75b92ae` for E136) or the pattern they use. Frozen spec documents under
  `docs/specs/` are not edited: `git diff --stat docs/specs` is empty.
- **App code is unchanged unless a genuine product defect is found.** The issue
  states no shipped behaviour is wrong, so the diff is expected to be confined
  to `tests/e2e/**` plus the `docs/DEVELOPING.md` note. If the implementer does
  identify a real app-side defect (e.g. a hidden `.toolbar-shell` that still
  swallows pointer events), fixing it is in scope — but the summary comment
  must say what the defect was and why the test-side fix alone was not honest.
- **Stability is demonstrated, not asserted.** The touched tests have been
  re-run under repetition in the implementer's session and passed every time —
  e.g. `npm run test:e2e -- -g "E129" --repeat-each=3`, and once more with
  extra scheduling pressure (`--workers=8`) to widen the sampling window the
  way a slower macOS runner does. The command and its output are quoted in the
  summary comment.
- **Test economy.** The implementer iterated with `npm run typecheck` and
  targeted e2e runs (`npm run test:e2e -- -g "E129"`), used the quick tier only
  for any baseline, and ran the full gate below exactly once, right before
  declaring the goal met — not after every change.
- `npm run validate:quick` has been run in the implementer's session and
  printed `QUICK VALIDATION: ALL PASSED`. (It runs the whole desktop-shim e2e
  suite, which is the suite under repair here, so it is the right and
  sufficient gate; the full `npm run validate` adds only web/bundle steps this
  change cannot touch.)
- A summary comment from the implementer exists on issue #18, listing the sites
  converted, the sites deliberately left alone with reasons, what E129's actual
  race turned out to be, and the gate + repetition evidence.

## Context

The suite is one 6,376-line file, `tests/e2e/app.spec.ts` (136 tests, run by
`npm run test:e2e` → `playwright.config.ts`, `retries: 0`, `workers: 2`, dev
shim at port 4923). It already uses `expect.poll` in ~212 places, so the fix is
consistency work, not a new technique.

Two commits are the model and worth reading first: `07da43e` (E25 — poll the
slide-out transform) and `75b92ae` (E136 — poll for the rAF-scheduled gutter
rules). Both add a poll and change no assertion.

E129 hypothesis worth checking before anything else: at ~line 5378 the test
does `await pane.click({ position: { x: 10, y: 10 } })`. With the split preview
starting at the top of the workspace, that lands the pointer inside
`.toolbar-hotzone` (`src/styles.css:86`, 20px tall) and *leaves it there*,
which reveals `.toolbar-shell` (`src/styles.css:66` — `z-index: 80`,
`transition: transform 180ms`) over the top ~42px for the rest of the test. Any
floating `add-comment-btn` that lands in that band is then intercepted by
`.docname`. Confirm or refute this rather than assuming it — a headed run or a
trace (`npm run test:e2e -- -g "E129" --trace on`) will show it directly.

The deferred-state sources the issue names: `src/components/Editor.tsx:1238`
(`.gutter-inset` via `requestAnimationFrame` inside a `ResizeObserver`),
`src/lib/paneSlide.ts` + `--mm-slide-ease` (180ms slides starting ~2 rAFs after
a toggle), and the toolbar shell's own transition. `TOOLBAR_WAIT` (3200ms) at
the top of the spec file already encodes the grace + hide delay.

Reproducing on Linux is the hard part — E136 passed locally and failed on the
macOS runner. Widening the window artificially (more workers, `--repeat-each`,
Chromium CPU throttling via CDP) is more productive than re-running as-is.
