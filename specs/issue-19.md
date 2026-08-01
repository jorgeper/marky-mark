# Spec: Make comments work in preview pane in dual screen mode too (#19)

## Goal

All acceptance criteria in specs/issue-19.md are satisfied for issue #19, with evidence visible in the session: comment highlights and the comments panel render in the split-edit ("dual screen") preview pane, a comment can be created from a selection made in that pane, comment cards keep a visible gap from the right edge of the window instead of sitting flush against it, and `npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- In split-edit mode (`settings.splitEdit` on, mode `edit`), the split preview pane (`data-testid="split-preview"`) shows comment highlights (`mark.hl[data-cid]`) for the document's comments when comments are shown — the same highlight/ghosting rules as preview mode (`showResolved` ghosts, master `commentsEnabled` switch off ⇒ nothing renders).
- The comments panel (`data-testid="panel"` with its `CommentCard`s and composer) is visible alongside the split preview whenever comments exist or a composer is pending — `panelVisible` (src/App.tsx:3627) no longer requires `mode === 'preview'`.
- A comment can be created from the split preview: selecting rendered text there shows the "Add comment" affordance (`data-testid="add-comment-btn"`), and submitting the composer produces a comment anchored to that selection that persists like any other (sidecar/embedded per settings).
- Clicking a highlight in the split preview activates its card, and the comment navigator (next/prev, `data-testid="comment-nav"`) works in split-edit mode — the existing split-edit path in `navigateComment` (src/App.tsx:2465) is no longer dead code.
- Comment highlights in the split preview survive the live re-render on typing (the SPEC7 §5 injection effect at src/App.tsx:3273 currently wipes to plain HTML).
- Padding fix (from the issue body): comment cards in the right-hand panel keep a clearly visible gap (roughly 16px or more) between the card edge and the right border of the window, in both full preview mode and split-edit mode (see `.panel` and `.panel > [data-flowcard]` in src/styles.css:458–470).
- At least one new or extended Playwright e2e test in tests/e2e/app.spec.ts covers comments in split-edit mode (highlight visible in `split-preview` + panel visible) and passes.
- The implementer iterated with `npm run typecheck` and `npm run test:unit` (plus targeted `npm run test:e2e` runs where useful), and ran the full quick gate `npm run validate:quick` ONCE, right before declaring the goal met — not after every small change and not as a starting baseline; that final run passed in the implementer's session.
- A summary comment from the implementer exists on issue #19.

## Context

"Dual screen mode" is the split-edit view: `settings.splitEdit` renders editor + live preview side by side (`.workspace.split` markup at src/App.tsx:3873–3937). Comments today are preview-mode-only: the panel gate (`panelVisible`, src/App.tsx:3627), the add-comment button gate (`mode === 'preview'`, src/App.tsx:3979), and the highlight-injection effect (src/App.tsx:3154 region, which writes into `docRef`) all exclude the split pane; the split pane's own injection effect (src/App.tsx:3273) deliberately renders "plain reading pane, no comments". The comment machinery to reuse lives in `src/lib/anchoring.ts` (positions/highlightRange), `src/components/CommentCard.tsx`, and the card-flow layout effect keyed on `panelRef`/`positions`. Mind SPEC15 synchronized scrolling and SPEC44 active-word cues in the split pane — highlight injection must compose with both (the cue re-derive pattern already in the split effect shows how). The second panel consumer is the navigator pill (src/App.tsx:4031). CSS for the panel/cards is in src/styles.css (`/* ---------- comments panel ---------- */`). E2E precedent: split-mode tests around tests/e2e/app.spec.ts:1049 and comment tests throughout that file; the desktop shim harness is `tests/e2e/helpers.ts`.
