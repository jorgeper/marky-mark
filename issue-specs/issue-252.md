# Spec: Open Workspace dialog: fixed size with a loading indicator, show only the last few workspaces, no resize or scrollbar (#252)

## Goal

All acceptance criteria in issue-specs/issue-252.md are satisfied for issue
#252, with evidence visible in the session: the hosted Open Workspace dialog
opens at its final size and never resizes as the listing loads (a loading
indicator holds the list area, and the "No workspace matches …" empty state
appears only after the fetch settles with zero matches); the list shows at
most a fixed small number of most-recently-modified rows — the same cap when
the search box filters the whole deployment's listing — so the list area has a
fixed height and never scrolls; `npm run validate:quick` passes in the
implementer's session; and a summary comment from the implementer exists on
issue #252.

## Acceptance criteria

**No resize — the dialog opens at its final size**

- The Open Workspace dialog's rendered box is the same width and height from
  the moment it is visible through the listing arriving and the rows painting:
  loading changes nothing about its geometry. An e2e assertion pins this
  (e.g. the `open-workspace-dialog` bounding box captured while the loading
  indicator is up equals the box after `open-workspace-item-*` rows are
  visible).
- While `lifecycle.list()` is in flight, the list area shows a loading
  indicator (spinner or equivalent progress affordance) occupying the space
  the rows will take, carrying its own `data-testid` (e.g.
  `open-workspace-loading`) and an accessible role (`role="status"`, matching
  `search-scanning` in `src/components/SearchPanel.tsx`). When the listing
  arrives the indicator is gone and the rows are in its place.
- The `open-workspace-empty` ("No workspace matches …") element does not exist
  while the listing is loading. It appears only once the fetch has settled and
  the filtered result is genuinely empty — including for the settled
  zero-workspace deployment, where it is the state the user sees.
- The list area's height is fixed and independent of how many rows are in it:
  loading, one row, the full cap, and the settled-empty state all render the
  same height. The empty state and the loading indicator render *inside* that
  reserved area rather than below it.
- The no-access message (`open-workspace-no-access`) does not reflow the
  dialog either: choosing an inaccessible workspace leaves the dialog's height
  unchanged (its line is reserved, or the message overlays). The message
  itself still shows the same text it shows today (E184 stays green,
  unmodified).

**Only the last few workspaces — no scrollbar**

- The list renders at most a fixed small count of rows (5 unless the
  implementer has a stated reason for another number), most recently modified
  first, and that count is a named exported constant, not a literal sprinkled
  through the component.
- The cap is a pure, unit-tested seam in `src/lib/workspaceLifecycle.ts`
  (alongside `filterWorkspaces`), not inline slicing in the component's JSX.
  `filterWorkspaces` itself keeps returning the whole filtered list —
  U286/U287 in `tests/unit/workspace-lifecycle.test.ts` stay green and
  unmodified.
- Typing in the search box still matches across the whole fetched listing (no
  per-keystroke round trip; the fetch stays the single `useEffect` call), and
  still shows at most the same fixed number of rows — best matches first, with
  recency as the existing tie-break, so a search never changes the dialog's
  height.
- `.workspace-list` no longer scrolls: the `max-height: 260px` /
  `overflow-y: auto` pair in `src/styles.css` is gone, and no scrollbar can
  appear (asserted in e2e: the list element's `scrollHeight` is not greater
  than its `clientHeight`, with the deployment holding more workspaces than
  the cap).
- The New Workspace dialog is unchanged — no geometry, styling or behaviour
  change to `new-workspace-dialog`.

**Tests**

- Unit tests cover the new pure seam: an over-cap listing truncates to the cap
  most-recent-first, an under-cap listing is returned whole, and a query still
  truncates to the cap. New IDs above the current high-water mark U1195.
- E2E coverage in `tests/e2e/hosted.spec.ts` (the hosted lane owns this
  dialog) proves: the loading indicator is present before the rows and the
  empty state is not; the dialog's box does not change size across that
  transition; the row count never exceeds the cap with more workspaces than
  the cap in the deployment; and the list does not scroll. New IDs above the
  current high-water mark E502.
- Existing hosted e2e tests that reach a specific row without searching still
  pass with the cap in force. E183 (line ~972), E203 (~2053), E433 (~4313) and
  E434 (~4359) click `open-workspace-item-<id>` directly, and the local hosted
  lane's store is shared across parallel workers, so a target workspace can
  fall outside the newest few. Where that is now possible, the test types the
  workspace name into `open-workspace-search` first (a real user's route to
  the row) — tests are adjusted to the new contract, never weakened, skipped,
  or deleted, and their IDs are kept. E362 (~3081, the hidden row asserts
  `toHaveCount(0)`) must still prove absence rather than passing vacuously
  because of the cap.
- No existing `data-testid` is renamed.

**Repo hygiene and verification**

- Every behavioural change carries a citation comment in the house format
  (`.sandcastle/CODING_STANDARDS.md`) naming the contract — this dialog cites
  PRD 007 (`// PRD 007 Req 10/11 (issue #252): …`), including the CSS rules
  that own the fixed list height.
- Any CSS touched satisfies the style lint in `scripts/validate.mjs` and
  `docs/STYLE-GUIDE.md` (tokens for font-size / border-radius / box-shadow, no
  raw colour literals in chrome rules, no bare descendant element selectors).
- `docs/MAP.md` is regenerated with `npm run map` only if a `SPEC<n>` citation
  set changed; the e2e count floor in `scripts/validate.mjs` is a floor, so
  added tests need no edit there.
- Iteration used `npm run typecheck` + `npm run test:unit` (plus targeted
  `npx playwright test -g '<title>'` runs for the hosted tests being
  changed). The full gate was **not** run as a start-of-attempt baseline and
  not after every change.
- `npm run validate:quick` has been run ONCE at the end, in the implementer's
  session, and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #252, naming the
  chosen row cap and the validate:quick evidence.

## Context

Build applicability: hosted (cloud) only — the dialog mounts on the Platform's
`workspaces` capability, so the desktop and single-file builds never render
it. No platform branching is needed.

The three files that own this:

- `src/components/WorkspaceSwitcher.tsx:224` — `OpenWorkspaceDialog`. `all`
  starts `[]` and fills from the `lifecycle.list()` effect at :243; `shown =
  filterWorkspaces(query, all)` at :264; the empty state at :308 fires on
  `shown.length === 0`, which is exactly why it flashes during load. A third
  state (loading vs settled) is what the empty state must key off, not just
  emptiness.
- `src/lib/workspaceLifecycle.ts:121` — `filterWorkspaces(query, items)`:
  sorts `newestFirst` then `fuzzyFilter` (`src/lib/fuzzy.ts`, which returns
  items unchanged for an empty query and score-sorted, position-stable
  otherwise). The cap belongs next to it as its own exported function so both
  behaviours stay separately testable.
- `src/styles.css:3159` (`.dialog.workspace-modal`, `min-width: 420px`) and
  `:3177` (`.workspace-list`, the `max-height: 260px; overflow-y: auto` to
  drop). Row height comes from `.workspace-list-item` padding
  (`var(--mm-space-2) var(--mm-space-3)`); size the fixed list height from the
  cap and that row metric.

For the loading indicator, `search-scanning` / `.search-scanning-spinner`
(`src/components/SearchPanel.tsx:272`, `src/styles.css:2779`) is the existing
in-repo spinner idiom, tokens and keyframes included — reuse rather than
inventing a second one.

Tests: unit at `tests/unit/workspace-lifecycle.test.ts` (the
`PRD 007 Req 11: the Open Workspace list` describe block), e2e in
`tests/e2e/hosted.spec.ts` with helpers `signIn`, `signInTo`,
`createWorkspace`, `openAppMenu` from `tests/e2e/helpers.ts` /
`fixtures.ts`. The hosted lane runs inside the desktop-shim Playwright config
against the local server on port 4924, so these tests are part of
`npm run test:e2e` and of `npm run validate:quick`.
