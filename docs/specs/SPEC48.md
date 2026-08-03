# SPEC48: the structural half — splitting the e2e suite, remapping ARCHITECTURE.md

Delta spec on top of SPEC.md–SPEC47.md as implemented. This file wins on
conflict; nothing may regress. Like SPEC46 and SPEC47, SPEC48 ships **no
user-visible change**: no app behavior, no file format, no version bump.

SPEC47 wrote down what already exists. SPEC48 changes the shape of the two
artifacts that make orientation expensive. It is deliberately a separate day
of work: §1 touches the file that gates every commit, and §2 touches the
document every other doc points at.

**Do SPEC47 first.** §2 rewrites pointers that SPEC47 §1 establishes.

## §0 What this is worth, and what it is not

From SPEC47 §0: `tests/e2e/app.spec.ts` is 6,162 lines (~76k tokens) and
appears in 61 of the last 200 commits — the single largest token cost in the
repo, ahead of `App.tsx`. `docs/ARCHITECTURE.md` is 1,033 lines (~15k
tokens) containing **18 total mentions of `src/` paths**: it answers "why is
it this way" well and "which file do I edit" almost never.

Not in scope, and worth restating because it is the biggest number on the
board: **decomposing `App.tsx`**. 4,604 lines, 233 hook calls, the
most-churned file in the repo, and every in-flight agent branch conflicts
with it. SPEC47 §3 installs the ratchet (new logic goes to `src/lib/`); the
decomposition itself happens opportunistically inside features that already
touch a region, never as a standalone refactor.

## §1 Split `tests/e2e/app.spec.ts`

### 1.1 The invariant (governs everything below)

**The set of test IDs that run, and their results, is identical before and
after.** This is a pure relocation. The failure mode that matters is not a
broken test — it is a test that silently stops running because it landed in
a file the runner does not match, or a duplicated ID that masks a
disappearance.

Capture the baseline before touching anything:

    npx playwright test --list | grep -oE 'E[0-9]+' | sort -u > /tmp/e2e-before.txt
    wc -l /tmp/e2e-before.txt        # expect 132

and diff against it after every step in 1.4. A non-empty diff fails the step.

### 1.2 The blocking mechanical detail

`playwright.config.ts` hardcodes `testMatch: 'app.spec.ts'`. Splitting
without changing this silently drops every new file — the suite goes green
while running a fraction of the tests. Change it to match the split set
(`'*.spec.ts'`, with `playwright.web.config.ts` left alone since it drives
`web.spec.ts` under its own config).

Verify with `--list`, not with a green run.

Favourable existing conditions, confirmed: `fullyParallel: true`, no
`describe.configure({ mode: 'serial' })`, no `beforeAll`/`afterAll`
anywhere. The 132 tests are already independent — this is why the split is
low-risk rather than a rewrite.

### 1.3 What has to move first

`app.spec.ts` defines shared state at module scope that the tests rely on:

- `test.beforeEach(freshApp)` (line ~26) — every file needs it.
- Consts `PHRASE`, `TOOLBAR_WAIT`, `NEWER_TRAILER` (~6175).
- Helpers defined mid-file, used by tests that will land in different
  files: `menuClick`/`menuItem` (~1230), `editorTopGutterLine` (~1630),
  `previewTopAnchorLines` (~1640), `seedFolders` (~3054), `openFolderRoot`
  (~3069), `openNotesRoot` (~3559), `dirtyActiveDoc` (~3565), `clickWord`
  (~5027).

These move to `tests/e2e/helpers.ts` (already 183 lines, already the home
for `addComment`, `freshApp`, `selectPhrase`, …). The `beforeEach` moves
into `tests/e2e/fixtures.ts` so each split file inherits it from the `test`
it already imports, rather than repeating it eight times.

### 1.4 Sequence — two commits, never one

The discipline is what keeps this low-risk: **no test body is edited in the
same commit that moves it.**

1. **Commit 1 — extraction.** Move the 1.3 helpers/consts to `helpers.ts`,
   move `beforeEach` to `fixtures.ts`, import them back into the still-intact
   `app.spec.ts`. No test moves. Run `npm run test:e2e` → green, ID diff
   empty. This commit is independently revertible.
2. **Commit 2 — relocation.** Cut test blocks into the new files verbatim.
   Update `testMatch`. Run `--list` → ID diff empty. Run
   `npm run validate` → `VALIDATION: ALL PASSED`.

If a test needs an edit to survive the move, that is a third commit with its
own justification — and per `.sandcastle/CODING_STANDARDS.md`, weakening it
is not an option.

### 1.5 Proposed areas

Derive the grouping from each test's title and its SPEC tag; the titles
already name their area. Target ~8 files of roughly 400–900 lines. A
starting cut (adjust to what the titles actually say — do not force a test
into the wrong file to match this list):

| File | Covers |
| --- | --- |
| `core.spec.ts` | launch/empty state, About, network isolation (E1, E45, E46) |
| `comments.spec.ts` | add/reply/resolve/orphan/anchoring, ghosting, composer |
| `storage.spec.ts` | sidecar vs embedded, save/Save As, dirty guards, drafts |
| `editing.spec.ts` | edit mode, undo/redo, smart edit, find |
| `settings.spec.ts` | themes, fonts, zoom, tabs, hotkey remapping, scopes |
| `chrome.spec.ts` | toolbar auto-hide, title slot, layout/centering, margins |
| `files.spec.ts` | folder sidebar, open-file tabs, file management, recent |
| `split.spec.ts` | side-by-side, divider, scroll sync, tables, images |
| `menus.spec.ts` | native menu spec, accelerators, aux windows (Settings/About) |

Test IDs stay global and sequential across all files — `npx playwright test
-g "E90"` keeps working unchanged, and `docs/DEVELOPING.md` needs no edit.

### 1.6 Known environment caveat

E113 fails on some hosts for environment reasons unrelated to this change.
Confirm its status **before** starting so a pre-existing failure is not
attributed to the split; the 1.1 baseline capture is the record.

## §2 Restructure `docs/ARCHITECTURE.md`

### 2.1 The problem

45 headings, ordered chronologically by spec number — `## v7 (SPEC7)`,
`## v6 (SPEC6)`, `## v5 polish (SPEC5)`, `## v4 chrome (SPEC4)`. An agent
pays ~15k tokens and still has to grep to find the file. The durable
architectural decisions (the anchor coordinate space, the platform seam,
sidecar-vs-embedded, the security model) are genuinely load-bearing and are
interleaved with version history that is not.

### 2.2 The split — three documents

**`docs/ARCHITECTURE.md`** (target ≤400 lines) keeps only decisions that are
still true and still constrain new work. At minimum, by current heading
name: Overview, the platform seam, Anchor coordinate space (the key
decision), Comment storage: sidecar or embedded, Native menus & the command
registry, Aux windows, Theming, File watching and external edits, Security
model & network isolation, Release engineering, Tradeoffs, Measured
performance.

**`docs/MAP.md`** (new) — the router the current file is not:
`feature → files → test IDs → spec`, one row per area. This is the document
`CLAUDE.md` sends agents to when a grep needs a starting point.

**`docs/archive/architecture-history.md`** — the version-narrative sections
(`v4 chrome`, `v5 polish`, `v6`, `v7`, and any per-SPEC walkthrough
superseded by its spec file). Lands under the `docs/archive/` created by
SPEC47 §2, under the same "historical, not consulted for current work"
header.

### 2.3 Generate `MAP.md`, don't write it

The rows derive from tags already in the code — this is what stops the map
rotting, and it is why the map is worth having when the prose was not:

    grep -rn 'SPEC[0-9]\+' src tests | sed -E 's/:.*(SPEC[0-9]+).*/ \1/' | sort -u

gives every (file, SPEC) pair. Pivot to one row per SPEC, add the test IDs
from the spec's Definition of Done and the one-line title from
`docs/specs/INDEX.md` (SPEC47 §4). First version is mechanical.

A committed regeneration script is **out of scope** — worth doing once the
format has settled, not before. Note it in `MAP.md` as a TODO.

### 2.4 Pointer updates

`CLAUDE.md`'s "Read these when" table (SPEC47 Appendix A) gains `MAP.md` and
re-scopes `ARCHITECTURE.md` to "why a decision is the way it is".
`CONTRIBUTING.md:44` ("How this codebase works") and `docs/DEVELOPING.md`
are checked for links into moved sections.

## §3 Out of scope

- `App.tsx` decomposition (§0).
- `src/styles.css` (2,290 lines, 51 of 200 commits). Third-largest cost, no
  clean seam, and CSS is grep-friendly in a way `App.tsx` is not. Revisit
  only if it keeps showing up in agent context after §1 and §2 land.
- A validate step asserting doc-cited paths resolve (SPEC47 §7).
- Regenerating the `docs/ARCHITECTURE.md` measured-performance table —
  SPEC46 owns those numbers; §2.2 moves the section unmodified.

## Definition of Done

1. `npx playwright test --list` reports the **same 132 test IDs** as the
   §1.1 baseline, with no duplicates: `sort /tmp/e2e-after.txt | uniq -d`
   is empty.
2. No file under `tests/e2e/` exceeds 1,000 lines.
3. `playwright.config.ts` matches every split file, proven by `--list`
   count, not by a green run. `playwright.web.config.ts` is unchanged.
4. No test body differs from its pre-split text. Verify with
   `git log -p --follow` on the relocation commit, or by diffing sorted test
   bodies; the relocation commit shows only moves.
5. `docs/ARCHITECTURE.md` is ≤400 lines and contains no `## v<n>` history
   section.
6. `docs/MAP.md` has a row for **every SPEC number cited in `src/` or
   `tests/`** (40 as of SPEC47), each naming at least one real file path.
7. `docs/archive/architecture-history.md` carries the removed sections
   verbatim; no content is lost, only relocated.
8. `CLAUDE.md` is still ≤120 lines after §2.4, and every path in it
   resolves.
9. `npm run validate` prints `VALIDATION: ALL PASSED`.

**No version bump.** No `package.json`, `Cargo.toml`, or `tauri.conf.json`
change.
