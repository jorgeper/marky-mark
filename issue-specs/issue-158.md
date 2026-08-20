# Spec: close individual file hot key (#158)

## Goal

All acceptance criteria in issue-specs/issue-158.md are satisfied for issue
#158, with evidence visible in the session: ⌘W on macOS (Ctrl+W elsewhere)
closes the current file only — never the app or the window — through the
existing `closeFile` command with its dirty prompt intact, the binding is a
listed, rebindable row in Settings → Hotkeys and shows as the Close File
accelerator in the native File menu with no other item still claiming the
same chord, a focused Settings/About window still closes on ⌘W,
`npm run validate:quick` passes in the implementer's session, and a summary
comment from the implementer exists on issue #158.

## Acceptance criteria

- `DEFAULT_HOTKEYS` in `src/lib/hotkeys.ts` gains a `closeFile` entry bound
  to `Mod+W` (⌘W on macOS, Ctrl+W on Windows/Linux — the `Mod` alias already
  does that split), with a `HotkeyMap` field beside it. `Mod+W` conflicts
  with no other shipped default: `combosConflict` returns false against every
  other entry in the map (`Mod+Shift+W` / toggleWordCount is a distinct chord
  because `eventMatches` compares Shift strictly), and no existing default
  binding is moved or renamed to make room.
- Pressing the chord with a document open closes **only that document** and
  leaves the app and the window running: the global keydown listener in
  `src/App.tsx` (~line 5225, the `eventMatches(e, hk.…)` chain) dispatches the
  existing `closeFile` command id — it does not grow a second copy of the
  close logic. With more than one file open, the neighbour activates per
  SPEC36 §3.5 (`nextActive`); with one file open, the splash shows; a dirty
  file raises the same three-way prompt the tab ✕ raises (SPEC36 §3.4) and
  Cancel leaves the file open and dirty; a dirty untitled buffer raises the
  `close-untitled` prompt exactly as it does from the menu row.
- Nothing about ⌘W closes the window or quits: on the splash, with no
  document and no untitled buffer open, the chord is a silent no-op — it must
  not start the SPEC12 §1.5 quit walk, close the main window, or show a
  prompt. (This is the user's ask read literally: "close current file, not the
  entire app". The cost — mac's File ▸ Close Window loses its ⌘W — is
  deliberate; ⌘Q still quits.)
- SPEC13 §1.3 is preserved: with the Settings or About aux window focused,
  ⌘W closes **that window** and does not close a document in the main window.
  Today `Mod+W` is the native accelerator for the `close` command, whose
  handler tries `closeFocusedAuxWindow()` first (`src/App.tsx` ~4242) while
  `AuxWindow.tsx` also closes itself on Mod+W; whichever way the accelerator
  is re-routed, both of those paths still end with only the aux window closed.
- The native menu spec (`src/lib/menuSpec.ts`) shows the binding on the Close
  File row in both the macOS and the Windows/Linux File menus — via
  `s.hotkeys.closeFile`, so a rebind in Settings moves the accelerator with it
  (the pattern `save` / `newFile` / `toggleOpenOnly` already use) — and no two
  enabled items in one menu carry the same chord: the macOS `close`
  ("Close Window") row no longer claims `Mod+W`. What it claims instead (no
  accelerator, or a demonstrably free combo) is stated in the summary comment.
  `tests/unit/menu-spec.test.ts` is updated for whatever changed there.
- Settings → Hotkeys lists the new binding: `HOTKEY_LABELS` in
  `src/components/SettingsPanel.tsx` gains a `closeFile` label (e.g. "Close
  file"), so the row renders, records a rebind, reports conflicts by label,
  and resets to default like every other row. A stored settings file written
  before this change still loads and picks up the new default (the `hotkeys`
  resolver in `src/lib/settings.ts` ~line 366 lays valid entries over
  `DEFAULT_HOTKEYS` — confirm, don't assume).
- Unit coverage in `tests/unit/` asserts the default binding, its
  non-conflict with the rest of the map, and the menu-spec accelerator on the
  Close File row (`tests/unit/open-files.test.ts` holds the hotkey-model
  tests, `tests/unit/menu-spec.test.ts` the menu ones).
- An e2e test in `tests/e2e/file-tabs.spec.ts` (or `documents.spec.ts`),
  numbered with the next free E-number — E307 is currently the highest in
  `tests/e2e/` — opens two files, fires the chord, and asserts the active
  document closed while the other stayed open and the app is still running;
  and that the chord on the splash changes nothing. Note the hazard: a real
  `page.keyboard.press('Control+w')` may be swallowed or close the page in
  Chromium. Try the real press first (that is what the test is for); if it
  proves unreliable, dispatch the KeyboardEvent into the window instead and
  say so in the test's comment — do not silently downgrade to
  `window.__mmDispatch('closeFile')`, which would test nothing new.
- The web build is left honest: in a browser tab Ctrl+W/⌘W belongs to the
  browser and may never reach the app. That is acceptable and needs no gate
  (the shipped `Ctrl+Tab` default has the same property), but the behaviour is
  called out in the summary comment rather than claimed to work everywhere.
- Behaviour that changed carries a citation comment naming its contract
  (`// SPEC36 §…`, `// SPEC12 §…`, `// Issue #158: …`) per
  `.sandcastle/CODING_STANDARDS.md` and `docs/COMMENT-FORMAT.md`, and
  `docs/MAP.md` is regenerated with `npm run map` if the spec→file mapping
  moved.
- Iteration used `npm run typecheck` and `npm run test:unit` (or a single
  targeted `npx playwright test -g '<title>'`) — not the full suite after
  every change, and no full-suite baseline at the start.
- `npm run validate:quick` has been run ONCE, at the end, in the
  implementer's session and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #158 describing the
  binding, what happened to mac's Close Window accelerator, the aux-window
  and splash behaviour, and the verification evidence.

## Context

Almost everything needed already exists — this issue is a binding, not a
feature. The `closeFile` command id (`src/lib/commands.ts`, Issue #22) is
wired in `src/App.tsx` ~line 4084: with a `docPath` it calls
`closeOpenFile(path)` (dirty ⇒ SPEC36 §3.4 prompt, clean ⇒ close, neighbour
activates per §3.5), with an untitled buffer it prompts or drops to the
splash, and on the splash it returns early. It is reachable from the File menu
(`src/lib/menuSpec.ts`), the in-app menu (`src/lib/appMenu.ts`) and the tab ✕
— but from no keyboard chord. Grep `SPEC36` for the open-file set, `SPEC12`
for the command/menu seam.

The one real collision: on macOS `menuSpec.ts` currently gives `Mod+W` to the
`close` command, labelled "Close Window", whose handler closes a focused aux
window first and otherwise starts the quit walk. That accelerator has to give
way — resolve it deliberately (and keep the aux-window escape working), don't
leave two items on one chord. On Windows the `close` row is "Exit" with no
accelerator, so there is nothing to move.

Hotkeys are canonical combo strings parsed by `src/lib/hotkeys.ts`;
`eventMatches` compares Shift/Alt strictly and `Mod` means ⌘-or-Ctrl, so
`Mod+W` and the existing `Mod+Shift+W` (word count) are separate chords.
Adding a `HotkeyMap` field will surface anywhere the map is enumerated
(SettingsPanel labels, settings resolver, tests) — typecheck will find those.
