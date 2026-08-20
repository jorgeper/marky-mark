# Spec: Tabs on top: ephemeral "Untitled" tab for new buffers (#146)

## Goal

All acceptance criteria in issue-specs/issue-146.md are satisfied for issue
#146, with evidence visible in the session: the ephemeral "Untitled" tab in
the file tab strip carries the SPEC36 trailing slot — a dirty ● whenever the
untitled buffer has unsaved changes, swapped for a ✕ on tab hover — whose ✕
(and middle-click) closes through the existing dirty-untitled guard, the very
path File → Close File already takes (clean ⇒ splash; dirty ⇒ the Save /
Don't Save / Cancel prompt, where Save is Save As and a cancelled Save As
leaves the buffer open and dirty), the untitled tab still never joins the
persisted open set and is replaced on Save As by the saved file's real tab
(active, a member of the open set per SPEC36), new e2e coverage from E292
exists in tests/e2e/file-tabs.spec.ts, `npm run validate:quick` has been run
in the implementer's session and passes, and a summary comment from the
implementer exists on issue #146.

## Acceptance criteria

- The untitled tab rendered by `src/components/FileTabStrip.tsx` carries the
  same trailing slot as the open-set tabs (PRD 013 Req 5 / SPEC36 §3.4,
  §3.6): a dirty ● whenever the untitled buffer is dirty — App's `dirty`
  state, since an untitled buffer is outside `dirtyOpenFiles` by SPEC36
  §2.6 — swapped for the ✕ on tab hover, with the slot always reserved so
  the "Untitled" label never reflows or re-clips when they swap. A clean,
  unhovered untitled tab shows neither.
- The untitled tab's ✕ closes through the **existing** dirty-untitled guard —
  the same call File → Close File makes over an untitled buffer
  (`src/App.tsx`, the `closeFile` command: dirty ⇒
  `setOpenPrompt({ kind: 'close-untitled' })`; clean ⇒ `closeToSplash()`).
  No second close path is introduced in App or in the strip, and no new
  landing rule: closing the untitled tab ends in exactly the state that
  dispatching `closeFile` over the same buffer ends in.
- Through that guard: **Cancel** leaves the untitled buffer open, active and
  dirty (its tab still shows the ●); **Don't save** discards it; **Save**
  runs Save As (SPEC22 §2.2) and, on a cancelled Save As dialog/picker
  (SPEC22 §2.3), leaves the buffer open and dirty rather than closing it.
- The ✕'s pointer events never reach the tab (`pointerdown`/`click`
  stopped), matching the open-set tabs' ✕ from issue #145.
- Middle-click on the untitled tab closes it through that same call, with the
  browser default suppressed on both the middle mousedown and the auxclick
  so it never autoscrolls or pastes.
- Right-click on the untitled tab does **not** open the PRD 013 Req 7 tab
  context menu: Close Others / Close All are walks over the SPEC36 open set,
  which the untitled buffer sits outside (§2.6), so its close affordances are
  the ✕ and middle-click only. The menu opened from an open-set tab is
  unchanged from issue #145 — its walks close only open-set files and leave
  the untitled buffer as the active document.
- The untitled tab never joins the persisted open set: with files open and an
  untitled buffer active, `openFiles`, the sidebar's open rows and the
  persisted open-set state carry no "Untitled" entry, and none appears after
  a restart.
- On Save As, the untitled tab is replaced by the saved file's real tab: no
  "Untitled" tab remains, exactly one tab exists for the saved path, it is
  the active tab, and the file is a member of the open set (SPEC36, via
  `openDoc`'s `addOpen`). This should already fall out of the existing
  `writeDocCopyTo` → `openDoc` path — the criterion is that it is asserted,
  not that it is rebuilt.
- The `FileTabStrip` doc comments that currently defer this behaviour to
  issue #146 ("Its close affordance and Save As replacement land in issue
  #146", "no close slot, no middle-click, no context menu until issue #146")
  are updated to describe what now ships; every new or changed behaviour site
  carries a citation comment per `.sandcastle/CODING_STANDARDS.md` and
  `docs/COMMENT-FORMAT.md`.
- New e2e coverage lands in `tests/e2e/file-tabs.spec.ts` at the next free
  E numbers (E292+; verify uniqueness across `tests/e2e/` before numbering)
  and exercises at least: the ●/✕ swap on the untitled tab with no width
  jitter; the clean close; the dirty close through Cancel / Don't save /
  Save (including a cancelled Save As); middle-click; right-click opening no
  tab menu; the open set staying untouched while untitled is active; and the
  Save As replacement (Untitled tab gone, saved file's tab active and in the
  open set).
- Any new pure logic (menu model, slot derivation) lives in `src/lib/` with
  unit tests, in the mold of `src/lib/fileTabs.ts`; the web build is
  untouched (PRD 013 non-goal — the strip is desktop-only behind
  `tabStripSeam`) and existing W tests stay unchanged.
- `docs/MAP.md` is regenerated with `npm run map` if citation sites changed
  (the validation gate diffs it against the generator's output); it is never
  hand-edited.
- Iterate with `npm run typecheck` and `npm run test:unit` (or a single
  targeted e2e via `npx playwright test -g '<title>'`) — not the full suite.
  Run `npm run validate:quick` ONCE, right before declaring the goal met (not
  as a start-of-attempt baseline), and it prints
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #146.

## Context

The strip already exists and already renders the untitled tab — issue #144
added it (`src/components/FileTabStrip.tsx`, the `p.untitled &&` branch near
the end of the component, currently `<Tab active label="Untitled" ... />`
with no `onClose`, which is exactly what suppresses the slot, middle-click
and menu). Issue #145 built the close affordances for open-set tabs (the
`file-tab-slot` / `file-tab-dirty` / `file-tab-close` markup and CSS, the
`useAnchoredMenu` hook, the `closeQueueRef` walk); this issue reuses that
markup and styling rather than adding a parallel one.

The guard to route into lives in `src/App.tsx`: the `closeFile` command
(~line 4017) branches `docPath ⇒ closeOpenFile(path)` / `untitled && dirty ⇒
setOpenPrompt({ kind: 'close-untitled' })` / else `closeToSplash()`, and the
`close-untitled` arms of the open-prompt modal (~line 7150+) already handle
Don't save, Save (via `saveDoc` → `saveDocAs`, false ⇒ abort) and Cancel. The
strip's props come from the `<FileTabStrip .../>` render site (~line 6657),
where `untitled` and the App-level `dirty` flag are both in scope. Save As on
an untitled buffer reaches `writeDocCopyTo` → `openDoc`, which does
`setUntitled(false)` and `commitOpenSet(addOpen(...), path)` — that is the
"real tab replaces the ephemeral one" path.

PRD 013 Req 8 is the requirement this issue closes; SPEC36 §2.6 is the rule
that keeps the untitled buffer outside the open set. Existing e2e in
`tests/e2e/file-tabs.spec.ts` (E266–E279) shows the setup helpers — `E266`
already asserts the untitled tab renders active and appended after the
open-set tabs, and the `E272+` block has the ●/✕ hover assertions to mirror.
