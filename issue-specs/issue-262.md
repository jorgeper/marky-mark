# Spec: New file: always open in edit mode with the cursor in the text (#262)

## Goal

All acceptance criteria in issue-specs/issue-262.md are satisfied for issue
#262, with evidence visible in the session: every new-file path — the
`newFile` command (⌘N and File ▸ New, over a splash, an open document or an
existing untitled buffer), the folder pane's New File row (rename committed
*and* cancelled), the in-workspace save picker's New File, and the
scratchpad's auto-started buffer — ends with the app in **edit** mode and
keyboard focus in the CodeMirror editor with the caret in the document, so
the very first keystroke types into the buffer with zero intervening clicks;
the focus is delivered through a seam on `@marky-mark/editor` (never a
reverse import or a DOM reach-in from `src/`), opening an *existing* file
keeps its current focus and mode behaviour, and the side pane's shown/hidden
state is untouched; `npm run validate:quick` passes in the implementer's
session; and a summary comment from the implementer exists on issue #262.

## Acceptance criteria

**Edit mode on every new-file path**

- The `newFile` command's untitled buffer keeps landing in edit mode
  (`startUntitled`, `src/App.tsx` ~3866, already `setMode('edit')` — SPEC22
  §1.1). This half is a non-regression, not new work.
- The folder pane's **New File** row keeps landing in edit mode on both
  exits — rename committed and rename cancelled — via the existing
  `openDocGuarded(p, path, { editIntent: true })` calls (`src/App.tsx` ~2704
  and ~2716, SPEC35 §4.2 / issue #194). Non-regression.
- The **save picker's** New File (`commitSavePicker` with `kind: 'new'`,
  `src/App.tsx` ~3668 — the in-workspace path taken when the platform has no
  `saveFileDialog`, PRD 009 Req 13) opens the just-created file in **edit**
  mode. Today it calls `openDoc(p, target)` with no options, so
  `viewModeForOpen` (`src/lib/modeSwitch.ts:58`) hands back the remembered
  `lastViewMode` — a user whose last view was preview gets a preview of an
  empty file. That is the "opens in preview" half of the bug and it is fixed
  here.
- The scratchpad's auto-started buffer keeps landing in edit mode (PRD 019
  Req 10, the `p.scratchStart` hook at `src/App.tsx` ~2911 calling
  `startUntitledRef.current()`). Non-regression.
- **The read-only rule still wins.** `viewModeForOpen`'s `mayEdit === false`
  → `preview` branch is unchanged: a role without `doc.edit` (PRD 007 Req 17)
  is never forced into edit mode, and never given a caret in a read-only
  buffer. `canNewFile` / `canOfferNewFile` gating is unchanged — this issue
  adds no new-file surface and removes none.

**Focus and the caret — the load-bearing behaviour**

- After each of the paths above settles, `document.activeElement` is the
  editor's `.cm-content` and the caret sits in the document (offset 0 for the
  empty buffer these paths produce). Typing immediately — no click, no Tab —
  inserts into the document.
- The fix must work when the `Editor` component is **already mounted**. Its
  mount effect calls `view.focus()` once (`editor/src/components/Editor.tsx`
  ~1913) but its dependency array is `[]` and the component carries no `key`
  in `src/App.tsx` (~8131), so ⌘N over a document already in edit mode, and a
  sidebar/picker create while in edit mode, change `value` without ever
  re-running it. A fix that only leans on the mount focus is insufficient —
  prove the already-mounted case explicitly in tests.
- Focus is delivered through the **package seam**, per `editor/AGENTS.md`: a
  prop or imperative-handle ref on `EditorProps` that the App calls (the
  `insertRef` / `selectRangeRef` / `smartRef` / `syncRef` refs are the
  precedent shapes; adding a `focus()` method to an existing handle is
  acceptable). `src/` never imports from `editor/src/` internals, never
  queries `.cm-content` or `.cm-editor` from the App to call `.focus()`, and
  `editor/` gains no import from `src/`. The boundary check in
  `scripts/editor-boundary.mjs` stays green.
- The focus call is ordered **after** the surface that owned focus goes away:
  the folder-pane in-place rename input, the save-picker dialog, and the
  unsaved-changes prompt all release focus first, so the editor keeps it
  rather than losing it to a late blur or an unmount. Where the new document
  is only committed asynchronously (`commitSavePicker` awaits its write and
  `openDoc`), the focus lands after that settles.
- **The dirty-buffer guard path still ends focused.** `newFile` over a dirty
  buffer opens the three-way prompt (`setOpenPrompt({ kind: 'new' })`, SPEC22
  §1.2); resolving it with Save or Don't Save runs `beginNewFile` and must end
  in edit mode with the caret in the new empty buffer just like the
  unguarded path. Cancel changes nothing — no mode change, no focus steal.
  The PRD 019 Req 11 exemption (⌘N over a *dirty scratch* buffer skips the
  prompt) is unchanged and also ends focused.

**What must not change**

- **Existing files.** Opening an existing file (sidebar click, tab switch,
  recent, deep link, drag-drop, Open File…) keeps exactly its current mode
  and focus behaviour. No new focus steal is introduced there — in
  particular, keyboard navigation of the folder tree (`FolderPanel.tsx:400`),
  the find bar (`FindBar.tsx:56`), the search panel input, the comment
  composer's `autoFocus`, and the heading palette all keep the focus they
  take today. The SPEC23 §1 rule that a mirrored preview selection never
  focuses the editor is untouched.
- **The side pane.** Creating or entering a new file neither opens nor closes
  the folder pane or the comments pane; their shown/hidden state is whatever
  it already was (the issue's "Unchanged" section).
- No `data-testid` is renamed. Every existing unit and e2e test still passes;
  a test is adjusted only where the new contract genuinely requires it,
  keeping its ID — never weakened, skipped, deleted, or marked
  `.only` / `.fixme`.
- Both builds — desktop (Tauri) and hosted (cloud) — per the issue's
  build-applicability note; the single-file web build inherits the same
  behaviour and needs no separate mechanism.

**Tests**

- New desktop e2e coverage proves, at minimum, that the caret is really in
  the document — assert `.cm-content` is focused **and** that a bare
  `page.keyboard.type(...)` (no click first) lands in the buffer — for:
  (1) ⌘N from the splash / a freshly opened document; (2) ⌘N while a
  document is already open **in edit mode** (the already-mounted case);
  (3) ⌘N while in **preview** mode (the mode flip plus focus);
  (4) the folder pane's New File with the rename **committed**;
  (5) the folder pane's New File with the rename **cancelled**;
  (6) ⌘N over a dirty buffer, resolved through the prompt's Don't Save.
- Hosted/workspace coverage proves the save-picker New File path lands in
  edit mode with the caret in the text even when `lastViewMode` is
  `'preview'` — the regression this issue actually fixes there — and that the
  scratchpad's auto-started buffer arrives focused (PRD 019's "blinking
  cursor" promise). `tests/e2e/hosted.spec.ts` already has the scratchpad
  setup helpers (see E446).
- One test asserts the side pane's shown/hidden state is unchanged across a
  new-file creation.
- Any new pure logic lands in a `src/lib/` module (no React, no platform
  imports) with unit tests in the matching
  `tests/unit/<kebab-case>.test.ts`. If the change is purely wiring, no unit
  test is required — do not invent one for coverage's sake.
- New IDs start above the current high-water marks: **E517** for desktop
  e2e, **U1212** for unit, **W19** for web e2e.

**Repo hygiene and verification**

- Every behavioural change carries a citation comment in the house format
  (`.sandcastle/CODING_STANDARDS.md`) naming the contract it implements —
  here `// SPEC22 §1.1 (issue #262): …` for the untitled-buffer focus,
  `// SPEC35 §4.2 (issue #262): …` for the sidebar row, `PRD 009 Req 13` for
  the picker and `PRD 019 Req 10` for the scratchpad.
- Any CSS touched satisfies the style lint in `scripts/validate.mjs` and
  `docs/STYLE-GUIDE.md` (scale tokens for font-size / border-radius /
  box-shadow, no raw colour literals in chrome rules, no bare descendant
  element selectors, `ui/` primitives for buttons).
- `docs/MAP.md` is regenerated with `npm run map` only if a `SPEC<n>`
  citation set changed; the e2e count in `scripts/validate.mjs` is a floor,
  so added tests need no edit there.
- Iteration used `npm run typecheck` + `npm run test:unit` (plus targeted
  `npx playwright test -g '<title>'` runs for the tests being touched). The
  full gate was **not** run as a start-of-attempt baseline and not after
  every change — baseline with the quick pair only.
- `npm run validate:quick` has been run ONCE, at the end, in the
  implementer's session, and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #262, naming the
  focus seam that was added, which new-file paths now route through it, the
  save-picker `editIntent` fix, and the validate:quick evidence.

## Context

Two independent defects sit behind one symptom.

*Mode.* `viewModeForOpen(remembered, mayEdit, editIntent)`
(`src/lib/modeSwitch.ts:58`) is the one rule that decides an open's mode, and
`editIntent: true` is the existing "this is a brand-new file" signal. The
folder-pane paths already pass it (`src/App.tsx` ~2704/~2716); the save
picker's `commitSavePicker` (~3668) does not, and `startUntitled` (~3866)
sets `'edit'` directly. Adding the missing flag is the whole mode fix.

*Focus.* Nothing in `src/App.tsx` ever focuses the editor — grep for
`.focus()` there and you get nothing. The only focus is
`editor/src/components/Editor.tsx` ~1913, inside the CodeMirror mount effect
whose deps are `[]`. So it fires when the Editor first mounts (preview → edit
gives you a fresh mount, which is why some paths *feel* right today) and
never again for a `value` swap. `startUntitled` resets the buffer in place;
so does `openDoc` while already in edit mode. That is the always-reproducible
case. The `Editor` element in `src/App.tsx` (~8131) has no `key`, so
remounting per document is not the current design — do not add one as the
fix; it would throw away the parked history/grid state the unmount cleanup
carefully preserves (~2114–2140).

Entry points worth reading before editing: `newFile` / `beginNewFile` /
`canNewFile` (`src/App.tsx` ~4062–4104), `startUntitled` (~3866, called
through `startUntitledRef` by the PRD 019 boot hook at ~2911), `folderCreate`
(~2046) with `folderRenameCommit` / `folderRenameCancel` (~2700/~2710), and
`commitSavePicker` (~3668). The File-menu row and the ⌘N hotkey both go
through `dispatchCommand('newFile', …)` (`src/App.tsx` ~6004,
`src/lib/appMenu.ts:180`), so they need no separate handling.

The seam to add lives on `EditorProps` in
`editor/src/components/Editor.tsx` (~280–470); `EditorSyncHandle` (~238) and
the `insertRef` wiring (~1923) show both handle shapes the package already
uses, and both are nulled in the unmount cleanup — follow that pattern so the
App's ref never outlives a view.

Related reading: `docs/specs/SPEC22.md` (the untitled buffer),
`docs/specs/SPEC35.md` §4.2 (the sidebar New File row, amended by issue
#194), `prd/009-server-mode-menu.md` Req 13+14 (the in-workspace picker),
`prd/019-personal-scratchpad.md` Req 10/11 (the scratch buffer and its
prompt exemption), `editor/AGENTS.md` (the package boundary the gate
enforces), and `tests/e2e/folder-tree.spec.ts` / `tests/e2e/documents.spec.ts`
/ `tests/e2e/hosted.spec.ts` for the New File, ⌘N and scratchpad setup
helpers respectively.
