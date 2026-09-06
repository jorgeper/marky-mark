# Spec: Hosted: file context menu should offer Copy Link, not Copy Path / Copy Relative Path (#259)

## Goal

All acceptance criteria in issue-specs/issue-259.md are satisfied for issue
#259, with evidence visible in the session: on the hosted build a file row's
context menu offers **Copy Link** (the file's canonical PRD 020 Req 5 share
URL, for any file in the pane) and no Copy Path / Copy Relative Path, every
other build keeps those two items and grows no Copy Link, `npm run
validate:quick` passes, and a summary comment from the implementer exists on
issue #259.

## Acceptance criteria

- On the hosted platform, right-clicking a **file** row in the folder pane
  shows a `copy-link` item labelled `Copy Link` and shows neither `copy-path`
  nor `copy-relative-path`. Download, Rename, Delete keep their current
  positions and permission gating (a Viewer still sees none of them).
- Invoking Copy Link puts that file's shareable URL on the clipboard through
  the same seam the other folder-menu copy items use (`platform.copyText`):
  the absolute, per-segment percent-encoded PRD 020 Req 5 URL —
  `<origin>/<workspace-name>/<path inside the workspace>` — byte-identical to
  what the existing `copy-link-file` control (`fileShareUrl`, `src/lib/
  shareLinks.ts`) copies when that same file is the open document. It works
  for **any** file row, not only the open one, and for files nested in
  subfolders.
- The URL is derived by a pure function in `src/lib/shareLinks.ts` (the
  existing placements' logic layer) taking the current canonical pathname and
  the entry's virtual path as arguments — no DOM scraping, no URL assembly
  inside the component, no `react`/host imports added to `src/lib/`.
- When no share URL can be derived for the clicked entry (the app is not on a
  canonical workspace path, so `fileShareUrl` would answer null), the hosted
  file menu simply omits Copy Link rather than copying an empty or wrong
  string — the same "absent when unaddressable" rule PRD 020 Req 17 gives the
  file placement.
- Off hosted — Tauri desktop, the dev shim, and the single-file web build —
  the file context menu is exactly what it is today: `copy-path` and
  `copy-relative-path` present, no `copy-link` anywhere (PRD 020 Req 15,
  share URLs are hosted-only).
- Directory and root (empty-area) context menus are unchanged on every build,
  hosted included: this issue changes the file menu only.
- `folderContextMenu` in `src/lib/folderOps.ts` stays the pure item-set model
  (capability flags in, items out, separators still collapsing); the new
  capability arrives as an option flag that defaults to today's behaviour so
  no existing call site changes meaning. The changed behaviour carries its
  citation comment (`SPEC35 §2.5` plus `PRD 020 Req 15/17`) per
  `.sandcastle/CODING_STANDARDS.md`.
- Unit coverage exists and passes: `tests/unit/folder-ops.test.ts` asserts the
  hosted file menu's exact item set/order (Copy Link present, the two path
  items gone) and the unchanged non-hosted, dir and root sets; the shareLinks
  unit test covers the new URL function including its null case.
- e2e coverage exists and passes: a test in `tests/e2e/hosted.spec.ts` asserts
  the hosted file menu's item ids and that clicking `folder-menu-copy-link`
  lands the canonical absolute URL on the clipboard mirror; the desktop
  assertions in `tests/e2e/folder-tree.spec.ts` still assert `copy-path` /
  `copy-relative-path` on the file menu unchanged.
- The sweep is done: no test, helper or doc still asserts Copy Path / Copy
  Relative Path as part of the **hosted** file context menu (E191's read-only
  file-menu assertions and its comment included) — they assert the new item
  instead. No existing test is weakened, deleted, renumbered or marked
  `.skip`/`.only`/`.fixme`; new tests take the next unused `U<n>`/`E<n>` id.
- If citations changed which files a `SPEC<n>` covers, `docs/MAP.md` is
  regenerated with `npm run map` (never hand-edited) so the gate's diff is
  clean.
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (or `npx playwright test -g '<title>'` for one e2e title), and ran the full
  `npm run validate:quick` gate ONCE, right before declaring the goal met —
  not after every change and not as a start-of-attempt baseline beyond that
  quick tier. Its `QUICK VALIDATION: ALL PASSED` line is visible in the
  session.
- A summary comment from the implementer exists on issue #259 describing what
  changed and the gate evidence.

## Context

The menu model is `folderContextMenu` in `src/lib/folderOps.ts` (~line 110);
the `file` branch is where `copy-path` / `copy-relative-path` live. Its
capability flags are passed from `src/App.tsx` (~line 7795, the `caps={{…}}`
prop on `FolderPanel`), and the item ids are dispatched in `folderMenuAction`
(`src/App.tsx` ~line 2141), which already handles `copy-path` via
`p.copyText`. `FolderPanel.tsx` renders each item with
`data-testid={folder-menu-${it.id}}`, so a `copy-link` id gives the test hook
for free.

The URL logic layer is `src/lib/shareLinks.ts` (`fileShareUrl`,
`workspaceShareUrl`) over `src/lib/hostedPaths.ts` (`parseAppPath`,
`buildAppPath`, `parseHostedPath`, `hostedFilesRoot`). A pane file's virtual
path is `/w/<id>/files/<rel>`; the workspace *name* for the URL comes from the
canonical address bar (PRD 020 Req 6 keeps `location.pathname` on the Req 5
form), which is exactly how the existing placements derive theirs — see
`src/App.tsx` ~7618 for the hosted gate the three copy-link placements use
(PRD 020 Req 15) and reuse that gate's shape rather than inventing a second
one. PRD 020's affordance section is `prd/020-shareable-links.md` Reqs 14–17.

Hosted e2e helpers `rowMenu` / `rootMenu` and the clipboard mirror already
exist in `tests/e2e/hosted.spec.ts`; E191 (~line 1433) is the hosted file-menu
assertion that mentions Copy Path today.
