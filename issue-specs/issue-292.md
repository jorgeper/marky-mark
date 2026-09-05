# Spec: Name at save: the scratch buffer's first save opens the New File picker pre-filled Untitled.md (#292)

## Goal

All acceptance criteria in issue-specs/issue-292.md are satisfied for issue
#292, with evidence visible in the session: saving the scratch buffer (⌘S,
the Save command or Save As…) opens the in-workspace picker at the scratch
workspace root pre-filled with a free `Untitled.md` and no content-derived
name is proposed anywhere; cancelling leaves the scratch buffer intact and an
empty buffer still asks; unit coverage for the pre-fill lands and the tests
that asserted the heading-derived pre-fill are updated rather than deleted;
`npm run validate:quick` passes and a summary comment from the implementer
exists on issue #292.

## Acceptance criteria

- **Req 9 — the pre-fill is a free `Untitled.md`.** ⌘S, the Save command and
  Save As… on the scratch buffer all end in the in-workspace save picker
  (PRD 009 Reqs 13–14) with the folder defaulted to the scratch workspace's
  root and the name pre-filled with a free `Untitled.md`, deduped through
  `uniqueChildName` exactly as the sidebar's New File does (`Untitled 2.md`
  when `Untitled.md` is taken). No heading-, first-line- or timestamp-derived
  name is proposed for this buffer by any code path.
- **PRD 019 Req 12 is retired for this buffer.** The content-derived pre-fill
  no longer runs: `scratchSaveName` (and any helper left with no other caller
  — `firstContentLine`/`stripMarkup`/`sanitizeName`/`timestampName` in
  `src/lib/savePicker.ts`) is gone from the tree along with the special-case
  branch in `openSavePicker` (`src/App.tsx` ~line 3525), rather than being
  left dead. No `PRD 019 Req 12` citation survives claiming behaviour that no
  longer exists; the citation comments at the touched sites name PRD 023 Req 9
  and read as instructions (`.sandcastle/CODING_STANDARDS.md`).
- **Req 9 — no silent save path.** There is no route by which the scratch
  buffer is written without the picker answering (`saveDoc` still routes an
  untitled buffer to Save As, and the autosave-on-toggle path stays gated on
  an existing `docPath`).
- **Req 10 — cancel keeps the buffer.** Cancelling the picker returns to the
  scratch buffer unchanged: still labelled "Scratch file" with its accent /
  italic treatment (PRD 023 Reqs 6–7), still prompt-exempt on leave, still
  dirty if it was dirty, nothing written to the workspace.
- **Req 11 — an empty buffer still asks.** Saving with nothing typed opens the
  same picker with the same `Untitled.md` pre-fill; committing writes an empty
  file, which is a legitimate result.
- **Req 12 — saved means normal.** Once written, the file is an ordinary
  workspace file: real name in toolbar/tab/title with normal styling, plain
  re-save with no picker, and the standard SPEC36 §2.6 unsaved-changes prompts
  from then on (PRD 019 Req 13 unchanged).
- **Nothing else changes.** The New File / right-click new-file flow is
  untouched everywhere, including inside the scratch workspace (PRD 009 Reqs
  13–14), and ordinary untitled buffers — including ⌘N inside the scratch
  workspace — keep their existing Save As pre-fill behaviour (`defaultName`).
  Desktop/single-file builds and any platform with a native `saveFileDialog`
  are untouched. `prd/019-personal-scratchpad.md` and `prd/023-scratch-fresh-buffer.md` are NOT
  edited; PRDs are historical contracts, the code cites them.
- **Unit coverage lands with the slice.** New U-numbered tests (next free id
  is U1131) cover the pre-fill the scratch buffer now gets — a free
  `Untitled.md` and its `uniqueChildName` dedupe against a listing — at the
  pure-lib tier (`tests/unit/save-picker.test.ts`). The cancel path and the
  empty-buffer path are covered at the tier where each is actually testable:
  pure-lib if the implementer factors the decision into `src/lib/`, otherwise
  in the hosted Playwright suite.
- **The heading-pre-fill tests are updated, not deleted.** `U1039`–`U1042`
  (`tests/unit/save-picker.test.ts`, `describe('PRD 019 Req 12 scratch save
  name')`) and hosted `E399` (`tests/e2e/hosted.spec.ts` ~line 4034) assert
  the retired behaviour; they are rewritten to assert the `Untitled.md`
  pre-fill, the scratch root as the folder, cancel, the empty buffer and the
  saved-file-is-normal tail — the coverage they carried is not lost. Broad new
  hosted e2e coverage for PRD 023 Req 13 belongs to the follow-on issue, not
  this one.
- **`docs/MAP.md` is regenerated** with `npm run map` and committed if the
  SPEC citations in `src/` or `tests/e2e/` changed (the gate diffs it).
- **Test economy.** Iteration uses `npm run typecheck` and `npm run test:unit`
  (or a single targeted Playwright test, `npx playwright test -g '<title>'`);
  the full gate is not used as a baseline and is not re-run after every change.
- **`npm run validate:quick` has been run once in the implementer's session,
  right before declaring the goal met, and printed `QUICK VALIDATION: ALL
  PASSED`.**
- **A summary comment from the implementer exists on issue #292** describing
  what changed, the tests added/updated, and the gate evidence.

## Context

Hosted (cloud) build only — scratch does not exist on desktop or single-file
builds. The relevant code is small and already located:

- `src/App.tsx` ~3505–3540 `openSavePicker` — builds `folders`/`folder` via
  `pickerFolders`/`defaultFolder` (an untitled buffer has no `docPath`, so the
  folder falls back to the workspace's first root, i.e. the scratch root) and
  picks the name; the `kind === 'saveAs' && s.untitled && scratchRef.current`
  branch is the PRD 019 Req 12 special case to remove. `defaultName('saveAs',
  { docBasename: null, existing })` already returns a free `Untitled.md`, so
  the ordinary path is what Req 9 asks for.
- `src/lib/savePicker.ts` — `defaultName`, `checkPickerName`,
  `withDefaultExtension`, plus `scratchSaveName` and its private helpers
  (retiring).
- `src/App.tsx` `saveDoc` (~3637) routes ⌘S on an untitled buffer to
  `saveDocAs`, which uses the picker when the platform has no
  `saveFileDialog`; `scratchRef`/`scratch` (~479) marks the boot's scratch
  buffer and drives the "Scratch file" label from `src/lib/docName.ts`
  (issue #291, PRD 023 Reqs 6–8).
- Tests: `tests/unit/save-picker.test.ts` (U1039–U1042),
  `tests/e2e/hosted.spec.ts` E399 (and E397/E398 for the surrounding scratch
  behaviour; helpers `signIn`, `dropDraft`, `listFiles`, `landInPreview`).
  Hosted specs run in the default Playwright suite, so `validate:quick` covers
  them.

Grep `PRD 019 Req 12`, `PRD 023`, `scratchSaveName` and `scratchRef` before
opening anything; never read `App.tsx` whole. Read
`.sandcastle/CODING_STANDARDS.md` before writing code.
