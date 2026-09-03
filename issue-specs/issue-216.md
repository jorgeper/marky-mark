# Spec: Scratch-buffer save naming: first-heading Save As pre-fill, then normal file semantics (#216)

## Goal

All acceptance criteria in issue-specs/issue-216.md are satisfied for issue
#216, with evidence visible in the session: the first save of the
`/scratchpad` scratch buffer routes to Save As with the picker name
pre-filled from the buffer's first Markdown heading, else its first
non-empty line (sanitized for a filename), falling back to a
`YYYY-MM-DD HH.mm` timestamp for unnamed pastes, with `.md` appended when
missing, collisions deduped via the existing `uniqueChildName` behavior,
and the scratchpad's root as the default folder; once saved the file is an
ordinary workspace file with no residual scratch semantics (the SPEC36
prompt and all standard behaviors apply); non-scratch untitled buffers
keep their existing `Untitled.md` pre-fill; and `npm run validate:quick`
passes in the implementer's session.

## Acceptance criteria

- (PRD 019 Req 12) **First save routes to Save As with a content-derived
  name.** Saving the scratch buffer auto-opened by `/scratchpad` (Save or
  Save As — Save on an untitled buffer already routes to Save As,
  `saveDoc` in `src/App.tsx`) opens the in-workspace save picker
  (PRD 009 Req 14 — hosted has no `saveFileDialog`, so the picker is the
  only Save As surface here) with the name pre-filled from the buffer's
  content instead of `Untitled.md`:
  - the first Markdown heading in the buffer, when one exists;
  - else the first non-empty line;
  - the chosen text is sanitized into a valid filename — it must pass the
    existing `validateEntryName` (`src/lib/folderOps.ts`: no `/` or `\`,
    no leading `.`, no trailing dot/space, ≤255 chars including the
    appended `.md`, no reserved Windows stems) with Markdown markup
    (heading `#`s, inline formatting) stripped;
  - when the buffer is empty of usable text (or sanitization yields
    nothing), the pre-fill is a timestamp of the form `YYYY-MM-DD HH.mm`;
  - `.md` is appended when the derived name lacks an extension;
  - a collision with an existing name in the target folder dedupes via
    the existing `uniqueChildName` behavior (`base 2.md`, `base 3.md`, …),
    matching `defaultName`'s current use of it (`src/lib/savePicker.ts`).
- (PRD 019 Req 12) **Default folder is the scratchpad's root.** The
  picker opens on the scratchpad workspace's root folder (an untitled
  buffer has no `docDir`, so `defaultFolder` already yields the first
  root — verify this holds rather than re-plumbing it).
- **Scoped to the scratch buffer.** Non-scratch untitled buffers (File →
  New anywhere, including hosted) keep today's `Untitled.md` pre-fill —
  PRD 019's Non-goals explicitly defer generalizing content-derived
  naming. Desktop/shim/web native-dialog paths are unchanged.
- (PRD 019 Req 13) **Saved means normal.** After the save commits, the
  file is an ordinary workspace file with no residual scratch semantics:
  the SPEC36 §2.6 unsaved-changes prompt and close guard apply to
  subsequent edits of it, and re-saving uses normal Save (no picker).
  #215 already clears the exemption on save (`scratchRef.current = false`
  in `openDoc`, `src/App.tsx:2159`) — this criterion is verified
  behavior, not necessarily new code.
- The name-derivation logic is pure and unit-tested (no DOM, no I/O), in
  the `src/lib/savePicker.ts` style — cases covering: ATX heading,
  setext heading or plain first line, markup stripping, sanitization of
  invalid characters, empty/whitespace-only buffer → timestamp,
  extension already present, `.md` appended, collision dedupe. Existing
  `defaultName` behavior for non-scratch callers is unchanged and its
  tests still pass (`tests/unit/save-picker.test.ts`).
- An e2e test in `tests/e2e/hosted.spec.ts` — numbered with the next free
  `E<n>`; last used is E398 — drives the flow: visit `/scratchpad`, type
  content beginning with a heading, invoke Save, and assert the picker
  pre-fills the heading-derived name; committing it lands the file in
  the scratchpad root and the saved document then behaves as a normal
  file (e.g. a subsequent dirty close prompts).
- New behavior carries citation comments in the existing style
  (`PRD 019 Req 12: …` / `Req 13: …`), per
  `.sandcastle/CODING_STANDARDS.md`.
- The implementer iterated with `npm run typecheck` and
  `npm run test:unit` (or tests targeted at the changed code) after each
  change, and ran `npm run validate:quick` ONCE, right before declaring
  the goal met — not after every small change and not as a full-suite
  baseline at the start. It prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #216.

## Context

PRD: `prd/019-personal-scratchpad.md` (this issue is Reqs 12–13).
Parent: #211; blocker #215 is already on this branch: the scratch buffer
exists (`platform.scratchStart` → `scratchRef` in `src/App.tsx`), and
`scratchRef.current` is the "this untitled buffer is the scratch buffer"
signal to key the new pre-fill on.

Key seams: `openSavePicker('saveAs')` (`src/App.tsx:~3389`) computes the
pre-fill via `defaultName(kind, { docBasename, existing })`
(`src/lib/savePicker.ts`) — the natural change is a pure helper there
(fed the buffer text and a clock) that `openSavePicker` uses when
`scratchRef.current` is set, keeping the logic unit-testable and
`defaultName` untouched for everyone else. `uniqueChildName` and
`validateEntryName` live in `src/lib/folderOps.ts`; `withDefaultExtension`
in `savePicker.ts` already appends `.md`. Heading parsing precedents:
`src/lib/tocModel.ts` / `sectionModel.ts` (don't over-import — a small
local first-heading scan is fine). Unit tests:
`tests/unit/save-picker.test.ts`; e2e helpers:
`tests/e2e/helpers.ts`, hosted flow precedents in
`tests/e2e/hosted.spec.ts` (the #215 tests show how to reach
`/scratchpad`).
