# Spec: Placement cues: drop the active-word tint in the editor and all block/word cues in the preview; preview clicks must not scroll (#345)

## Goal

All acceptance criteria in issue-specs/issue-345.md are satisfied for issue
#345, with evidence visible in the session: with the caret on a word in the
editor the caret line is tinted through `--mm-active-line` raised to roughly
9–10% accent and no `mm-active-word` element exists in `.cm-content`; after
editor caret moves, preview clicks, re-injection and mode toggles the preview
DOM contains no `.mm-active-block` and no `mark.mm-active-word` in split and
preview-only modes alike; a plain preview click leaves both panes' `scrollTop`
unchanged while still placing the editor caret silently (split) or parking it
for ⌘E (preview-only, issue #178 contract); the editor-caret→preview following
(issue #310) and cue-anchored sync (SPEC45) still hold through an invisible
head-row anchor; the SPEC44 e2e tests that asserted the removed cues are
rewritten to the new contract with their IDs kept, SPEC44 is amended and
`docs/MAP.md` regenerated; `npm run validate:quick` passes in the
implementer's session; and a summary comment from the implementer exists on
issue #345.

## Acceptance criteria

### Editor (issue Reqs 1–3)

- Caret on a word in edit mode (plain and split): the caret's line carries
  CodeMirror's `cm-activeLine` tint and NO element with class
  `mm-active-word` exists inside `.cm-content` — not on caret moves, not on
  a remount restored through `EditorState.fromJSON`, not after the find bar
  closes. The `activeWordMark` decoration, `activeWordField`,
  `setActiveWordSuppressed` and the `activeWordSuppressed` prop are removed
  from `editor/src/components/Editor.tsx` (the app is the only consumer;
  `src/App.tsx` stops passing `activeWordSuppressed={findOpen}`), and the
  `.editor-wrap .cm-content .mm-active-word` rule leaves `editor/styles.css`.
- The active-line tint is bound to the token. Today `.cm-activeLine` is
  painted by CodeMirror's injected base theme (`#cceeff44` light /
  `#99eeff33` dark) and nothing in `editor/` reads `--mm-active-line` — so
  bumping the token alone changes nothing visible. A three-class rule in
  `editor/styles.css` (`.editor-wrap .cm-editor .cm-activeLine`, the same
  precedence trick the find-match rules use) sets `background` to
  `var(--mm-active-line, <fallback>)`, and the token's default in
  `src/styles.css` rises from the 5.5% accent mix to 9–10%
  (`color-mix(in srgb, var(--mm-accent, #0969da) 10%, transparent)` or 9%).
  A test asserts the TOKEN (the `--mm-active-line` custom property read off
  `.theme-root` contains the raised percentage, and setting it to a fixed
  `rgb(…)` on `.theme-root` makes the `.cm-activeLine` computed background
  follow), not a pixel colour. Themes that override the token are unaffected
  (no bundled theme in `themes/` defines it; none is edited).
- `--mm-active-word` is either retired (definition removed from
  `src/styles.css`, every `var(--mm-active-word)` use removed from
  `src/styles.css` and `editor/styles.css`, the `--mm-selected-row` comment
  at `src/styles.css` ~L107 that compares against it reworded) or left
  defined and unused; the style lint in the quick tier is green either way.
- Real selections (`--mm-selection`), comment marks (`mark.hl`), highlight
  marks and find marks (`mm-find`) are unchanged: E83, E126's comment-anchor
  step, E291 and the find suites stay green. SPEC44 §2.3's stacking order
  loses only the word layer.

### Preview: no cues, either mode (issue Req 4)

- After ANY of these the preview DOM (`[data-testid="doc"]` in preview-only,
  `[data-testid="split-preview"] .doc` in split) contains no element with
  class `mm-active-block` and no `mark.mm-active-word`: an editor caret move
  or selection drag (the `handleEditState` report loop), a preview click, a
  re-injection of html (`SPEC44 §3.2` re-derivation at `src/App.tsx` ~L6851
  and the semantic-zoom path ~L6983), an edit ↔ preview toggle, a tab switch
  (SPEC36 restore) and typing. The `.doc .mm-active-block` and
  `.doc mark.mm-active-word` rules leave `src/styles.css`; no CSS rule in
  the repo styles either class afterwards.
- No synthetic `mark` element is inserted into the preview for placement:
  `highlightRange(…, '__aw__')` is no longer called for cues, and rendered
  text stays byte-identical (SPEC17 exports and the comment anchor space
  unchanged — E126's comment-across-a-click step still anchors exactly).
- The SPEC23 §1 mirrored selection for a NON-EMPTY editor selection
  (`mark.mm-mirror-sel`) is untouched (E83 green). Click-drag native
  selection in the preview still feeds the annotation flows: the Marky Mark
  button (`smart-edit-selection`) appears and a highlight can be created
  from it (PRD 023 §13; E465/E474 green).

### Preview clicks never scroll (issue Reqs 5–6)

- Split mode: a plain click in the split preview (not on `a[href]`, `img`,
  `mark.hl`, `mark.mm-find`, `input`, `button` or `.fm-card`) at a point
  whose source line is far outside the editor's viewport leaves BOTH
  `.cm-scroller`'s and `[data-testid="split-preview"]`'s `scrollTop` within
  2px of their pre-click values after a 300–400ms settle, with sync
  scrolling on. The click still places the editor caret at the exact
  clicked offset (issue #178; `window.__mmEdit.selFrom` lands inside the
  clicked word / run) — through the host-origin select WITHOUT `reveal`
  (`editorSelectRef.current?.(caret, caret)`; `selectSourceRange` is already
  scroll-neutral when `reveal` is false) and without a `followCaret()` call
  (host-origin reports already skip it, E464). The editor is not focused by
  the click.
- Preview-only mode: the same plain click leaves the preview scroller's
  (`workspaceRef`, the `.workspace` element) `scrollTop` unchanged (within
  2px) and visibly changes nothing in the preview; it still parks the
  collapsed caret in `pendingEditorSelRef` so ⌘E lands the editor caret at
  the clicked offset (E85/E373/E374 green; E125's ⌘E step kept).
- Link clicks, image clicks and comment-mark clicks keep their existing
  behaviours (E125's link step kept; PRD 023 activation via
  `activateFromPreviewClick` unchanged).

### Split following and cue-anchored sync survive (constraint)

- Issue #310's editor-caret → preview following (E555–E559) and SPEC45's
  cue-anchored alignment (E128) still hold. Today `SplitView.tsx`'s
  `cueRow` reads `mark.mm-active-word` / `.mm-active-block[data-mm-head]`;
  with the visible cues gone the head's rendered row reaches the controller
  through an INVISIBLE channel the implementer chooses — e.g. the host still
  runs the `headPoint` mapping and stamps only `data-mm-head` on the head's
  innermost standard container (an attribute with no CSS rule paints
  nothing) and `cueRow` reads `[data-mm-head]`; or a host-supplied seam/ref
  returning the head row's rect (SPEC46 §4.2's direction). Whichever is
  chosen: nothing visible is added, no `mark` element is inserted, rendered
  text and offsets are untouched, `editor/` imports nothing from `src/`
  (`scripts/editor-boundary.mjs` green), and E57/E58/E464 are not weakened.
- A host-placed caret (preview click, SPEC23 mirror) still moves neither
  pane (E464); an editor-made caret move still levels the preview on the
  head row while the editor stays put (E555–E559).

### Docs and citations (issue AC 9)

- `docs/specs/SPEC44.md` is amended in place with a dated
  "Amended by issue #345" section (it is the app's contract history, so
  §2.2, the word layer of §2.3, all of §3, the cue/scroll parts of §4.1–4.2,
  §5's cue lifecycle and §6's cue assertions are marked withdrawn or
  rewritten; §2.1 states the token binding and raised default; §4.3 stands;
  the "What ships" paragraph gains a one-line pointer). SPEC45's "the SPEC44
  placement cue" wording gets a one-line note that the anchor is now the
  invisible head row. `docs/ARCHITECTURE.md`'s placement-cues paragraph
  (~L521–535) is rewritten to the new contract.
- Changed behaviour carries citation comments (`// SPEC44 §2.1 (issue #345): …`,
  `// Issue #345: …`, `// Issue #310: …`) per `.sandcastle/CODING_STANDARDS.md`;
  stale "SPEC44 §3"/"§4" citations that describe painting cues are removed
  or rewritten, not left describing code that no longer exists.
  `docs/MAP.md` is regenerated with `npm run map` and committed (the gate
  diffs it).
- `editor/src/lib/activePosition.ts` stays: `wordAt` is still used by
  `selectionMap.ts`, `annotationMenu.ts` and `resolvePreviewCaret`, and
  `blockLineFor` by the head-row resolution; U76 is untouched.

### Tests

- Rewritten, IDs kept, titles updated to state the new contract, none
  emptied, skipped or deleted (the issue explicitly asks for rewrites;
  every surviving positive behaviour in each test stays asserted):
  - E124 → no `mm-active-word` in either pane on caret moves, on repeats,
    on selection, after typing; the editor line tint is present.
  - E125 → preview clicks place the caret (split: `selFrom` inside the
    clicked word/run; preview-only: ⌘E carry) with no cue and no scroll;
    link click unchanged.
  - E126 → comment anchoring across a click, find marks in the preview,
    the find bar in edit mode with no word cue before/after, the
    `--mm-active-line` theme-override step (replacing the `--mm-active-word`
    one), doc switch leaves no cue.
  - E127 → the same shapes (bullets, punctuation run, table cell,
    blockquote, whitespace click) produce NO `.mm-active-block`; if the
    invisible `data-mm-head` stamp is kept, it lands on exactly one
    innermost container (`LI`/`TD`/not `BLOCKQUOTE`) as the tint used to.
  - E128 and the issue #310 helper `caretLevelGap` (and E355's
    `.mm-active-word` fallback) → measure the editor row via
    `.cm-cursor-primary`/`.cm-activeLine` against the preview head row via
    the chosen invisible channel (or a Range over the mapped text), with
    the existing tolerances.
- New e2e tests numbered from the next unused ID (E623 at spec time; bump
  on collision) in `tests/e2e/split-view.spec.ts`: (a) split-mode plain
  click far from the editor viewport ⇒ both `scrollTop`s unchanged, caret
  placed; (b) preview-only click ⇒ preview `scrollTop` unchanged, no cue,
  ⌘E lands on the word; (c) the `--mm-active-line` token assertion above;
  (d) click-drag in the preview still shows the Marky Mark button and
  creates a highlight (may fold into (b)). Use the existing helpers
  (`fsWrite`, `clickWord`, `clickCharBoundary`, `selectPhraseInPane`,
  `splitApp`, `caretSyncApp`).
- Unit coverage (next unused `U<n>`, U1366 at spec time) only if new pure
  logic is extracted (e.g. a head-row resolver); otherwise none.
- No existing `data-testid` is renamed; `.skip`/`.only` are absent;
  hosted (`tests/e2e/hosted.spec.ts`) and web (`W<n>`) suites need no
  cue changes (they reference none) but stay green — the change applies to
  desktop, hosted and the static web build alike (issue Req 8).

### Process

- Iterate with `npm run typecheck` and `npm run test:unit` (or a single
  Playwright test via `npx playwright test -g '<title>'`) after each change;
  baseline an attempt with the quick tier only.
- `npm run validate:quick` has been run ONCE, right before declaring the
  goal met — not after every change and not as a starting baseline — and
  printed `QUICK VALIDATION: ALL PASSED` in the implementer's session.
- A summary comment from the implementer exists on issue #345 covering what
  changed, the invisible head-row channel chosen, the test IDs rewritten
  and added, and the gate result.

## Context

- Cue lifecycle in `src/App.tsx`: `ACTIVE_CONTAINERS`, `activeCueRef`,
  `clearActiveCues`, `applyActiveCues` (~L1466–1575; `headPoint`/`tintAtHead`
  hold the head-row mapping worth keeping), `placeFromPreviewClick`
  (~L1583–1625; `reveal: true` in the split branch is the editor scroll, the
  preview-only branch paints cues), `handleEditState` (~L1648–1690:
  `paintCues` + `followCaret()` on editor-origin reports, rAF-coalesced),
  resets at ~L2632/~L4284, re-derivation at ~L6851 and ~L6983, click wiring
  at ~L8797 (preview-only) and ~L8860 (split), `activeWordSuppressed` at
  ~L8907. Citation-grep `SPEC44` (12 sites in App.tsx) rather than reading
  the file.
- Editor package: `activeWordMark`/`activeWordField`/`setActiveWordSuppressed`
  (`editor/src/components/Editor.tsx` ~L215–245, registered ~L2311, prop
  ~L456/~L1554–1588), `selectSourceRange` (~L1167, reveal ⇒ scrollIntoView),
  `highlightActiveLine()` (~L2309, CodeMirror's own line class),
  `SplitView.tsx` `cueRow`/`charRectAt`/`followRef` (~L48, ~L120, ~L265–290),
  `editor/styles.css` ~L652 (gutter neutralised, no `.cm-activeLine` rule
  today) and ~L885 (`.mm-active-word`). `editor/AGENTS.md`: seams, never
  reverse imports.
- Styling: `src/styles.css` ~L175–176 (tokens), ~L1946–1960 (cue rules,
  inside the DOCUMENT RENDERING block), ~L107 (comment naming
  `--mm-active-word`). Style lint rules in `.sandcastle/CODING_STANDARDS.md`
  (tokens only, every `var(--mm-…)` defined).
- Tests: `tests/e2e/split-view.spec.ts` — E124–E128 (~L526–891), E464
  (~L248, the scroll-neutral model), E85/E373/E374 (caret carry), issue #310
  block (~L1266–1560, `caretLevelGap` ~L1321), E355 (~L1324 fallback).
  `clickWord`/`clickCharBoundary` live in `tests/e2e/helpers.ts`.
- Contracts: SPEC44 §1–§6, SPEC45 (cue-anchored sync), SPEC46 §4.2, SPEC23
  §1 (mirror, unchanged), SPEC15 §1.5 (typing never re-syncs, as amended by
  issue #310), PRD 023 §13, issues #178, #278, #310.
