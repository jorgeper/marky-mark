# Coding Standards

Conventions this repository already follows, stated so a reviewer can decide
each one against a diff. Correctness, clarity and the rest of the general bar
live in `review-checklist.md`; only Marky Mark-specific rules belong here.

## Style

- New or changed behaviour carries a citation comment naming the contract it
  implements: `// SPEC<n> §x.y: <what and why>` (or `PRD <n> §x` for PRD
  work) — e.g. `src/lib/embedded.ts:22`, `src/lib/hotkeys.ts:87`. Behaviour
  that a spec or PRD section governs does not land uncited.
- No `console.*` call sites in `src/`. The app runs in a packaged webview
  with no console a user can read, so failures surface through UI state (a
  dialog, an error card, a status line) or are returned to a caller that
  renders them.
- Modules under `src/lib/` are pure logic: no `react`, no `@tauri-apps/*`, no
  imports from `src/components/`. Anything needing a host takes it as an
  argument (a `Platform`, a callback, plain data) so it stays unit-testable.
- Key combos are canonical combo strings (`Mod+E`, `Mod+Shift+S`) matched by
  `src/lib/hotkeys.ts` and turned into accelerators by `src/lib/menuSpec.ts`.
  `Mod+` is the portable modifier (⌘ or Ctrl); a literal `Ctrl+` means strict
  Ctrl on *every* platform (SPEC36 §6.1), never "Ctrl because this is the
  Windows path".

## Testing

- Every test's title starts with its stable ID: `U<n>:` unit, `E<n>:` desktop
  e2e, `W<n>:` web e2e. New behaviour takes the next unused number; numbers
  are never reused or renumbered, and an existing test is never weakened,
  deleted, or marked `.skip` / `.only` / `.fixme` (there are none in the
  suite today).
- Unit `describe` blocks name the contract under test, e.g.
  `describe('SPEC19 updater manifest')`, `describe('PRD 002 §C9 …')`.
- A `src/lib/<camelCaseModule>.ts` is tested by
  `tests/unit/<kebab-case-module>.test.ts` — one file per module, matching
  name (`commentFormat.ts` → `comment-format.test.ts`).
- `getByTestId` is the default e2e selector: new interactive UI ships a
  `data-testid` and is driven by it, and an existing test id is never renamed
  (1300+ call sites depend on them). Class locators stay for DOM the app does
  not own (CodeMirror's `.cm-line`, `.cm-content`) and for rendered-markdown
  or theme structure that has no id to give. Setup goes through
  `tests/e2e/fixtures.ts` and `helpers.ts` (`freshApp`, `fsRead`/`fsWrite`,
  `addComment`, …) rather than being re-implemented in a spec.
- Unit tests do not rely on per-file isolation: the suite runs with
  `pool: 'threads'` and `isolate: false` (`vitest.config.ts`), so every file
  shares worker contexts. A test that mutates module-level or global state
  restores it; one that only passes with a fresh environment per file is
  rejected.
- `.click({ force: true })` is exceptional — the e2e suite has exactly one
  (E93, proving a deliberately-inert tree item does nothing). A new one needs
  an adjacent comment saying why a real user-reachable click can't work.

## Architecture

- Every filesystem, path, dialog, window and event access goes through the
  `Platform` interface (`src/platform/types.ts`). `@tauri-apps/*` is imported
  in `src/platform/tauri.ts` and nowhere else in `src/`; app code never
  assumes an OS or a host.
- A new seam capability is added to `types.ts` and implemented in all three
  backends (`tauri.ts`, `browser.ts`, `web.ts`), or declared optional
  (`setAppMenu?`, `commitFile?`, …) together with the behaviour hosts that
  omit it fall back to.
- Shipped code contains no network call site: no `fetch(`, `XMLHttpRequest`,
  `WebSocket`, `sendBeacon` or `EventSource`. The bundle scan in
  `scripts/validate.mjs` allows exactly zero, so a new one fails the gate as
  well as the review.
- A user-visible action is a named command in `src/lib/commands.ts`, reached
  via `dispatchCommand(id, source)`; toolbar, native menu and hotkeys all
  dispatch rather than calling handlers directly, and `buildMenuSpec` returns
  plain data with no host imports.
- The comment containers are frozen: the `marky-mark-comments` trailer
  marker, its `markimark-comments` read alias, and the `<doc>.comments.json`
  sidecar filename never change — they are interoperable with the sibling
  `md-with-comments` project. If a diff to `src/lib/commentFormat.ts`,
  `embedded.ts` or `sidecar.ts` changes the payload (a field added, removed,
  renamed, retyped, redefined, or serialized differently), it must also bump
  the payload `version` per the MAJOR/MINOR/PATCH rules in
  `docs/COMMENT-FORMAT.md` *and* append a changelog entry and update the
  schema tables there. Both, not either.
- A diff that adds or updates a dependency also commits the regenerated
  `THIRD-PARTY-NOTICES.md` from `npm run licenses` (the allowlist guard
  rejects copyleft/unknown licenses).
