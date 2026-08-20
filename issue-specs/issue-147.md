# Spec: Tabs on top: overflow — scroll arrows, wheel scrolling, scroll-active-into-view (#147)

## Goal

All acceptance criteria in issue-specs/issue-147.md are satisfied for issue
#147, with evidence visible in the session: when the file tab strip's tabs
exceed its width the strip scrolls horizontally instead of clipping them —
left/right arrow buttons appear at the strip's ends and scroll it, each
disabled (or hidden) at its end of the range and absent/inert when everything
fits; wheel and trackpad scrolling over the strip scrolls it too, without
scrolling or bouncing anything else; and activating a file by ANY means
(sidebar row click, tab click, Ctrl+Tab cycling, boot restore) leaves its tab
scrolled into view; the scroll/overflow math lives in `src/lib/` with unit
tests; new e2e coverage from E299 exists in `tests/e2e/file-tabs.spec.ts`;
`npm run validate:quick` has been run in the implementer's session and passes;
and a summary comment from the implementer exists on issue #147.

## Acceptance criteria

### The strip scrolls

- The tabs in `src/components/FileTabStrip.tsx` live in a horizontally
  scrollable rail: with more tabs than fit, the strip's own tabs can be
  brought into view by scrolling rather than being clipped away
  unreachably. The strip stays exactly one row and exactly
  `--mm-tabstrip-h` tall — tabs never wrap, the strip never grows, and no
  native horizontal scrollbar is visible in the strip (the `overflow:
  hidden` on `.file-tab-strip` in `src/styles.css`, whose comment currently
  defers this work to issue #147, is replaced by the scroll treatment and
  the comment updated to describe what ships).
- Tab sizing is unchanged from issue #144 (max width 160px, ellipsis label,
  full-path tooltip): tabs do not shrink to fit — overflow is what happens
  instead.

### Arrows

- When the tabs exceed the strip's width, a left and a right arrow button
  render at the strip's ends (outside the scrolling rail, so they stay put
  while the rail scrolls) and each scrolls the rail toward its own end by a
  step. When the tabs fit, neither arrow occupies strip space (hidden/not
  rendered) — a one- or two-tab strip looks exactly as it does today.
- Each arrow is disabled (or hidden) at its end of the range: at
  `scrollLeft === 0` the left arrow is not actionable, at the maximum
  scroll position the right arrow is not actionable, and that state updates
  as the rail scrolls, as tabs are added/removed/renamed, and as the strip's
  width changes (window resize, folder-pane open/close and width drag,
  split/preview layout changes). A resize that removes the overflow removes
  the arrows.
- The arrows are real keyboard-reachable `button`s with accessible labels
  and stable `data-testid`s (suggested `file-tab-scroll-left` /
  `file-tab-scroll-right`, distinct from every existing `file-tab*` testid),
  styled from existing theme variables — **no new required theme keys** and
  no new plane/shadow work: the PRD R10–R12 visual treatment is issue #148's.
- Clicking an arrow never activates, closes or reorders a tab; the open set
  is untouched by any scrolling.

### Wheel / trackpad

- Horizontal wheel/trackpad scrolling over the strip (a `wheel` event with
  horizontal delta) scrolls the strip.
- A plain vertical wheel over the strip also scrolls it horizontally — a
  mouse with no horizontal axis must still be able to reach the hidden tabs
  (the "common way/UX" issue #139 asks for). Decide and cite this mapping
  explicitly in the code comment.
- While the strip consumes a wheel event it does not also scroll or bounce
  the document, the preview, the sidebar or the page; when the strip is at
  an end of its range and cannot move further, the event is not swallowed in
  a way that breaks the surrounding scroll behaviour.

### Scroll active into view

- Whenever the active document changes, its tab ends up fully within the
  strip's visible range — reached from ANY activation path: clicking a
  sidebar open row, clicking a tab, `Ctrl+Tab` / `Ctrl+Shift+Tab` cycling,
  opening a file from the tree/recents, and boot restore of a persisted
  session (the restored active file's tab is in view on first paint, without
  the user touching anything).
- The reveal is horizontal-only and minimal: it scrolls no further than
  needed to bring the tab into view (nearest-edge, not centre-always), and
  it never disturbs any other scroll position (editor, preview, sidebar,
  page). `FolderPanel.tsx`'s reveal effect (`src/components/FolderPanel.tsx`,
  the `p.selectedPath` effect that saves/restores `scrollLeft` around
  `scrollIntoView`) is the mold — the analogue rotated to the horizontal
  axis.
- The reveal does not fight the user: scrolling the strip by arrow or wheel
  without changing the active file leaves the strip where the user put it
  (no snap-back to the active tab).
- The untitled tab (PRD 013 Req 8) participates: with enough open files to
  overflow, File → New leaves the "Untitled" tab in view.

### Structure, tests and gate

- The overflow/scroll math is **pure logic in `src/lib/`** with unit tests —
  extend `src/lib/fileTabs.ts` and `tests/unit/file-tabs.test.ts` rather than
  adding a parallel module. At minimum: deriving arrow enabled/disabled (and
  overflow-present) state from a `{ scrollLeft, clientWidth, scrollWidth }`
  measurement, the clamped scroll target for an arrow step, and the clamped
  target that brings a tab at a given offset/width into view (already-visible
  ⇒ no movement). Sub-pixel tolerance is handled so a fully-scrolled rail
  reads as "at the end" rather than one pixel short.
- New e2e coverage lands in `tests/e2e/file-tabs.spec.ts` at the next free E
  numbers (E299+; verify uniqueness across `tests/e2e/` before numbering) and
  exercises at least: no arrows with a strip that fits; arrows appearing once
  enough tabs are open (force overflow with many seeded files and/or
  `page.setViewportSize`, as `tests/e2e/tables.spec.ts` does); each arrow
  disabled/absent at its end and actionable in between; an arrow click moving
  the rail; wheel scrolling moving the rail; the active tab in view after
  activation from a sidebar row, from `Ctrl+Tab`, and after a restart's boot
  restore; and the open set unchanged by all of it.
- Existing behaviour is unchanged: presence/absence rules, tab activation and
  the active-tab no-op, labels/tooltips, the dirty ●/✕ swap, middle-click
  close, the tab context menu and its walks, the View ▸ File Tabs toggle and
  its persisted setting (E266–E298 keep passing untouched, other than
  additions needed for the new markup).
- The web build is untouched (PRD 013 non-goal — the strip is desktop-only
  behind `tabStripSeam`); the W tests stay unchanged; no new setting and no
  new state of record is introduced (scroll position is transient UI state,
  not persisted).
- Every new or changed behaviour site carries a citation comment per
  `.sandcastle/CODING_STANDARDS.md` and `docs/COMMENT-FORMAT.md` (PRD 013
  Req 9 is the requirement this issue closes).
- `docs/MAP.md` is regenerated with `npm run map` if citation sites changed
  (the validation gate diffs it against the generator's output); it is never
  hand-edited.
- Iterate with `npm run typecheck` and `npm run test:unit` (or a single
  targeted e2e via `npx playwright test -g '<title>'`) — not the full suite,
  and not a full-suite baseline at the start of the attempt. Run
  `npm run validate:quick` ONCE, right before declaring the goal met, and it
  prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #147.

## Context

PRD 013 Req 9 (`prd/013-tabs-on-top.md`) is the requirement; the strip itself
already exists from issues #144 (presence, tab list, activation, labels,
toggle), #145 (dirty ●/✕, middle-click, context menu) and #146 (the untitled
tab). #144 is closed, so this issue is unblocked. The remaining PRD 013 work —
the plane/shadow visual treatment (#148) and the e2e sweep (#149) — is **not**
this issue's; keep the arrows plain and theme-variable driven.

Files: `src/components/FileTabStrip.tsx` is the whole component (props in,
callbacks out, no platform access beyond the `basename` seam) — the tabs are
mapped from `p.openFiles` with the untitled tab appended. `src/styles.css`
around line 2268 holds `.file-tab-strip` (currently `overflow: hidden` with a
comment naming this issue) and the `.file-tab*` rules; `--mm-tabstrip-h`
(line 2257) is the strip height that must not change. The render site is
`src/App.tsx` (~line 6727, inside `.workspace-stack`), where `showFileTabs`,
`openFiles`, `docPath` and `untitled` are in scope — the active path the
reveal keys off is `activePath` inside the component, so the reveal effect
belongs there rather than in App.

`src/components/FolderPanel.tsx` (~line 560) shows the reveal-on-selection
effect and the trick of preserving the cross-axis scroll offset around
`scrollIntoView`; `src/lib/fileTabs.ts` + `tests/unit/file-tabs.test.ts` are
the existing pure-logic pair to extend. E2e setup helpers live in
`tests/e2e/helpers.ts` (`freshApp`, `seedFolders`, `openNotesRoot`, `fsWrite`)
— `seedFolders` seeds only a handful of files, so an overflow test will need
to `fsWrite` more of them and/or narrow the viewport.
