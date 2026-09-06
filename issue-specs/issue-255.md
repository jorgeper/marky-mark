# Spec: Replace the Go to Heading palette with fuzzy search inside the sidebar's TOC view (#255)

## Goal

All acceptance criteria in issue-specs/issue-255.md are satisfied for issue
#255, with evidence visible in the session: the sidebar's TOC header carries a
search toggle that opens a text box fuzzy-filtering the document's headings in
place (a match jumps exactly as the palette did), the `⌘K` heading palette is
gone root and branch — View item, `headingPalette` command and hotkey, its
Hotkeys-tab row, `HeadingPalette.tsx` and its CSS — with every orphaned test,
testid and spec reference amended rather than left dangling,
`npm run validate:quick` passes in the implementer's session, and a summary
comment from the implementer exists on issue #255.

## Acceptance criteria

### 1. A search toggle in the TOC header — and nowhere else

- `TocPanel`'s header (`src/components/TocPanel.tsx`, testid `toc-header`)
  carries one additional small icon button beside the existing
  `toc-collapse` chevron: a search toggle with a stable new testid
  (`toc-search-toggle`), built from the `IconButton` primitive with a
  constant `title`/`aria-label` (e.g. `Search headings`).
- It marks its state the way the sidebar's other toggles do: `aria-pressed`,
  `data-active` and the accented `.on` class — the same idiom as
  `SidebarViewSwitch` / `SearchOptionsBar`, no new one-off button class.
- The button exists **only** while the sidebar shows the TOC view: with the
  Folders or Search view up, and with the sidebar hidden, `toc-search-toggle`
  resolves to zero elements. It is not a `SidebarViewSwitch` member — the
  switch's three buttons and their testids are untouched.

### 2. The text box filters the headings in place

- Pressing the toggle on renders a text input at the top of the pane, between
  the header and the heading list, with a new stable testid
  (`toc-search-input`), an `aria-label`/placeholder naming what it does, and
  focus in it when it opens (the `SearchPanel` query-row treatment: the
  `.field` primitive, class-targeted CSS, no bare descendant ` input`
  selector).
- Typing fuzzy-filters the document's headings using the existing
  `fuzzyFilter` from `src/lib/fuzzy.ts` over heading titles — the same ranking
  the palette used — and the pane renders the matches as ordinary TOC rows
  (`toc-item`, keeping `data-toc-id`, `data-line`, depth indent and title), not
  a second row species.
- Filtering sees **every** heading in the document, not just the currently
  visible rows: a match nested inside a collapsed ancestor still appears while
  a query is active. Filtered rows have no disclosure triangle behaviour to
  honour (a childless-looking flat list is fine); the twisty slot may stay
  reserved so titles line up.
- An empty query is not a filter: the pane shows the ordinary tree with its
  collapse state exactly as today.
- A query matching nothing shows a visible empty state in the pane (new
  testid, e.g. `toc-search-empty`) rather than a blank pane — the
  `folder-open-empty` treatment `toc-empty` already uses.
- While a non-empty query is active, the scroll-driven active-row reveal does
  not re-fold or reorder the filtered list (the active-row highlight itself may
  remain).
- The pure part of this — deciding which entries the query yields, from the
  TOC entry tree plus the query — lives in `src/lib/tocModel.ts` (or another
  `src/lib/` module), not in the component: `TocPanel` stays a pure view with
  rows in and callbacks out, and imports no new platform seam.

### 3. Selecting a match jumps exactly as the palette did

- Clicking a filtered row jumps through the existing TOC select path
  (`jumpToTocEntry` in `src/App.tsx`): in preview the heading scrolls to the
  top of the viewport, in edit modes the editor goes to the heading's source
  line — the behaviour SPEC16 §4.3 gave the palette, unchanged.
- Enter in the text box jumps to the top-ranked match (the palette's keyboard
  parity). Arrow-key movement of a highlighted match is permitted but not
  required; if it exists, Enter jumps to the highlighted row instead.
- Jumping leaves the sidebar as it is: the box stays open with its query, the
  filtered list stays on screen. This is a sidebar filter, not a modal that
  dismisses itself.
- Esc in the box, and pressing the toggle off, both close the box, clear the
  query and restore the full heading list with the collapse state it had.
- The state is session state owned by `src/App.tsx` — never written to
  settings, never persisted. It resets to closed-and-empty when a different
  document becomes active. Whether it survives a switch to another sidebar view
  and back is the implementer's call; state it in a citation comment either way.
- Both builds behave: the TOC view is seam-free (PRD 012 Req 12), so the search
  works in the desktop shell and in the hosted/web build alike, with no folder
  root open.

### 4. The palette is gone, root and branch

- `src/components/HeadingPalette.tsx` is deleted, along with its `PaletteHeading`
  type, the `paletteOpen`/`paletteHeadings` state, the heading-scraping
  `headingPalette` command handler and the render block in `src/App.tsx`.
- `headingPalette` is removed from `CommandId` (`src/lib/commands.ts`), from the
  View menu (`cmd('headingPalette', 'Go to Heading…', …)` in
  `src/lib/menuSpec.ts`, which drops it from the in-app View flyout too), from
  the Hotkeys-tab label map (`src/components/SettingsPanel.tsx`), from the
  hotkey dispatch chain in `src/App.tsx`, and from `HotkeyMap` +
  `DEFAULT_HOTKEYS` in `editor/src/lib/hotkeys.ts`.
- `Mod+K` is thereby free and is **not** reassigned by this issue; the SPEC43
  comment in `editor/src/lib/hotkeys.ts` that calls `Mod+K` taken is corrected.
- Old settings files carrying a `headingPalette` hotkey still load: the map
  parser drops unknown keys and the app starts with no error (verify, don't
  rebuild — `src/lib/settings.ts` already iterates `DEFAULT_HOTKEYS`).
- The palette's dead CSS goes with it: `.palette-scrim`, `.palette`,
  `input.palette-input`, `.palette ul`, `.palette .menu-item`, their
  reduced-motion entries and the `--mm-palette-scrim` token in
  `src/styles.css`; any surviving comment that still names the palette (e.g.
  the `.active`-row note near `src/styles.css:455`) says something true after
  the edit.
- After the sweep, `grep -rn 'HeadingPalette\|headingPalette\|heading-palette\|palette-input\|palette-scrim' src editor/src tests scripts` returns nothing outside the
  style-lint fixture string in `tests/unit/style-lint.test.ts` (a synthetic CSS
  sample, not an app reference) — every removed testid is verified gone from
  `tests/` before the spec amendment is called done.

### 5. Tests and specs amended, not orphaned

- Unit coverage is updated where it named the palette: the View-item lists in
  `tests/unit/app-menu.test.ts`, and `tests/unit/menu-spec.test.ts` U34's
  palette-accelerator assertion — amended to the new View menu, not deleted
  wholesale. `tests/unit/fuzzy.test.ts` stays green untouched (`fuzzyFilter`
  keeps its other callers).
- New unit tests cover the new pure filter seam in
  `tests/unit/toc-model.test.ts` (matching, ranking, empty query, no match,
  matches under collapsed ancestors), with the next unused `U` numbers
  (U1229+).
- E61 (`tests/e2e/reading-and-export.spec.ts`) is the palette's e2e: its
  coverage moves to `tests/e2e/toc.spec.ts` as new `E` tests (next unused
  numbers, E530+) proving the toggle's TOC-only presence, the fuzzy filter,
  the preview jump and the edit-mode source-line jump, and Esc/toggle-off
  restoring the list. The retired number is not reused. Every other e2e that
  touches the removed surface is amended: `menu-view-headingPalette` in
  `tests/e2e/shell-and-menus.spec.ts` (both the enabled-row assertion and the
  View-row inventory).
- The desktop-shim collection stays at or above `E2E_TEST_FLOOR` in
  `scripts/validate.mjs` (479 today); if the net count drops below it, the
  constant is lowered with a justification comment in the house style there.
- Contracts the change contradicts carry an amendment note in the house form
  `> **Amended (issue #255, 2026-09-06):** …` rather than being rewritten
  silently: SPEC16 §4 (the palette is retired, the capability now lives in the
  TOC view), plus its §6.1/§6.3 menu-and-hotkey statements and its §8.6/§8.8
  test entries; PRD 012's problem statement and the non-goal that says the TOC
  "does not duplicate" the palette (`prd/012-table-of-contents.md` lines ~9 and
  ~33), which gains the new in-pane search as an amendment to the requirement
  it belongs under; PRD 009 Req 12's View-submenu inventory (`Go to Heading…`);
  and PRD 014's opening line about the palette jumping headings.
- New and changed behaviour carries citation comments in the repo's form
  (`// PRD 012 Req <n> (issue #255): …`), and stale citations pointing at
  SPEC16 §4 from surviving code are retargeted.
- `docs/MAP.md` matches what `npm run map` derives — regenerate and commit it,
  since `HeadingPalette.tsx` leaves the SPEC16 row and the TOC rows gain tests.
- Chrome follows `docs/STYLE-GUIDE.md`: `IconButton`/`.field` primitives, no raw
  colour or size literals, no bare descendant ` input` selector, every
  `var(--mm-…)` defined.
- Iterate with `npm run typecheck` and `npm run test:unit` (plus targeted
  `npx playwright test -g '<title>'` runs for the touched e2e tests). Run
  `npm run validate:quick` **once**, right before declaring the goal met — not
  after every change, and not as a start-of-attempt baseline beyond that same
  quick tier — and it prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #255 describing what
  changed and the gate evidence.

## Context

The palette is four small sites: `src/components/HeadingPalette.tsx`, the
`headingPalette` command handler in `src/App.tsx` (~line 4857, which scrapes
`data-mm-line` headings out of the rendered DOM), the hotkey branch (~line
6178) and the render block (~line 8516). None of that DOM-scraping survives —
the TOC view already has the heading tree from the section model
(`buildTocTree` / `visibleTocEntries` in `src/lib/tocModel.ts`, wired at
`src/App.tsx` ~lines 5143–5300), and `jumpToTocEntry` (~line 5292) already
performs the palette's jump for both modes.

`src/components/TocPanel.tsx` is the view to extend; `src/components/SearchPanel.tsx`
is the prior art for a query box inside a sidebar panel (the `search-query-row`
markup, the `focusTick` focus idiom, `SearchOptionsBar`'s pressed-state
buttons). Issues #258 and #257 have already landed on this branch: the View row
is labelled **Sidebar** and `SidebarViewSwitch` is a stateless, unmounted-while-hidden
mode switch — this issue adds a panel-header button, not a fourth switch member.

Grep before opening files (`rg 'SPEC16' src`, `rg 'PRD 012' src`), use
`docs/MAP.md` to locate features, and never read `src/App.tsx` end-to-end.
