# Launching the Marky Mark v14 build with /goal

Run from `~/src/marky-mark`. Prereq: review and approve
`docs/specs/SPEC14.md` first — the goal implements exactly what it
prescribes.

```
/goal Implement docs/specs/SPEC14.md in full (delta on SPEC.md–SPEC13.md as implemented; SPEC14 wins on conflict, no regressions; SPEC8 stays unimplemented with E42–E44 reserved; out of scope: navigation in full edit mode, web hamburger items, gestures, storage/anchoring changes). The deliverable is comment navigation: rebindable Next/Previous Comment hotkeys (HotkeyMap gains nextComment/prevComment, defaults Mod+Alt+ArrowDown / Mod+Alt+ArrowUp, in the Hotkeys tab with conflict detection; old settings.json files parse to the defaults), View-menu items Next Comment / Previous Comment right after the Comments item on both OS layouts with accelerators that follow rebinds and that vanish with the comments master switch, and a fixed navigator pill — rendered only while a comment is active and the panel is shown, centered at the bottom of the workspace, position-fixed so stepping never moves it (park the mouse and click through), containing ↑ prev, a live n / N counter over open comments, and ↓ next (test ids comment-nav, comment-nav-prev, comment-nav-count, comment-nav-next), themed via the --mm-* variables, never clearing the active comment when clicked. Navigation semantics per SPEC14 §1: open comments in document-position order (byPosition), resolved ghosts skipped, orphans included, wrap at both ends, no-active enters at first (next) / last (prev), zero comments no-op, activation reuses the existing card-activate scroll+flash+card-scroll behavior, works in preview and split-edit, no-ops in full edit mode; all surfaces dispatch the new nextComment/prevComment registry commands and the exactly-once accelerator invariant holds; pure src/lib/commentNav.ts stepComment(orderedIds, activeId, dir) implements the stepping. Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U26, desktop e2e E1–E41 plus E45–E56, web e2e W1–W5, the single-file check, the static bundle scan line, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' (macOS) exits 0 with the app path and size printed, AND the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing, AND 'git diff src-tauri/tauri.conf.json' shows no CSP change, AND README's comments bullet mentions next/previous navigation, AND 'git diff --stat docs/specs' is empty and 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing. Constraints: the spec files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted test additions are U25–U26 and E54–E56 (all existing tests unchanged); no new runtime dependencies; the sidecar/trailer formats, theme format, SPEC11 network-isolation guarantee, SPEC13 aux-window protocol, and all existing user-visible web behavior are unchanged; the version files stay at 0.2.0-alpha.3. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part)

```bash
cd ~/src/marky-mark
! git push                                # ship comment navigation
# optionally cut the next alpha per docs/RELEASING.md
```

Manual checks (the parts automation can't see):

- Open a doc with several comments, click one highlight — the pill fades in
  bottom-center with `n / N`. Park the mouse on ↓ and click repeatedly: the
  selection walks every open comment, scrolling and flashing each, wraps at
  the end, and **the pill never moves under the cursor**.
- `⌥⌘↓` / `⌥⌘↑` do the same from the keyboard with nothing selected (enter
  at first / last). Rebind them in Settings → Hotkeys; the View menu
  accelerators update live.
- Resolve a comment — navigation skips it; the counter total drops.
- Toggle comments off (master switch): pill, menu items, and hotkeys all
  gone; web build (`dist-web`) behaves identically to desktop.
