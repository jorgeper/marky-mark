# Spec: Dedicated comments pane: third pane, second chevron, single home for comment cards in every mode (#284)

## Goal

All acceptance criteria in issue-specs/issue-284.md are satisfied for issue #284, with evidence visible in the session: a third comments pane sits at the right of the workspace in every mode (plain edit, full preview, split), opened and closed by a second chevron to the right of the preview chevron with the PRD 003 180 ms slide idiom and the folder pane's `--mm-bg-elevated` second-plane treatment; the pane is fixed at 300 px, closed by default, persists its open/closed state across sessions, auto-opens when a comment is inserted, and is hidden in print; it is the single home for comment cards — the PRD 022-era in-preview aside is gone, no highlight card appears in the pane, and cards keep their balloon flow, active accent, resolved section, note editing, reply/resolve threads, remove and copy-link while losing the recolor swatches; `Mod+Shift+C`, View → Comments and the toolbar button all toggle the pane while the navigator and the `commentsEnabled` master switch keep their current meaning; comment-pane open/close/persist e2e coverage lands with the slice; and `npm run validate:quick` passes.

## Acceptance criteria

### The pane itself (PRD 023 Req 14)

- A third pane renders at the **right edge of the workspace**, as a sibling of the document/preview surfaces inside `.body-row` — not inside the preview surface and not inside the split's preview pane. It carries its own `data-testid` (e.g. `comments-pane`) and hosts the comment cards that `.panel` hosts today.
- The pane's chrome is the folder pane's second-plane treatment: an `--mm-bg-elevated` background layer with the workspace cast-shadow seam, resolved through the existing style-guide tokens (`--mm-panel-shadow` / the seam treatment `.folder-panel` uses). No raw colour literals, no new one-off shadow or radius values — `docs/STYLE-GUIDE.md` governs and the style lint in `scripts/validate.mjs` passes over the new rules.
- A **second chevron** sits immediately to the right of the preview pane's chevron in the workspace's top-right cluster, and rides the `FileTabStrip` `trailing` slot when the tab strip is up — exactly as `PreviewToggleButton` does today. It is the same edge-tab primitive (`IconButton` + `Chevron`, `.icon-btn` styling), points in the direction a click will move the pane, carries a title/aria-label naming the action, and has stable test ids for both states (e.g. `comments-collapse` / `comments-expand`).
- Opening and closing animates with the PRD 003 slide idiom: the shared `usePaneSlide` / `slideClasses` / `SLIDE_MS = 180` machinery in `src/lib/paneSlide.ts`, armed only on explicit user toggles (the folder/split `armFolderSlide` / `armSplitSlide` precedent), and skipped entirely under `prefers-reduced-motion`. No second copy of the phase table.
- The chevron dispatches the existing named `toggleComments` command through `dispatchCommand` — it does not call a handler directly (`.sandcastle/CODING_STANDARDS.md`).

### State, width, print (PRD 023 Req 15)

- The pane's open/closed state is a **persisted setting** in `src/lib/settings.ts` with a validator and a declared scope alongside its layout neighbours (`showFolders` / `splitEdit` are `'M'` — machine/session-local; pick that scope unless a stated reason says otherwise, and state the reason in a comment if it differs). Its default is **closed**, and the closed/open state survives a reload.
- Today's ephemeral `showComments` React state (`src/App.tsx`, default `true`) no longer double-sources the answer: the persisted setting is the single source the chevron, the toolbar Comments button, View → Comments, `Mod+Shift+C` and every gate read.
- **Inserting a comment auto-opens the pane** — creating a comment through any surface that still authors one in this slice (the preview selection button, the edit-mode affordance / SPEC25 carry, type-to-comment) opens the pane if it was closed, with the composer reachable in it.
- The pane is **fixed at 300 px** wide: no drag handle, no width setting, no window-width breakpoints. A narrow window scrolls exactly as it does today (PRD 023 non-goal).
- The pane is **hidden in print** on both paths — its class joins the `@media print` `display: none` list in `src/styles.css` beside `.panel`, and the print output carries no comment chrome.
- With the pane **closed**, comment marks still render in the text and clicking one behaves as it does today for card activation (opening the pane is PRD 023 Req 18's two-way-sync slice and is not required here; whichever behaviour is chosen, it is cited and covered).

### Single home for comment cards (PRD 023 Req 16)

- The pane hosts comment cards in **all three modes** — plain edit, full preview, and split edit — reached by the same chevron/hotkey/menu in each.
- The PRD 022-era **in-preview comment aside is removed**: no `<aside className="panel">` renders inside the full-preview document column or inside the split preview pane, and the app no longer passes an `aside` to the package `Preview` / `SplitView`. The now-unused `aside` seam in `editor/src/components/Preview.tsx` is either removed together with its `editor/README.md` mentions and in-package tests, or deliberately kept with a comment saying why — not left silently dangling. `editor/AGENTS.md`'s boundary rules hold either way and the editor-package-boundary check passes.
- Cards keep **today's flow behaviour**: the SPEC6 §2 Word-style balloon flow (absolutely positioned, animated tops, active card level with its mark and neighbours stacking away from it), the active-card accent, the collapsed Resolved section and its ghosted cards, and the orphan badge. In plain edit mode — where there is no rendered preview to measure against — the flow anchors against the editor's painted highlight decorations (`.mm-hl[data-cid]` in the CodeMirror DOM); cards whose anchor has no measurable rect (off-viewport, unpainted, orphaned) fall back to stacking in document order rather than collapsing to the top or throwing.
- Cards keep **note editing, reply/resolve threads, remove, and copy-link** (copy-link stays hosted-only, PRD 020 Req 15), and the frozen-store read-only card behaviour (PRD 004 Req 15) is unchanged.
- Cards **lose their recolor swatch row**: `CommentCard` no longer renders marker swatches, and the `onRecolor` prop / call path is removed from the card (the app's `recolorHighlight` may stay only if another live surface still reaches it).
- **No highlights appear in the pane** — the PRD 022 Req 9 transient "active highlight gets a card" behaviour is gone: only `kind: "comment"` records produce cards, in every mode and every activation state. If that leaves highlight recolor with no surface in this slice, that gap is **intended** (PRD 023 Req 9 restores it in the menu slice) and is stated in the implementer's issue comment.

### Toggle surfaces and gates (PRD 023 Req 17)

- `Mod+Shift+C`, View → Comments and the toolbar Comments button all toggle **the pane**, agree on state (the View menu item's `checked` and the toolbar button's `on` class follow the persisted setting), and the chevron is a fourth surface onto the same command.
- The comment navigator keeps its meaning — the pill and `Mod+Alt+ArrowUp/ArrowDown` step through **comment records only**, in position order, with the pill's "never moves" placement contract intact (SPEC14 §3.5). Because the pane now hosts comments in every mode, navigation is no longer gated to the preview surfaces (`navigateComment`'s `mode === 'preview' || splitEdit` gate follows the pane, not the preview); the pill's fixed placement still reads sensibly with the pane open and with it closed.
- The `commentsEnabled` master switch keeps its current meaning: with comments disabled there is **no pane, no chevron, no marks, and no View → Comments / navigator menu entries**, and no route toggles the pane back on. E36's contract still holds.
- A read-only document / a role without `comment.write`, and a frozen (newer-MAJOR) store, keep exactly the gates they have today — the pane may show and read cards, authoring stays withheld.

### Scope boundaries

- This slice ships **no new authoring UX**: PRD 023 Reqs 6–13 (killing the selection popup, the Marky Mark menu Comment/Highlight entries, the new hotkeys, the preview selection button) and Reqs 18–20 (two-way sync, editor-side authoring mapping, comment copy-link parity beyond what exists) are **out of scope**. The existing popup, edit-mode affordance and SPEC25 carry keep working, now feeding the pane instead of the preview aside.
- No resizable or responsive pane behaviour and no window-width breakpoints.

### Citations, docs, hygiene

- Behaviour added or changed carries a citation comment in the repo's format (`PRD 023 §14`–`§17`, or `SPEC<n> §x.y` where a SPEC section is amended), per `.sandcastle/CODING_STANDARDS.md`.
- `docs/MAP.md` is regenerated with `npm run map` if any citation moved (the validation gate diffs it).
- No `console.*` in `src/`; `src/lib/` modules stay pure (no React, no component imports) — any new pure logic (e.g. a pane-visibility predicate) lands in `src/lib/` with a matching `tests/unit/<kebab-case>.test.ts`.

### Verification

- Unit coverage lands with the slice for the new persisted setting (default closed, validation of a bad stored value, scope/merge behaviour) and for any pure logic extracted into `src/lib/`, in the matching `tests/unit/*.test.ts` files.
- e2e coverage lands in `tests/e2e/comments.spec.ts` (new `E<n>` ids, next unused numbers, never reusing or renumbering) for at least: the pane opens and closes from the chevron and from `Mod+Shift+C`, its state persists across a reload, it hosts cards in **plain edit, full preview and split**, inserting a comment auto-opens it, and `commentsEnabled` off removes pane and chevron together.
- Existing suites are **updated** to the new UX rather than deleted or skipped — E7/E32/E33/E38/E129/E130/E151/E153/E419–E428 and any test asserting the in-preview `panel` placement, the highlight's transient card, or the card's recolor swatches are rewritten to assert the new contract, each rewrite carrying a comment naming issue #284.
- The implementer iterated with `npm run typecheck` and `npm run test:unit` (or vitest/Playwright targeted at the changed code — `npx playwright test -g '<title>'` for one behaviour); the full gate was run **once**, right before declaring the goal met — not after every change, and not as a start-of-attempt baseline (baseline with the quick tier only).
- `npm run validate:quick` has been run in the implementer's session and passes, printing `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #284, stating what changed, the recolor gap noted above, and the `validate:quick` result.

## Context

The comment aside is built at `src/App.tsx:6737` (`panelAside`, `panelVisible`, the `commentSurfaceUp` gate) and rendered into exactly two hosts: the full-preview column (`src/App.tsx:7548`) and the package `SplitView`'s `preview.aside` slot (`src/App.tsx:7615` → `editor/src/components/Preview.tsx:209`). Its balloon-flow layout effect is the `useLayoutEffect` at `src/App.tsx:6292`, which measures `mark.hl[data-cid]` rects inside `docRef`/`splitDocRef` against `panelRef` — that measurement source is what plain edit mode has to grow (the editor paints `.mm-hl[data-cid]` decorations via `highlightDecorations` in `editor/src/components/Editor.tsx:641`). Card CSS is the `/* ---------- comments panel ---------- */` block at `src/styles.css:895`; the navigator pill's fixed placement is `src/styles.css:1543`; the print block is `src/styles.css:1712`.

The pane pattern to copy is the folder pane and the split preview: `usePaneSlide` at `src/App.tsx:337`, the arm refs at `src/App.tsx:2972`, the phase wiring at `src/App.tsx:7068`, and the pure transition table in `src/lib/paneSlide.ts`. The chevron pattern is `PreviewToggleButton` / `FolderExpandButton` in `src/components/FolderPanel.tsx:243–283`; the clusters they ride are `leftCluster`/`rightCluster` at `src/App.tsx:7148–7176` and the `FileTabStrip` `leading`/`trailing` slots. Layout CSS for `.body-row` / `.edge-cluster` starts at `src/styles.css:1959`.

Toggle plumbing: the `toggleComments` command is `src/lib/commands.ts:19`, handled at `src/App.tsx:4592`, surfaced in the View menu at `src/lib/menuSpec.ts:261` and on the hotkey path at `src/App.tsx:5799`; the toolbar button is `src/components/Toolbar.tsx:263`. Settings keys, defaults, scopes and validators are the four parallel tables in `src/lib/settings.ts` (`showFolders` at lines 113/207/297/412 is the closest precedent). The navigator's surface gate is `navigateComment` at `src/App.tsx:4206`.

Background: `prd/023-comments-highlights-split.md` Reqs 14–17 are this slice; issue #283 (already merged on this branch) landed the format 2.0.0 kind split, so `isComment(c)` / `c.kind` is how a record's type is read. Parent issue #276 carries the owner's framing. Read `docs/STYLE-GUIDE.md` before touching chrome and `editor/AGENTS.md` before touching the package. Grep by citation (`rg 'PRD 003' src`, `rg 'SPEC6' src`, `rg 'SPEC14' src`) rather than reading `src/App.tsx` whole.
