# Spec: Editor: the blue cursor-line icon intrudes into code blocks (#263)

## Goal

All acceptance criteria in issue-specs/issue-263.md are satisfied for issue
#263, with evidence visible in the session: the smart-edit (blue hash) button
on the cursor's line no longer overlaps a fenced code block's card background
on any card line — plain, nested-in-list and nested-in-blockquote fences alike
— non-code lines keep the E105 geometry unchanged, a numbered e2e regression
test covers the code-block cases, `npm run validate:quick` has been run in the
implementer's session and passed, and a summary comment from the implementer
exists on issue #263.

## Acceptance criteria

- The icon in the issue is identified in the implementation as the **Smart
  Edit** button (SPEC43 §3): `SmartEditWidget` / `smartEditButton` in
  `editor/src/components/Editor.tsx`, `data-testid="smart-edit-gutter"`,
  styled by `.smart-edit-anchor` / `.smart-edit-btn` in `editor/styles.css`.
- With the fenced-code card view on (`codeBlockView`, default `true`) and the
  cursor parked on a line of a fenced code block, the button no longer paints
  inside the card. Exactly one of these end states holds, and the code says
  which was chosen and why in its citation comment:
  - the button still renders, entirely left of the card background — its
    bounding box satisfies `btnBox.x + btnBox.width <= cardLineBox.x + 1`
    (the `.cm-line.mm-fence-card` box's left edge is the card's painted left
    edge, since the card `::before` is `inset: 0`); or
  - no `smart-edit-gutter` element exists at all while the cursor is on a
    card line.
- The chosen behaviour holds on every kind of card line: the card's first and
  last (delimiter) rows, an interior body row, a one-line block, and a card
  that is currently *revealed* because the cursor sits in it (revealed cards
  keep the `mm-fence-card` line class and its 16px left padding).
- The chosen behaviour also holds for fences nested inside a list item and
  inside a blockquote.
- Nothing regresses off code-block lines: on ordinary prose lines the button
  keeps its current position — right of the line-number gutter, inside
  `.cm-content`, immediately left of the line's text, and the line's text does
  not reflow when the button lands on it. `E105` in
  `tests/e2e/smart-edit.spec.ts` still passes unmodified in substance (it may
  gain assertions, but its existing geometry expectations must not be relaxed).
- With line numbers off, the button is still fully inside the editor pane on
  both plain and code-block lines (`.cm-content`'s 32px side padding meets the
  pane edge there — see the issue #272 note in `editor/styles.css`), i.e. it is
  not pushed out and clipped by whatever offset the fix introduces.
- If the "still renders" branch is taken, the button on a code-block line is
  still clickable and opens the smart menu, and the click does not move the
  caret or dirty the document; if the "not shown" branch is taken, the smart
  menu is still reachable on those lines by right-click and by the `smartMenu`
  hotkey (Mod+.).
- The card's own text inset is unchanged: fenced-code text still starts 16px in
  from the card edge and the caret stays glued to its glyph — the fix moves
  chrome only, never document text or layout.
- The card's 16px left inset is not duplicated as a bare unexplained literal in
  two independent rules that can silently drift; it is expressed once (a
  variable/token or a derived value) or the duplication is explicitly justified
  in a comment naming the other site.
- The fix lives in the shared `editor/` package (component + `editor/styles.css`)
  with no desktop-only or hosted-only branch, so it applies to both builds as
  the issue's "Build applicability: both builds" line requires.
- A new numbered e2e regression test (next free number: `E490`) in
  `tests/e2e/smart-edit.spec.ts` asserts the code-block geometry (or absence)
  above, including at least one nested case, and fails against the pre-fix code.
- Changed/added behaviour carries the repo's citation comments
  (`// SPEC43 §3 (issue #263): …` style per `.sandcastle/CODING_STANDARDS.md`),
  and `docs/MAP.md` is regenerated with `npm run map` if the citation/test set
  changed, so the validation gate's MAP diff passes.
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (or a single targeted Playwright test, `npx playwright test -g '<title>'`)
  rather than the full suite, and ran the full gate only once at the end — not
  as a starting baseline (baseline with the quick tier only).
- `npm run validate:quick` has been run in the implementer's session and
  printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #263 describing the
  root cause, the branch chosen, and the regression test.

## Context

The offender is the Smart Edit button (SPEC43 §3). `smartEditButton()` in
`editor/src/components/Editor.tsx` (~line 960) puts a zero-width inline widget
at the cursor line's `from`; `.smart-edit-btn` is `position: absolute; right: 4px`
against that anchor, so the 24px button hangs left into `.cm-content`'s 32px
side padding. Issue #157/#163's card view adds
`.editor-wrap .cm-line.mm-fence-card { padding-left: 16px }`
(`editor/styles.css` ~line 944) with the card background painted by a
`::before` at `inset: 0` — so on a card line the anchor starts 16px in and the
button spans roughly −12px…+12px around the card's left edge: exactly the
reported half-in overlap. Card lines are decorated by
`editor/src/components/codeBlockView.ts` (`cardLineDeco`, classes
`mm-fence-card{,-first,-last}`) from `editor/src/lib/codeBlockSpans.ts`.

`E105` (`tests/e2e/smart-edit.spec.ts`) is the existing button-geometry test and
the model for the new assertions; `tests/e2e/editor.spec.ts` ~line 800-1000 shows
how card lines are set up and measured in e2e. Table-mode lines
(`.mm-table-mode-line`) carry no left padding, so they are not affected — but
check any other `.cm-line` padding before assuming the fence card is the only
source. Keep `docs/STYLE-GUIDE.md`'s chrome-token rules in mind for any new
CSS value.
