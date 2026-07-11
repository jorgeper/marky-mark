# Launching the Marky Mark v15 build with /goal

Run from `~/src/marky-mark`. Prereq: review and approve
`docs/specs/SPEC15.md` first — the goal implements exactly what it
prescribes.

```
/goal Implement docs/specs/SPEC15.md in full (delta on SPEC.md–SPEC14.md as implemented; SPEC15 wins on conflict, no regressions; SPEC8 stays unimplemented with E42–E44 reserved; out of scope: a sync setting, full-screen-edit sync, horizontal sync, follower smooth-scroll animation, per-keystroke re-sync). The deliverable is synchronized scrolling in split-edit mode: bidirectional — whichever pane the user scrolls is the leader and the other follows within one animation frame, with programmatic follower scrolls marked so they never re-trigger sync (no feedback loop or jitter); the alignment contract is that the markdown source line at the top of the leader's viewport lands at the top of the follower's viewport, interpolated proportionally between block anchors, accurate to ±one block, with both document ends clamped mutually reachable; typing does not itself re-sync; SPEC14 comment navigation scrolling the split preview counts as a preview lead. Mechanism per SPEC15 §2–§3: an inline rehype step in src/lib/markdown.ts (no new dependencies, like blockRemoteImages) stamps top-level block elements with data-mm-line = their 1-based markdown source start line from remark position data, best-effort with gaps interpolated; the sanitize schema admits exactly one new attribute (dataMmLine) and nothing else, rendered text stays byte-identical so the comment-anchor coordinate space and sidecar interop are untouched and the SPEC11 network-isolation guarantee is unchanged; pure src/lib/scrollSync.ts provides lineAtOffset(anchors, contentHeight, scrollTop) and offsetForLine(anchors, contentHeight, line) with round-trip stability; Editor exposes an imperative syncRef handle (read fractional top line, scroll to fractional line, subscribe to user scrolls) built on CodeMirror line-block geometry so wrapped lines measure correctly; the preview anchor table is read from [data-mm-line] offsetTops and rebuilt on render, resize, and divider drag — never per scroll frame; App.tsx wires the controller only while the split view is mounted; identical on web. Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U28, desktop e2e E1–E41 plus E45–E58, web e2e W1–W5, the single-file check, the static bundle scan line, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' (macOS) exits 0 with the app path and size printed, AND the Windows-reserved-name scan (git ls-files | tr '/' '\n' | sort -u | awk -F. '{print tolower($1)}' | sort -u | grep -xE 'aux|con|prn|nul|com[0-9]|lpt[0-9]') prints nothing, AND 'git diff src-tauri/tauri.conf.json' shows no CSP change with the sanitize-schema diff admitting only dataMmLine, AND README's edit-mode bullet mentions synchronized scrolling, AND 'git diff --stat docs/specs' is empty and 'grep -rEn "\.(skip|only|todo)\(" tests/' prints nothing. Constraints: the spec files and this condition must not be modified; tests may not be weakened, stubbed, or deleted — the only permitted test additions are U27–U28 and E57–E58 (all existing tests unchanged); no new runtime dependencies; the sidecar/trailer formats, theme format, comment-anchor coordinate space, SPEC11 network-isolation guarantee, SPEC13 aux-window protocol, SPEC14 navigation behavior, and all existing user-visible web behavior are unchanged; the version files stay at 0.2.0-alpha.3. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

## After it goes green (your part)

```bash
cd ~/src/marky-mark
! git push                                # ship synchronized scrolling
# optionally cut the next alpha per docs/RELEASING.md
```

Manual checks (the parts automation can't see):

- Open a long document, `⌘E` into split mode. Scroll the **editor** through
  a stretch with a big code block and a table — the preview tracks live and
  the same content stays level in both panes, no drift, no rubber-banding.
- Scroll the **preview** instead — the editor follows. Flick-scroll fast and
  let go: both panes settle instantly, no oscillation.
- Type a few lines mid-document — the panes don't jump while typing; the
  next scroll is back in lockstep.
- Drag the divider, resize the window, switch themes — sync still accurate.
- `⌥⌘↓` through comments in split mode — the editor follows the preview.
- Web build: same behavior in the browser single-file page.
