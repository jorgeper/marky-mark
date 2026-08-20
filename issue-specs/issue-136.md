# Spec: blank screen (#136)

## Goal

All acceptance criteria in issue-specs/issue-136.md are satisfied for issue
#136, with evidence visible in the session: opening several files in quick
succession from the folder pane never leaves the app blank (the last-clicked
document is rendered and its tab is active), the concurrent-open race in
`openDoc`/`parkAndOpen` is closed so no committed state mixes two documents,
a regression test covering rapid successive opens exists and passes,
`npm run validate:quick` passes, and a summary comment from the implementer
exists on issue #136.

## Acceptance criteria

- Rapidly opening several files from the folder pane — clicking the next file
  before the previous open has settled — always ends with the app rendering a
  document: the content area shows the last-clicked file's content (preview or
  editor per the reader's view mode), the file-tab strip marks that file
  active, and the window title names it. No blank/empty content area, no blank
  window.
- No committed app state describes two documents at once. After a burst of
  opens, `docPath`, `buffer`, `savedText`, `comments`, `stores`, the rendered
  `html`, the open set / active tab, and the installed file watcher all belong
  to the same (last-clicked) file. An open that is superseded mid-flight
  commits nothing — including no partial commit of the state writes at the tail
  of `openDoc` (`src/App.tsx:1950`), and no `setHtml` from a markdown render
  started for a document that is no longer current (`src/App.tsx:5325` — the
  `docEpochRef` guard today is only bumped on close-to-splash,
  `src/App.tsx:2136`).
- No parked buffer is lost to the race: an open that deletes a file's park
  entry (`parkRef.current.delete(path)`) and is then superseded does not leave
  that file's parked (possibly dirty) buffer discarded. Reopening a file whose
  open lost the race still shows its unsaved content.
- A render-time throw can no longer end as a permanently blank window: the app
  root is wrapped in an error boundary that renders a visible error surface
  with a recovery action (reload / return to the start page) instead of
  unmounting the tree to nothing. It adds no `console.*` call site in `src/`
  (`.sandcastle/CODING_STANDARDS.md` § Style).
- A regression test exists that fails on the pre-fix code and passes after: a
  desktop e2e test in `tests/e2e/` (folder-tree or file-tabs spec) taking the
  next unused `E<n>` (≥ E292) that opens three or more files back-to-back from
  the folder pane without awaiting each open, then asserts the content area is
  non-empty and shows the last file. Any logic extracted to `src/lib/` for the
  fix carries unit tests in `tests/unit/` at the next unused `U<n>` (≥ U713).
- Every changed behaviour carries a citation comment naming what it implements
  and why (`// Issue #136: …`, alongside the governing `SPEC36 §…` / `SPEC34
  §…` section where one applies), per `.sandcastle/CODING_STANDARDS.md`.
- No existing test is weakened, renamed, skipped, or deleted, and no existing
  `data-testid` is renamed; the tabs, folder-tree and documents e2e suites
  still pass.
- If the fix adds or removes cited files or e2e tests, `docs/MAP.md` has been
  regenerated with `npm run map` and committed (the gate diffs it).
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (plus targeted `npx playwright test -g '<title>'` runs for the new e2e test),
  and ran the full `npm run validate:quick` gate ONCE at the end — not after
  every change and not as a starting baseline.
- `npm run validate:quick` has been run in the implementer's session and
  printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #136 stating the root
  cause found, the fix, the new test ID(s), and the gate result.

## Context

The report: "sometimes i click on several files to open them in the folder
pane and after I open a few I get a blank screen." No comments, no repro
attachment — reproduce it by driving opens faster than they settle.

Start at `src/App.tsx`: `openDoc` (line ~1950), `parkAndOpen` (~2095),
`openDocGuarded` (~2100), `parkActive` (~1660), `commitOpenSet` (~1649). Every
folder-pane click (`onOpenFile` at ~6505, `onActivate` at ~6667) fires
`openDocGuarded`, which starts a fully async `openDoc` with no in-flight
guard, generation token, or queue: `openDoc` awaits `grantsFor` and
`loadDocParts` and only then performs ~20 state writes. Two clicks in flight
can therefore interleave — resolve out of order, park the wrong path, delete a
park entry that is never re-installed, or commit a mix of both documents. The
markdown render effect (~5325) has an epoch guard from issue #43, but
`docEpochRef` is only bumped by the close-to-splash path, so a stale render can
also land on the wrong document.

Second, independent contributor to the symptom: the repo has no error boundary
anywhere (`grep -rn "componentDidCatch\|getDerivedStateFromError" src` is
empty), and `src/main.tsx` renders `<App />` bare under `StrictMode` — any
render-time throw unmounts the whole tree and the window stays white with no
way back. `src/components/Editor.tsx:1253` already try/catches
`EditorState.fromJSON`, so the CodeMirror restore is likely not the thrower;
look elsewhere in render before concluding.

Grep before reading: `rg 'SPEC36' src` (parking, the open set, tabs) and
`rg 'SPEC34' src` (folder sidebar). Never read `App.tsx` end-to-end. Shared e2e
setup lives in `tests/e2e/fixtures.ts` / `helpers.ts` (`freshApp`, `fsWrite`).
The hypotheses above are a starting point, not a mandate — if the investigation
finds a different root cause, fix that one and say so in the issue comment; the
observable criteria stand either way.
