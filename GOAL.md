# Launching the Markimark build with /goal

Run from this directory (`marky-mark/`), which should contain only `SPEC.md` and this
file. For an unattended run, enable auto/permissive mode so tool calls don't block.

## Interactive (paste into a Claude Code session)

```
/goal Implement SPEC.md in full. Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U8, e2e tests E1–E12, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' exits 0 with the produced .app path and size (< 25 MB) printed, AND 'grep -rn ".skip\|.only\|.todo" tests/' prints nothing, AND 'ls themes/' shows the seven built-in themes, AND THEMES.md and ARCHITECTURE.md exist with ARCHITECTURE.md stating the anchor coordinate space and measured perf numbers, AND a sidecar fixture from ../md-with-comments is in fixtures/ and covered by U8. Constraints: SPEC.md and this condition must not be modified; tests must contain real assertions per SPEC.md §8 and may not be weakened, stubbed, or deleted to pass; the Playwright suite must drive the real UI through the browser platform shim; if something is infeasible, record it in BLOCKERS.md instead of gaming the check. Read ../md-with-comments (SPEC.md, ARCHITECTURE.md, src/lib/) before implementing the comments feature. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

## Unattended one-liner (overnight)

```bash
claude -p "/goal Implement SPEC.md in full. Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U8, e2e tests E1–E12, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' exits 0 with the produced .app path and size (< 25 MB) printed, AND 'grep -rn \".skip\|.only\|.todo\" tests/' prints nothing, AND 'ls themes/' shows the seven built-in themes, AND THEMES.md and ARCHITECTURE.md exist with ARCHITECTURE.md stating the anchor coordinate space and measured perf numbers, AND a sidecar fixture from ../md-with-comments is in fixtures/ and covered by U8. Constraints: SPEC.md and this condition must not be modified; tests must contain real assertions per SPEC.md §8 and may not be weakened, stubbed, or deleted to pass; the Playwright suite must drive the real UI through the browser platform shim; if something is infeasible, record it in BLOCKERS.md instead of gaming the check. Read ../md-with-comments (SPEC.md, ARCHITECTURE.md, src/lib/) before implementing the comments feature. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work."
```

## Notes

- `/goal` requires Claude Code v2.1.139+, an accepted workspace trust dialog, and hooks
  enabled. The evaluator only judges what appears in the transcript — that's why the
  condition demands the full `npm run validate` output be printed, not just claimed.
- Prerequisites on this machine: Rust toolchain (`rustup`), Xcode command-line tools,
  Node 20+. The first `npm run tauri build` compiles the Rust host and can take several
  minutes; that's expected.
- The turn/time cap is a safety valve for an unattended run. If it hits the cap, re-issue
  the same goal in a fresh session to resume — the condition is idempotent.
- After it goes green: double-click a `.md` file in Finder to verify the file
  association, and try dropping a custom theme into
  `~/Library/Application Support/com.markimark.app/themes/`. These two are manual checks
  (file associations aren't automatable headlessly).
