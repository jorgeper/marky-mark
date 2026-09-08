# Spec: Consistent left-margin affordances for comments and highlights: copy-link above the Marky Mark button in editor and preview; preview button regression (#343)

## Goal

All acceptance criteria in issue-specs/issue-343.md are satisfied for issue
#343, with evidence visible in the session: on the hosted build, clicking or
selecting inside a commented or highlighted range in the editor and in the
preview shows that annotation's copy-link button at the left margin directly
above the Marky Mark button, and clicking it copies the file URL plus
`#hl-<id>` for that record; in preview-only mode a plain selection shows the
Marky Mark button whose menu lists only the Comment and Highlight entries,
with the reported regression covered by an e2e test and its cause (or the
verified absence of a code regression) named in the implementer's summary;
the desktop shim and the static web build render no copy-link anywhere while
the Marky Mark button behaviour still holds; the card-side
`copy-link-comment` control is unchanged; `npm run validate:quick` passes in
the implementer's session; and a summary comment from the implementer exists
on issue #343.

## Acceptance criteria

### Vocabulary

- "Marky Mark button": the blue hash-glyph selection button — in the editor
  the SPEC43 §3 widget (`data-testid="smart-edit-gutter"`,
  `editor/src/components/Editor.tsx` `SmartEditWidget`); in the preview the
  PRD 023 §13 button (`data-testid="smart-edit-selection"`, `src/App.tsx`).
- "copy-link button": the PRD 020 Req 14 primitive. The left-margin one in
  the preview is the DOM graft `data-testid="mm-hl-link"`
  (`src/lib/highlightLink.ts`); the card-side one is
  `data-testid="copy-link-comment"` (`src/components/CommentCard.tsx`).
- "hosted": `platform.kind === 'hosted'` with an addressed file
  (`docPath !== null`) — the one gate every copy-link placement takes
  (PRD 020 Req 15, `src/App.tsx` `hostedWorkspace` / the `mm-hl-link`
  effect). Desktop (Tauri and the dev shim, `kind` `tauri`/`browser`) and
  the static web build (`kind` `web`) render no copy-link.
- "the annotation under the click": the record `pickHitRecord`
  (`src/lib/markHit.ts`) resolves from the painted ranges covering the
  position — a comment wins over a highlight, the innermost (greatest
  `anchor.start`) among comments, document order breaking ties. The issue's
  "innermost/most recent" wording maps to this existing rule; no second rule
  is introduced.

### Editor: copy-link above the Marky Mark button (issue point 1)

- Hosted, edit mode (plain edit and split-edit's editor half alike): with the
  caret placed or a selection made inside a commented range, a copy-link
  button for that comment renders at the left margin, stacked directly above
  the Marky Mark button on the same line start: horizontally aligned with it
  (same right edge, i.e. it hangs into the same `.cm-content` left padding
  column) and vertically above it, never overlapping the line's text. The
  editor's Marky Mark button itself keeps rendering on the caret line exactly
  as today (SPEC43 §3); no existing SPEC43 test is weakened.
- Same for a highlighted range, with that highlight's URL.
- The copied text is `${origin}${pathname}#hl-<record id>` built by
  `highlightShareUrl` (`src/lib/shareLinks.ts`), the same URL the preview
  graft and the comment card copy (PRD 022 Req 11, PRD 023 §20). Click
  confirms inline per PRD 020 Req 14 (aria-label "Link copied" ~2s, then
  reverts) using the shared `createHeadingLinkButton` /
  `ensureCopyLinkLiveRegion` contract — not a second implementation. Its
  tooltip/aria-label names the target: "Copy link to highlight" for a
  highlight, and the existing comment label from `shareLinks.ts` for a
  comment.
- Pressing the copy-link never moves the caret or collapses the selection
  (mousedown default prevented, as the Smart Edit widget does).
- With the caret in plain text (no painted range at the head), only the
  Marky Mark button renders; no copy-link element exists in the DOM.
- The affordance is a package seam, not a reverse import: `@marky-mark/editor`
  gains a prop (suggested: `marginLink?: (sel: AnnotationSelection) =>
  { id: string; label: string; getUrl(): string | null } | null`, or an
  equivalent optional prop the implementer names) and the app supplies it
  only when hosted with an addressed file. Off-hosted the app passes nothing
  and the editor renders nothing. `scripts/editor-boundary.mjs` stays green.
- The id the seam resolves comes from the canonical-coordinate
  `annotationSelection(view).idsAtHead` (issue #344 seam) through
  `pickHitRecord`, so grid-cell, code-span and emphasis ranges resolve the
  same record the preview would.

### Preview: copy-link on a commented range (issue point 2)

- Hosted, preview mode (full preview and the split preview half): clicking
  inside a commented range activates that comment (existing
  `activateFromPreviewClick`) AND grafts the `mm-hl-link` copy-link at the
  left margin level with the comment's first painted `mark.hl` fragment — the
  same placement an active highlight gets today (PRD 022 Req 10). The
  highlight-only guard in the `mm-hl-link` effect (`activeRec?.kind ===
  'highlight'`) is widened to both kinds and its PRD 023 §20 "one control per
  annotation" citation comment is rewritten to state the new contract (margin
  graft for both kinds, card-side control kept).
- The copied URL for a comment is the same `#hl-<id>` URL its card copies.
- The card-side `copy-link-comment` control is unchanged: still present on
  open and resolved cards on hosted, still absent off-hosted; E450 and E449
  pass untouched.
- Off-hosted (desktop shim, static web) an active comment still grafts no
  `mm-hl-link`, exactly as an active highlight does not (E428 stays green).

### Preview: the Marky Mark button beneath the copy-link (issue Expected behaviour)

- Hosted preview: after the click above, the Marky Mark button renders
  directly below the copy-link at the left margin (horizontally aligned with
  it; its top at or below the copy-link's bottom; both left of the annotated
  text's first line, never over the words). Because a click collapses the
  selection, this requires the preview button to also appear for an ACTIVE
  annotation with a collapsed selection, anchored to that record's first
  painted fragment; its menu is built from the hit record's context (Delete
  Comment enabled for a comment; the Highlight colour rows recolour and
  Remove Highlight is enabled for a highlight). Rows that need a fresh
  selection anchor (Insert Comment, a new highlight over plain text) are
  disabled rather than absent, matching `buildAnnotationMenu`'s existing
  enabled flags. On desktop and static web the same button appears without
  the copy-link above it.
- Selecting text inside an annotated range (non-collapsed) keeps today's
  behaviour for the Marky Mark button (PRD 023 §13, `previewAnnotationModel`)
  and additionally shows the copy-link for the annotation under the
  selection's start directly above it, hosted only.
- Selecting plain text shows the Marky Mark button alone; no `mm-hl-link` is
  in the DOM.
- Both affordances dismiss together: Esc, an outside pointerdown, a scroll
  that moves the anchor, and selection collapse/deactivation remove the
  Marky Mark button and its menu (PRD 023 §13 rules); the copy-link leaves
  when its annotation deactivates (click-away on the doc, Esc) — no stranded
  copy-link without an active annotation and no Marky Mark button without a
  selection or an active annotation.

### Preview-only regression (issue point 3)

- In preview-only mode (`mode === 'preview'`, not semantic zoom, not the
  split half) selecting plain text shows the Marky Mark button
  (`smart-edit-selection`) left of the selection's first line, clear of the
  toolbar band AND of the file tab strip when it is shown, and its menu lists
  exactly the Comment and Highlight entries (no Table, Bold or other
  text-editing rows). This holds on the hosted flavour and on the desktop
  shim.
- A new e2e test reproduces the owner's path rather than E465/E474's
  fresh-open path: open a file from the sidebar, enter edit mode (`Ctrl+E`),
  return to preview-only mode, then select text — with the file tab strip
  enabled and default pane state — and asserts the button is visible, its
  box is left of the selection and below both the toolbar band and the tab
  strip, and the menu rows are exactly Comment and Highlight. If the
  implementer finds the actual trigger is different (a grant, the
  `commentsEnabled` setting, the `docTextRef` early return in the
  `selectionchange` handler, the PRD 025 centred page geometry clamping the
  button under the sidebar at narrow widths, or the `toolbarFloor` constant
  of 46px ignoring the 38px tab strip), the test targets that trigger.
- The implementer's summary comment on issue #343 names the change that
  dropped the button (commit or PR) — or, if no code regression reproduces,
  says so and lists what was checked (the render gate `selInfo &&
  settings.commentsEnabled && mayComment`, the selection listener, the CSS
  `.preview-sel-btn`, and the PRD 025 commits `1a203dc`, `3fcb492`,
  `2e31fe5`, `f8d4cd4`, `4250dd4`, `9609814`, `e3ea12c`). Note what the spec
  writer verified: `git log -S'preview-sel-btn'` and `-S'previewButtonPos'`
  over `src/` return only the issue #287/#306 commits, and no
  `contain`/`transform`/`filter` containing-block rule was added around the
  page column — the regression, if in code, is not a removed gate.

### Platform gates (issue Expected behaviour, PRD 020 Req 15)

- Desktop shim (`tests/e2e/*.spec.ts` on port 4923) and the static web build
  (`tests/e2e/web.spec.ts`, `W<n>` numbering): no element with testid
  `mm-hl-link`, `copy-link-comment`, or the new editor copy-link exists in
  either mode after activating a comment and a highlight and placing the
  caret inside each in the editor; the Marky Mark button behaviour above
  still holds there.

### Tests

- E2E coverage exists for each acceptance row in the issue (numbered from
  the next unused `E<n>`, E613 at spec time; bump on collision): editor
  hosted comment copy-link + URL; editor hosted highlight copy-link + URL;
  preview hosted comment click ⇒ copy-link above the Marky Mark button;
  preview plain selection ⇒ button with exactly Highlight and Comment rows
  (the regression test above); desktop shim and static web ⇒ no copy-link
  anywhere with the button behaviour intact; card-side `copy-link-comment`
  unchanged (E450/E449 untouched and green). Hosted tests live in
  `tests/e2e/hosted.spec.ts` against `http://localhost:4924`; use the
  existing helpers (`signIn`, `signInTo`, `sharedWorkspace`/`pathWorkspace`,
  `openFromSidebar`, `selectPhrase`, `addHighlight`, `addComment`,
  `stubClipboard`, `lastCopy`, `clickClearOfToolbar`).
- Unit coverage (next unused `U<n>`, U1359 at spec time) for any new pure
  logic: the record picked for the margin link from `idsAtHead`, the
  preview model for a collapsed click on an active record, and the geometry
  helper that stacks the two buttons if one is extracted.
- No existing test is weakened, deleted or skipped; no existing
  `data-testid` is renamed. New interactive elements carry a `data-testid`.
- New or changed behaviour carries citation comments (`// PRD 023 §13 …`,
  `// PRD 020 Req 15 …`, `// SPEC43 §3 …`) per
  `.sandcastle/CODING_STANDARDS.md`; chrome styling uses tokens only (the
  style lint runs in the quick tier).

### Process

- Iterate with `npm run typecheck` and `npm run test:unit` (or a single
  Playwright test via `npx playwright test -g '<title>'`) after each change;
  baseline an attempt with the quick tier only.
- `npm run validate:quick` has been run ONCE, right before declaring the goal
  met — not after every change and not as a starting baseline — and printed
  `QUICK VALIDATION: ALL PASSED` in the implementer's session. `docs/MAP.md`
  is regenerated with `npm run map` if the spec→code table changed.
- A summary comment from the implementer exists on issue #343 covering what
  changed, the regression cause (or the verified absence of one), the test
  IDs added, and the gate result.

## Context

- Preview button: render gate `src/App.tsx` (`selInfo && settings.commentsEnabled && mayComment`), position `previewButtonPos` / `PREVIEW_BTN` (`toolbarFloor: 46` predates the 38px tab strip, `--mm-tabstrip-h`), selection listener keyed on `mode`/`settings.splitEdit`, menu via `openPreviewMenu` → `previewAnnotationModel` (`src/lib/annotationMenu.ts`, returns CLOSED when `end <= start` — the collapsed-click case needs a path that reads the active record instead). CSS `.preview-sel-btn` in `src/styles.css` (`position: fixed; z-index: 80`); never add a `z-index` to `.workspace-stack`/`.comments-pane` (see the comments there).
- Highlight margin graft: `src/lib/highlightLink.ts` (`updateHighlightLink`, positioned in `.doc`'s coordinate space beside the first `mark.hl[data-cid]` fragment; clip-aware `left`), called from the activation effect in `src/App.tsx` around the `linkable` computation. Reuse it for comments; the Marky Mark button for an active record can anchor to the same fragment rect.
- Editor button: `SmartEditWidget` / `smartEditButton` in `editor/src/components/Editor.tsx` (inline widget decoration at the head line's start, `.smart-edit-anchor` + `.smart-edit-btn` in `editor/styles.css`, hangs into the 32px `.cm-content` padding; fence-card inset override). `createHeadingLinkButton` and `ensureCopyLinkLiveRegion` already live in the package, so the editor can render the copy-link itself given a seam prop; `editor/AGENTS.md` forbids importing app code. `annotationSelection(view)` gives `idsAtHead` in canonical coordinates; the app's `onAnnotationMenu` prop shows the seam shape.
- Record resolution: `pickHitRecord` (`src/lib/markHit.ts`), `hitContext` (`src/lib/annotationMenu.ts`). Labels/URLs: `src/lib/shareLinks.ts`.
- Hosted detection: `<meta name="marky-mark-hosted">` injected by `server/app.ts`; `src/lib/hostedGate.ts`; `platform.kind` in `src/platform/index.ts`.
- Existing tests to model on: E465/E565/E467/E473 (`tests/e2e/comments.spec.ts`), E474/E429/E450 (`tests/e2e/hosted.spec.ts`), E428/E449 off-hosted negatives.
- Related contracts: PRD 020 Reqs 14–15, PRD 022 Reqs 10–11, PRD 023 §13 and §20 (`prd/023-comments-highlights-split.md`), SPEC43 §3–4, issue #344 spec (`issue-specs/issue-344.md`) for the canonical annotation seam.
