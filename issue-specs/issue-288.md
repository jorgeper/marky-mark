# Spec: Comment copy-link parity: #hl- fragment links from comment cards (#288)

## Goal

All acceptance criteria in issue-specs/issue-288.md are satisfied for issue
#288, with evidence visible in the session: comment cards in the comments pane
carry a hosted-only copy-link that copies the file's canonical URL plus
`#hl-<comment id>`, visiting such a link reuses the existing `#hl-` landing
(centre + flash, unchanged miss notice) and activates the comment, exactly one
copy-link control exists per annotation (card-side for comments, the margin
graft stays highlight-only), new e2e coverage for copy / landing hit / landing
miss / desktop absence lands, `npm run validate:quick` passes in the
implementer's session, and a summary comment from the implementer exists on
issue #288.

## Acceptance criteria

- **Req 20 — the card affordance.** Every comment card the comments pane
  renders (open cards, the active card, and cards inside the resolved section)
  carries a copy-link control built from the existing `CopyLinkButton`
  component — the same glyph, the same confirmation contract (inline "Link
  copied", ~2s revert, the `aria-live` announcement). No second copy-link
  implementation is introduced.
- **The copied text.** Clicking it copies that moment's canonical file URL plus
  `#hl-<comment id>` through the existing `highlightShareUrl` /
  `HIGHLIGHT_FRAGMENT_PREFIX` in `src/lib/shareLinks.ts` — the reserved
  namespace is reused, not extended with a comment-specific prefix.
- **Naming the target.** The control's rest tooltip and accessible name name a
  comment (e.g. `Copy link to comment`, a new exported label constant beside
  `COPY_LINK_HIGHLIGHT_LABEL`), per the issue #227 name-the-target convention,
  and it ships its own `data-testid` (a new id; no existing test id is
  renamed).
- **Hosted-only (PRD 020 Req 15).** The control is absent in the desktop build
  and absent when no addressed file rides the path (untitled/scratch buffer);
  it is present in the hosted build with a file open. Because copying a link is
  a read action, it stays available on a `readOnly` (frozen-store) card.
- **One control per annotation.** The mark-side `mm-hl-link` graft
  (`src/lib/highlightLink.ts`, driven from the activation effect in
  `src/App.tsx`) is gated to highlight records, so an active comment no longer
  grafts a margin control labelled "Copy link to highlight". Highlights keep
  their margin graft with today's behaviour and labels — E428/E429/E430 pass
  unchanged.
- **Landing parity.** A visit to `#hl-<id>` where the id names a comment lands
  through the existing `landOnFragment` path in `src/App.tsx` — no second
  landing code path — giving the comment's marks the SPEC14 §1.3 feel (centre
  the first painted mark, flash them) and activating that comment through the
  same path a mark click takes (PRD 023 §18: the pane opens and the card goes
  active).
- **Miss notice unchanged.** A `#hl-<id>` naming no record still shows the
  existing dismissible miss notice with its current wording and test ids — the
  landing side cannot know which kind a missing id was, so the notice is not
  split by kind and `heading-miss-notice` / `highlight-miss-notice` keep their
  meanings.
- **Citations.** Every new or changed behaviour carries a citation comment in
  the house format naming this slice (`PRD 023 §20 (issue #288)`), per
  `.sandcastle/CODING_STANDARDS.md`.
- **e2e coverage (Req 21).** New Playwright tests, titled with the next unused
  `E<n>` ids (E445 is the highest in use today): copying a link from a comment
  card in the hosted suite and asserting the copied text is
  `<origin>/<workspace>/<file>#hl-<comment id>` plus the inline confirmation;
  landing on that URL (hit) with no miss notice; landing on a `#hl-` id that
  names no record (miss) showing the notice; and the desktop-shim case where a
  comment card offers no copy-link. Setup goes through
  `tests/e2e/fixtures.ts` / `helpers.ts`; no existing test is weakened,
  renumbered, skipped or deleted.
- **Unit coverage.** Any new pure logic or exported label added to
  `src/lib/` is unit-tested in its matching `tests/unit/*.test.ts` file with
  the next unused `U<n>` ids (U1138 is the highest in use today).
- **Style gate.** The new control uses the `ui/` primitives and PRD 018 tokens
  (no raw colour literals, no bare descendant `button` selectors) so the style
  lint in the quick gate passes.
- **Map in sync.** `docs/MAP.md` is regenerated with `npm run map` if citations
  were added or moved, so the validation gate's diff of it is clean.
- **Test economy.** The implementer iterates with `npm run typecheck` and
  `npm run test:unit` (or a single targeted
  `npx playwright test -g '<title>'`), baselines with the quick tier only, and
  runs the full gate ONCE at the end.
- `npm run validate:quick` has been run in the implementer's session and prints
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #288.

## Context

PRD `prd/023-comments-highlights-split.md` Req 20 is the contract; the parent
effort is #276 and the comments pane it needs (#284, Req 14–17) and the
two-way sync it leans on (#285, Req 18) have already landed on `main`.

The machinery all exists — this slice is mostly wiring:

- `src/lib/shareLinks.ts` — `HIGHLIGHT_FRAGMENT_PREFIX`, `highlightShareUrl`,
  `highlightIdFromHash`, and the `COPY_LINK_*_LABEL` constants.
- `src/components/CopyLinkButton.tsx` — the reusable React control (the
  workspace and file placements use it).
- `src/lib/highlightLink.ts` — the mark-side margin graft for the active
  highlight; driven from the "active highlight styling" effect in
  `src/App.tsx` (grep `updateHighlightLink`), which currently keys off
  `activeId` with no kind check.
- `src/App.tsx` — `landOnFragment` (grep `highlightIdFromHash`) and
  `centerAndFlashMarks` are the landing path; `showFragmentMiss` /
  `fragmentMiss` render the notice; the two `<CommentCard>` call sites render
  the pane's flow cards and the resolved section.
- `src/components/CommentCard.tsx` — the card, with its `row controls`
  action row.

Comment records paint `mark.hl[data-cid]` in the preview surfaces and
`.mm-hl[data-cid]` decorations in the editor, so the existing mark-query
landing works on the preview surfaces exactly as it does for highlights;
parity with highlight behaviour is the bar, not extending landing to new
surfaces. Citation-grep before opening files (`rg 'PRD 023' src`,
`rg 'SPEC14' src`) — never read `src/App.tsx` end to end.
