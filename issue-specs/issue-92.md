# Spec: Single-file mode: save locally via the File System Access API with download fallback (#92)

## Goal

All acceptance criteria in issue-specs/issue-92.md are satisfied for issue
#92, with evidence visible in the session: in single-file mode on a browser
that offers the File System Access API, a file opened (or dropped) with a
retained handle saves **in place** through that handle after the browser's
readwrite permission grant, with no download; a file with no handle — the
`<input type=file>` fallback, a drop without `getAsFileSystemHandle`, or a
browser without the API — still downloads on explicit Save through the
existing `commitFile` path; an in-place write that cannot land (permission
denied or the write throws) never leaves the document looking saved with
nothing written — the download fallback runs instead; both browser flavors
(`src/platform/web.ts` and `src/platform/hosted.ts`) get this from the one
shared `src/platform/localDocs.ts` and desktop (Tauri) save behavior is
unchanged; `npm run validate:quick` has been run in the implementer's session
and passes; and a summary comment from the implementer exists on issue #92.

## Acceptance criteria

### Save in place through the retained handle (Req 15)

- In single-file mode, a Markdown file opened through `showOpenFilePicker`
  keeps its `FileSystemFileHandle`, and **Save** writes the current buffer
  back to that file through the handle. No download is triggered for such a
  file — the browser's own file on disk holds the new bytes.
- The same holds for a file dropped onto the window when the browser supplies
  a handle via `getAsFileSystemHandle` (`listenForDrop` in
  `src/platform/localDocs.ts` already takes that path).
- The browser's permission grant is obtained explicitly rather than left to
  chance: before an in-place write the handle's permission state is checked
  and requested where needed (`queryPermission({ mode: 'readwrite' })`, then
  `requestPermission({ mode: 'readwrite' })` when it is not already
  `'granted'`), on the code path reachable from the user's own Save gesture so
  the browser accepts the prompt. A handle already `'granted'` writes without
  re-prompting on later saves in the same session. The optional
  `queryPermission`/`requestPermission` members are added to the local
  `FSFileHandle` interface (they are not in TypeScript's `lib.dom`).
- Both browser flavors that build on `createLocalDocs` — static web
  (`src/platform/web.ts`) and hosted (`src/platform/hosted.ts`) — get the
  identical behavior from the one shared module. Neither reimplements the
  permission or write-through logic beside it.

### Download fallback (Req 15)

- Where the API is unavailable, or the document arrived without a handle (the
  `<input type=file>` picker fallback, a drag-and-drop path with no
  `getAsFileSystemHandle`), an explicit Save still downloads the file under
  its basename — the existing `commitFile` → `local.commit` path, unchanged in
  behavior.
- A handle-backed save that **cannot** land — the permission request is denied
  or dismissed, or `createWritable()`/`write()`/`close()` throws (a permission
  revoked mid-session) — is not swallowed the way it is today: the download
  fallback runs so the user's bytes still reach them, and the document is
  never left silently marked saved with nothing written anywhere. Whether a
  notice also explains the fallback is the implementer's call; the observable
  requirement is that the bytes land somewhere and the failure is not silent.
- The existing "no download spam" rule survives: writes that are not the
  user's explicit Save (comment autosaves and every other `writeTextFile` on a
  local doc) still update memory — and the handle where there is one — without
  ever triggering a download. The download stays bound to `commitFile`.

### Scope and non-goals

- Desktop (Tauri) save behavior is unchanged (PRD 009 Non-goals):
  `src/platform/tauri.ts`'s `writeTextFile`/`saveFileDialog` and the SPEC3 /
  SPEC22 desktop save flows keep working exactly as today.
- Workspace-mode saves are untouched: only paths `local.owns(path)` answers
  true for change behavior; hosted workspace writes still go through the
  workspace file API with their PRD 007 Req 20 etag conditioning.
- The menu's left move, its grouping and gating, the View submenu, and Sign
  out are **out of scope** (#93/#94/#95). This issue changes only how a
  single-file-mode Save lands.
- No new server route or endpoint: a local document performs no network I/O of
  any kind, as `src/platform/localDocs.ts`'s header contract already states.

### Code, tests, and gate

- The decision the save makes — handle present? permission granted? write
  succeeded, or fall back to a download? — lives in a **pure** module under
  `src/lib/` (no `window`, no `document`, no platform imports; the browser
  seams are passed in as arguments or results), because `vitest` runs in a
  `node` environment. `src/platform/localDocs.ts` calls that module rather
  than growing untestable branching.
- New or changed behavior carries `// PRD 009 Req 15:` citation comments per
  `.sandcastle/CODING_STANDARDS.md`, and `docs/MAP.md` is regenerated with
  `npm run map` and committed if any citation moved.
- Unit coverage in `tests/unit/<kebab-case-module>.test.ts` for the pure
  module, covering: an already-granted handle writes in place; a `'prompt'`
  handle that the user grants writes in place; a denied request falls back to
  the download; a write that throws falls back to the download; a handle-less
  doc downloads; and a non-explicit write downloads nothing. Test titles start
  at the next free `U` number — the suite tops out at **U335**, so start at
  **U336**.
- At least one e2e in the desktop-shim-collected suite (so `validate:quick`
  runs it) — `tests/e2e/hosted.spec.ts` is where hosted single-file mode is
  already exercised, next free number **E213** — drives hosted single-file
  mode with a **stubbed** `window.showOpenFilePicker` installed via
  `addInitScript` (a fake handle whose `createWritable` records what was
  written and whose `queryPermission`/`requestPermission` are scriptable), and
  asserts: Save writes the edited buffer through the handle, fires no
  download, and makes no `/api/workspaces` write request; and that with the
  permission request denied the same Save produces a download instead.
- No existing test is weakened, skipped or deleted to get there. The tests
  that force the fallback by deleting `showOpenFilePicker` — E202 and E212 in
  `tests/e2e/hosted.spec.ts`, and the `tests/e2e/web.spec.ts` suite's
  init script (W9's download assertion) — keep passing unchanged.
- Iterate with `npm run typecheck` and `npm run test:unit` (or
  `npx playwright test -g '<title>'` for a single e2e), not the full suite.
  Run `npm run validate:quick` **once**, right before declaring the goal met;
  it prints `QUICK VALIDATION: ALL PASSED`. Do not use it as a
  start-of-attempt baseline beyond a single optional quick-tier check.
- A summary comment from the implementer exists on issue #92 (what changed,
  where the permission grant is requested, files touched, gate evidence).

## Context

PRD: `prd/009-server-mode-menu.md` (Req 15, plus the Non-goals); parent #88.
Siblings: #90 landed the exclusive mode model (single-file mode already
exists and is entered by Open File… from anywhere), #91 owns workspace New
File / Save As…, #93/#94/#95 own the menu work, #96 the e2e sweep — whose
Req 18 list does **not** include Req 15, so this issue owns its own coverage.

Most of the machinery is already in place from PRD 007 Req 21 and needs
completing, not inventing. `src/platform/localDocs.ts` is the shared local-doc
store: `pick()` uses `showOpenFilePicker` with a `pickViaInput` fallback,
`openHandle`/`openFile` record `{ content, handle }`, `write()` writes through
`doc.handle.createWritable()` and **silently swallows any failure** (~line
153), and `commit()` downloads only when `!doc.handle`. That pair is the gap:
a denied or revoked permission today means the save lands nowhere while the
app clears the dirty dot.

The call chain on an explicit Save is `saveDoc` in `src/App.tsx` (~line 2843):
`platform.writeTextFile(path, text)` → `commitFile?.(path)` → `setSavedText`.
Hosted routes both to the local store when `local.owns(path)`
(`src/platform/hosted.ts` ~lines 247 and 403); web routes everything there
(`src/platform/web.ts` ~lines 62 and 172). `showNotice` in `App.tsx` is the
existing surface for telling the user a save did not land as expected;
`resolveSaveConflict` (~line 2990) and `writeDocCopyTo` (~line 3401) are the
two other `commitFile` call sites — check they still behave for local docs.

Unit tests run under vitest with `environment: 'node'` (`vitest.config.ts`),
which is why the testable logic has to be pure. Playwright's default config
collects every `tests/e2e/*.spec.ts` except `web.spec.ts` (that one is
`npm run test:e2e:web`, full-gate only), and `scripts/validate.mjs` holds a
committed floor on the collected test count — adding a file or test is fine,
losing one is loud.
