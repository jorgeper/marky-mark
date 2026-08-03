# Launching the Marky Mark v31 build with /goal

Run from `~/src/marky-mark` AFTER SPEC30 is implemented and green.
Prereq: review and approve `docs/specs/SPEC31.md` — it touches
`src-tauri` capabilities (label-pattern widening only), so read §2.1
before approving.

```
/goal Implement docs/specs/SPEC31.md in full (delta on SPEC.md–SPEC30.md as implemented; SPEC31 wins on conflict; no regressions; SPEC8 stays unimplemented with E42–E44 reserved; SPEC28 stays withdrawn). Deliverable: multi-window exactly as SPEC31 prescribes: (1) §1 command `newWindow`, rebindable Mod+Shift+N, File → New Window after New on both layouts; Platform.openMainWindow?() — real second main window on desktop, same-origin popup in the dev shim (aux-window pattern), undefined on web (silent no-op). (2) §2 labels main/main-2/…; windowRole routes every main* label to the main app (mainLabel helper); src-tauri main capability widens to the main* label pattern with ZERO permission changes (print the reviewed diff in the transcript); open routing: focus the window already showing the path, else reuse a docless main, else create one — coordinated by the oldest live main over the SPEC13 bus; drag-drop stays window-local; SPEC30 reopen fires in the first window only. (3) §3 shared state: settings/recents/positions write-through + changed-event rebroadcast, last-writer-wins, all mains converge; drafts become draft-<label>.json with boot restore scanning all and offering the newest; aux windows stay app-wide singletons paired to their opener. (4) §4 per-window close guards unchanged; Quit walks every dirty window, any Cancel aborts. (5) §5 tests exactly U60, E93–E95 with no amendments to existing tests. (6) §6 docs — ARCHITECTURE.md multi-window section + README line. Done when: 'npm run validate' exits 0 with complete output — U1–U60, E1–E41 plus E45–E95, W1–W11, the single-file check, the static bundle scan, and 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'git diff src-tauri/' shows only the capability label-pattern widening (diff printed and reviewed in the transcript, no new permission identifiers), AND no dependency or version-file changes, AND 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing, AND the Windows-reserved-name scan prints nothing. Constraints: the spec files and this condition must not be modified; tests may not be weakened, stubbed, or deleted; the aux capability, CSP, sanitize schema, and SPEC11 network isolation are byte-unchanged; settings ownership must never regress the SPEC13 aux protocol (E51–E53 stay green). Stop after 100 turns or 10 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part — the parts automation can't see)

- ⌘⇧N: a real second window; open different docs in each; edit both;
  ⌘W on the dirty one prompts, Cancel keeps it.
- Finder: double-click a doc already open in window 1 → window 1
  focuses (no duplicate); double-click a new doc with an empty window
  around → it lands there; with every window occupied → a fresh window.
- ⌘Q with two dirty windows: two prompts, Cancel on the second aborts
  the quit and both windows survive.
- Change the theme in one window: the other follows instantly.
- Force-quit with unsaved edits in both windows: relaunch offers the
  newest draft.
