# Spec: E150 presses Control+Home, a no-op on macOS — release CI (macos-latest) fails deterministically (#67)

## Goal

All acceptance criteria in issue-specs/issue-67.md are satisfied for issue #67, with evidence visible in the session: the e2e suite's go-to-document-start keypresses are platform-correct (no bare `Control+Home` at the cited call sites in `tests/e2e/live-preview.spec.ts`), the mechanism resolves to a real macOS document-start binding (document start, not line start) on darwin, E147 and E150 pass locally, and `npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- The two `Control+Home` call sites in `tests/e2e/live-preview.spec.ts` (E147 at line 212, E150 at line 299 as of commit 5167767) no longer press a raw `Control+Home`; each uses a platform-correct go-to-document-start (fix shape is the implementer's call — e.g. a shared helper that presses `Meta+ArrowUp` when the runner is darwin and `Control+Home` otherwise, or an equivalent mechanism that moves the cursor to DOCUMENT start on both Linux and macOS Playwright runners).
- The chosen mechanism moves the cursor to **document start**, not line start: plain `Home` is explicitly wrong (it goes to line start — see the abandoned issue-66 worktree note in Context). On darwin the key sent must be one CodeMirror's mac keymap actually binds to `cursorDocStart` (Cmd+ArrowUp, i.e. Playwright `Meta+ArrowUp`), or the cursor must be placed at document start by other verifiable means.
- E150's assertion still holds as written: after the go-to-start, `.mm-md-h1:not(.mm-md-mark)` contains the full `Big Title` (not a split fragment like `" Big "`).
- If the fix is a shared helper, `tests/e2e/editor.spec.ts:181` (the third `Control+Home` site, currently benign because the preceding click already lands on line 1) has been considered — either migrated to the helper or left with a stated reason; the suite must be consistent enough that no bare `Control+Home` remains that would break on a macOS runner.
- Targeted evidence in-session (this sandbox is Linux): `npx playwright test -g 'E150'` and `npx playwright test -g 'E147'` pass, showing no Linux regression from the change.
- The implementer iterated with `npm run typecheck` and `npm run test:unit` (or tests targeted at the changed code) during development, and ran the full quick gate `npm run validate:quick` ONCE, right before declaring the goal met — not after every small change and not as a starting baseline. It prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #67, describing the fix and the verification evidence.

## Context

Release cut #66 (v0.5.0-alpha.1) failed deterministically on the tag-triggered `release.yml` run, job `test` on `macos-latest`, in `npm run validate` at E150 (`tests/e2e/live-preview.spec.ts:286`), identical on Playwright's in-run retry: `Control+Home` does not move the cursor on macOS, so the revealed H1 stays split and the first `.mm-md-h1` span holds `" Big "` instead of `"Big Title"`. E147 (line 212) presses the same key for the same purpose and is equally suspect on macOS.

Only test code changes are expected — no `src/` behaviour is implicated. Shared e2e setup lives in `tests/e2e/helpers.ts` / `fixtures.ts`; a `goToDocStart(page)` helper there is the natural home for a platform switch (`process.platform === 'darwin'`), since Playwright's runner platform matches the browser's reported platform, which is what CodeMirror's keymap dispatches on (mac binds Cmd-ArrowUp to `cursorDocStart`; PC binds Ctrl-Home).

**Warning from the issue:** the abandoned issue-66 worktree (`.sandcastle/worktrees/sandcastle-issue-66`) holds an unpushed local commit e3832d7 ("press Home, not Control+Home"). Do not adopt it: plain `Home` goes to LINE start, but these call sites need DOCUMENT start. Verify semantics against what E150 asserts.

macOS cannot be exercised from this Linux sandbox; the in-session evidence is the Linux-green targeted tests plus the platform-conditional mechanism being correct by construction against CodeMirror's documented mac keymap. This issue blocks the release lane: #66 is abandoned and the next cut re-files as 0.5.0-alpha.2 once this lands.
