# Spec: navigate across open files (#84)

## Goal

All acceptance criteria in issue-specs/issue-84.md are satisfied for issue
#84, with evidence visible in the session: a hotkey cycles forward through the
open files and its partner cycles backward (wrapping, in preview and edit mode,
never inserting a Tab); both bindings are reassignable from Settings → Hotkeys
such that the combo actually pressed is the combo stored — a ⌃-chord on macOS
records as strict `Ctrl+…`, not `Mod+…` — and each row can be restored to its
shipped default on its own; "Next Open File" / "Previous Open File" are
reachable from the View menu showing their current accelerators;
`npm run validate:quick` has been run in the implementer's session and passes;
and a summary comment from the implementer exists on issue #84.

## Acceptance criteria

### Cycling (mostly already shipped — verify, do not rebuild)

- With two or more files open in a workspace, the `nextFile` hotkey (default
  **Ctrl+Tab**) activates the next open file in the sidebar's tree order with
  wrap-around, and `prevFile` (default **Ctrl+Shift+Tab**) reverses. Fewer than
  two open files is a no-op. Unsaved edits in the file being left survive
  without a prompt, and no literal tab character reaches the buffer in edit
  mode. E102 in `tests/e2e/tabs-and-workspace.spec.ts` already proves this and
  is still passing at the end of the attempt.
- From a dirty untitled buffer the cycle still routes through the discard
  guard (SPEC36 §2.6) — unchanged behaviour, no regression.

### Reassignment in Settings (the gap this issue closes)

- Settings → Hotkeys lists **Next open file** and **Previous open file** rows
  (test ids `hotkey-nextFile` / `hotkey-prevFile`) whose displayed value is the
  live binding: `⌃Tab` / `⌃⇧Tab` on macOS, `Ctrl+Tab` / `Ctrl+Shift+Tab`
  elsewhere.
- Recording into a hotkey row stores what was actually pressed: on macOS a
  chord using Control **without** ⌘ records as a strict `Ctrl+…` combo, so
  pressing Ctrl+Tab back into the `nextFile` recorder leaves the stored binding
  as `Ctrl+Tab` instead of silently rewriting it to `Mod+Tab`. On Windows/Linux
  ctrlKey keeps recording as `Mod` (cross-platform portability of recorded
  bindings is preserved). `comboFromEvent`'s existing behaviour for every other
  combo is unchanged.
- A rebound cycle hotkey takes effect immediately (no restart): the new combo
  cycles the open files and the previous combo no longer does. The change
  persists across a reload/relaunch through the existing User-scope settings
  layer.
- Binding a combo that is already bound to another action leaves the map
  unchanged and surfaces the existing "already bound to …" hint (behaviour
  preserved; the conflict check must still see strict-Ctrl and Mod spellings of
  the same physical chord as colliding on macOS, so a rebind cannot leave two
  actions firing on one keypress).
- Every hotkey row can be restored to its shipped default individually, without
  touching the rest of the map — this is what makes a mis-recorded Ctrl+Tab
  recoverable. The existing global **Reset hotkeys** button still resets the
  whole map.

### Discoverability

- The View menu offers **Next Open File** and **Previous Open File** items
  carrying the current `nextFile` / `prevFile` accelerators (they follow a
  rebinding), placed with the other open-file entries, disabled when the
  workspace has fewer than two open files and outside workspace mode. They
  dispatch the existing `nextFile` / `prevFile` command ids.
- SPEC36 §6.4 ("Next/Previous Open File are hotkey-only — no menu items") and
  §6.1 (`comboFromEvent` recording is unchanged and still emits `Mod`) carry an
  `> **Amended (issue #84, 2026-08-06):** …` note in `docs/specs/SPEC36.md`
  stating the new contract, following the amendment convention already used in
  §3.2 and SPEC30 §57.

### Code, tests, and gate

- New or changed behaviour carries `// Issue #84:` citation comments per
  `.sandcastle/CODING_STANDARDS.md`; `docs/MAP.md` is regenerated with
  `npm run map` and committed if any citation moved.
- Unit coverage in `tests/unit/open-files.test.ts` (where the hotkey-model
  assertions live) for the recording rule: mac ⌃-chord → `Ctrl+…`, mac ⌘⌃-chord
  and non-mac ctrlKey → `Mod+…`, and the existing `comboFromEvent({key:'Tab',
  ctrlKey:true}) === 'Mod+Tab'` assertion updated rather than deleted.
- Unit coverage in `tests/unit/menu-spec.test.ts` for the two new View items:
  present, enabled/disabled by open-file count and workspace state, accelerator
  follows the settings map.
- A new E-numbered Playwright test in `tests/e2e/tabs-and-workspace.spec.ts`
  drives the real seam: rebind `nextFile` from the Settings hotkeys tab, prove
  the new combo cycles and the old one does not, restore that row to its
  default and prove Ctrl+Tab cycles again. Use the next free E numbers —
  `main` tops out at E174 and issue #83 is landing E175/E176, so start at
  **E177**.
- Iterate with `npm run typecheck` and `npm run test:unit` (or
  `npx playwright test -g '<title>'` for one e2e), not the full suite. Run
  `npm run validate:quick` **once**, right before declaring the goal met; it
  prints `QUICK VALIDATION: ALL PASSED`. Do not run it as a baseline at the
  start beyond a single optional quick-tier check.
- A summary comment from the implementer exists on issue #84 (what changed,
  decisions, files, gate evidence).

## Context

The cycling half of this issue already shipped as SPEC36 §6 — read
`docs/specs/SPEC36.md` §5–6 first. `cycleOpen(list, active, dir)` in
`src/lib/openFiles.ts` is the pure tree-order-with-wrap function;
`cycleFile` in `src/App.tsx` (~line 1760) wraps it with the untitled/guard
rules; the global keydown handler (~line 3276) matches `hk.nextFile` /
`hk.prevFile` and always `preventDefault`s so CodeMirror never sees the Tab.
`nextFile` / `prevFile` already exist as `CommandId`s in `src/lib/commands.ts`
and as `HotkeyMap` entries in `src/lib/hotkeys.ts`, so the menu items are a
couple of `cmd(...)` lines in the View submenu in `src/lib/menuSpec.ts`.

The real work is in `src/lib/hotkeys.ts` + `src/components/SettingsPanel.tsx`.
`hotkeys.ts` already models strict Ctrl (`ComboParts.ctrl`, matched by
`eventMatches`, rendered `⌃` by `displayCombo`), but `comboFromEvent` maps
`ctrlKey` to `Mod` unconditionally — so the two shipped defaults are the only
strict-Ctrl combos in the app and no recorder can reproduce them. The panel's
`recordHotkey` (`src/components/SettingsPanel.tsx` ~line 217) is the single
call site and already has `isMac` in scope; the row renderer is `hotkeyRow`
(~line 718) and the global reset button is `data-testid="reset-hotkeys"`.
Keep `comboFromEvent`'s existing signature working (extra param, defaulted) so
nothing else has to change.

Hotkeys are User-scope only (issue #21) — the Hotkeys tab is hidden in
Workspace scope, and `settings.ts` merges stored maps over `DEFAULT_HOTKEYS`,
so a new binding needs no migration. E102 is the reference for how e2e drives
cycling; `tests/e2e/helpers.ts` has `seedFolders` / `openNotesRoot` and the
menu helpers (`menuClick`) the new test will want.
