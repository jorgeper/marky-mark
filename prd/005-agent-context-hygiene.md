# PRD 005: Agent context hygiene

**Status:** Draft
**Date:** 2026-08-03

Supersedes issues #27 (five homes for planning documents) and #29 (keep
archived material out of agent context), both absorbed here.

## Problem

An agent starting work in this repository loads **zero** context. There is no
`CLAUDE.md`, no `AGENTS.md`, no `.claude/settings.json`. Every session begins
by reading source to discover where anything is, and the files it lands in
first are the two largest ones. A typical feature reads on the order of 140k
tokens before writing a line, against a `src/` that is only 19,428 lines
total.

Two shipped components already document a dependency on a file that does not
exist, so an escape hatch that was designed in is currently unreachable:

- `.sandcastle/config.mts:58` — *"Repo nuance (e.g. `test:e2e` is too slow for
  the inner loop) belongs in your CLAUDE.md/AGENTS.md, which agents read and
  which overrides this list."*
- `.claude/skills/sandcastle-implementer/SKILL.md:58` — *"Your repo's
  CLAUDE.md/AGENTS.md may refine which commands are appropriate; it overrides
  these lists."*

Four measurements define the cost and the fix. All were taken on 2026-08-03
against `main` at `5e77171`.

**1. Cost concentrates where size meets churn.** Neither dimension alone
predicts it:

| File | Lines | ~Tokens | Commits touching it (last 200) |
| --- | --- | --- | --- |
| `tests/e2e/app.spec.ts` | 6,423 | ~76k | 61 |
| `src/App.tsx` | 4,725 | ~50k | 52 |
| `src/styles.css` | 2,313 | ~14k | 51 |
| `docs/ARCHITECTURE.md` | 1,038 | ~15k | 23 |

**2. The codebase is already densely indexed and nobody is told.** Live code
and tests carry **755 `SPEC<n>` citation sites** across 45 spec files (614 in
`src/`, 141 in `tests/`), plus 115 `PRD <n>` citations, in the form
`// SPEC34 §2.3: <what and why>`. So `rg 'SPEC34' src` returns the folder
sidebar's implementation across `App.tsx` and `styles.css` in roughly 2k
tokens, replacing a 50k-token read. This is the cheapest lever available and
it costs nothing but documentation.

**3. Search noise is the doc archive, not worktrees.** Ripgrep for `sidecar`
from the repo root returns 65 files: **27 in `docs/goals/`, 11 in
`docs/specs/`, 9 in `src` + `tests`**. Worktree copies contribute zero — the
agent tooling already skips them. `docs/goals/` is 35 files, 42% of all hits,
and is cited by **zero** code: `rg -o 'GOAL[0-9]+' src tests` returns 0.

**4. Prune by citation count, not by age.** `docs/specs/` and `docs/goals/`
look alike and must be treated oppositely. `docs/specs/` is load-bearing
precisely because 755 code comments point into it; deleting or moving it
would orphan every one of those pointers. `docs/goals/` has no such backing.

Three structural traps compound this:

- **`docs/ARCHITECTURE.md` is a narrative, not a map.** 1,038 lines ordered
  chronologically by spec number, containing **18 total mentions of any
  `src/` path**. It answers "why is it this way" well and "which file do I
  edit" almost never.
- **`specs/` versus `docs/specs/` is a genuine trap.** They differ by one path
  segment and hold completely different things: `specs/` (14 files) is
  Sandcastle's per-issue working specs, set by `SPEC_DIR` in
  `.sandcastle/config.mts:12`; `docs/specs/` (45 files) is the app's numbered
  contract history that code cites. This already bit us — a spec written as
  `docs/specs/SPEC47.md` did not match the convention the loop expects.
- **`.sandcastle/CODING_STANDARDS.md` is an unfilled 27-line template.** The
  reviewer agent loads it on every review, so it is a guaranteed-delivery slot
  currently carrying no signal — and its placeholders ("Use camelCase",
  "Prefer named exports over default exports") are plausible enough to be
  mistaken for real project rules.

## Goals

- A cold agent session in this repository starts with a map instead of a
  search: where things live, what each command costs, and what not to read.
- The 755 existing `SPEC<n>` citations become a documented navigation
  mechanism rather than an accident.
- The largest single context cost — a 6,423-line e2e file — is broken into
  units an agent can load one of, without any possibility of a test silently
  ceasing to run.
- Material that is historical stops competing with live code for context, and
  the rule for what is historical is citation count, not age or feeling.
- "Which directory holds the spec" has exactly one answer, permanently.
- The document a reviewer loads on every review contains real, checkable
  rules.
- Every mechanism introduced here is enforced by the existing gate, so it
  cannot quietly rot.

## Non-goals

- **Decomposing `src/App.tsx`.** 4,725 lines, 233 hook calls, the most-churned
  file in the repository; every in-flight agent branch conflicts with it. A
  standalone refactor is ruled out. Opportunistic extraction is welcome
  elsewhere but is not a requirement of this PRD.
- **Splitting `src/styles.css` or `src/components/Editor.tsx`.** They are the
  third and fourth cost centres and neither has ever been analysed for a seam.
  Issue #28 exists to find one with evidence first. Deciding the shape here
  would be deciding it before the evidence.
- **Moving `docs/specs/`.** 755 code citations point at it by path. It stays
  exactly where it is.
- **Relocating `control-panel/`.** Raised by #27; cosmetic churn against a
  tool other work references. It is touched here only where it must be
  (requirement 22).
- **Deleting anything.** Every file this PRD moves stays in the repository and
  in git history. `archive/` is a relocation, not a deletion.
- **Making `archive/` a security boundary.** A `Read` deny rule does not stop
  an agent with Bash from `cat`-ing a file. This is a guardrail against
  context bloat. Secrets do not belong in `archive/` on this basis and the
  document must say so.
- **Changing what the e2e tests assert.** The split of requirement 6 is a
  move, not a rewrite: no test body changes, none is added, none is removed.
- **Changes to `jorgeper/sandcastle`.** Three items belong upstream, not in
  this repository, and an agent here cannot implement them. They are recorded
  in "Upstream follow-ups" below for the owner to file:
  1. A doctor check for **stale worktrees**. `WorktreeManager.pruneStale()` is
     correct but runs only on sandbox-*creation* paths, so disk is reclaimed
     at the start of the next run and never at the end of the last. 218 MB sat
     idle here on merged issue #15, 207 MB of it copied `node_modules`. Should
     be report-only with paste-ready commands, and must never suggest removing
     a worktree with uncommitted changes.
  2. A doctor check for a **missing `CLAUDE.md`/`AGENTS.md`**, since two
     shipped components document a dependency on it.
  3. **Hydrating the `CODING_STANDARDS.md` template** upstream with real,
     checkable defaults so every repository gets signal rather than
     placeholders.

## Requirements

### A. The agent context file

1. `AGENTS.md` exists at the repository root and is the single source of
   truth. `CLAUDE.md` at the root is a symlink to it, so both harnesses
   resolve the same content.
2. `scripts/validate.mjs` fails if `CLAUDE.md` does not resolve to
   `AGENTS.md` — this catches a Windows checkout without `core.symlinks`,
   where git materialises the symlink as a text file containing the path.
3. `AGENTS.md` states its own size budget in its header: a target of ~150
   lines / ~2k tokens, with the reason (every agent loads it on every
   session). The budget is documented, not gate-enforced.
4. `AGENTS.md` contains **pointers and costs, not behaviour**. Coding rules
   belong in `.sandcastle/CODING_STANDARDS.md` (section F) and must not be
   duplicated here.
5. `AGENTS.md` teaches citation-grep as the primary navigation move: the
   `// SPEC<n> §x.y:` convention, that 755 such sites exist, and a worked
   example showing that `rg 'SPEC34' src` locates a feature's implementation
   for roughly 2k tokens instead of a 50k-token read.
6. `AGENTS.md` states the cost of each verification command and which to use
   when — specifically that `npm run test:e2e` is too slow for the inner loop
   and that `npm run typecheck` + `npm run test:unit` is the iteration pair.
   This is the repo nuance `.sandcastle/config.mts:58` says lives here, and it
   must be consistent with `QUICK_VERIFY_COMMANDS` in that file.
7. `AGENTS.md` names what an agent should **not** read and why: `archive/`
   (section D), and `docs/ARCHITECTURE.md` when the question is "which file do
   I edit" (`docs/MAP.md` answers that instead — section E).
8. `AGENTS.md` gives the directory map: what `docs/specs/`, `issue-specs/`,
   `prd/`, `archive/`, `src/lib/`, `tests/e2e/` and `fixtures/` each hold, in
   one line apiece.

### B. Splitting the e2e suite

9. `tests/e2e/app.spec.ts` is split into 8–12 files under `tests/e2e/`, each
   named for a feature area (for example comments, editor, tables,
   folder-tree, settings, export, images, split-view, themes, updater). The
   split is by feature, not by E-number range — the numbers are chronological
   and do not cluster.
10. No test body is modified, added or removed. Every one of the 136
    `test()` calls lands in exactly one new file, byte-identical in content.
11. E-numbers are preserved verbatim as test-title prefixes. They are stable,
    grep-able labels cited elsewhere; the split must not renumber them.
12. Shared setup stays in the existing `tests/e2e/helpers.ts` and
    `tests/e2e/fixtures.ts`. Any helper currently defined inside
    `app.spec.ts` moves to `helpers.ts` rather than being duplicated per file.
13. `playwright.config.ts` no longer hardcodes `testMatch: 'app.spec.ts'`. It
    matches the new desktop-shim files by glob, and continues to exclude
    `web.spec.ts`, which belongs to `playwright.web.config.ts`.
14. `scripts/validate.mjs` enforces a **committed test-count floor** for the
    desktop-shim suite: it obtains the collected test count from Playwright's
    own collection (`playwright test --list`, so the count reflects the real
    `testMatch`) and fails if the count is below the committed constant. This
    follows the existing `FETCH_ALLOWLIST` pattern at
    `scripts/validate.mjs:113` — a committed number with a comment requiring
    any future change to be justified.
15. The floor check runs in the `--quick` tier as well as the full gate, since
    the desktop-shim e2e step is part of `QUICK_STEPS`.
16. Requirement 14 exists because without it the failure is silent: a glob
    that misses a file, or a file that fails to be collected, leaves the suite
    green while running a fraction of the tests. A demonstration that the
    check fails when a file is removed is part of the acceptance evidence.
17. After the split, no file under `tests/e2e/` exceeds 1,200 lines.

### C. The archive

18. A root `archive/` directory exists and holds material agents do not read.
    One location, one rule.
19. The following move into `archive/`, unchanged: `docs/goals/` (35 files,
    zero code citations), `docs/superpowers/plans/` (8 dated plans from a
    retired workflow), and the existing `docs/archive/` (2 files). Total 45
    files.
20. `specs/`, `prd/` and `docs/specs/` do **not** move into `archive/`. Agents
    legitimately consult all three while implementing.
21. `CONTRIBUTING.md:51` links `docs/goals/` and is updated to the new path.
22. `control-panel/` serves `docs/archive/` as its Docs tab
    (`control-panel/server.js:437-446`, `control-panel/public/app.js:265-270`,
    `control-panel/README.md:31-34`). All three are updated to the new path,
    and the panel still lists and serves the article after the move. This is
    the one place `control-panel/` is touched.
23. `docs/specs/SPEC18.md:106` refers to `GOAL18` in prose. It gains a pointer
    to the new location so the reference does not dangle. No other `docs/spec`
    file requires editing — `rg -o 'GOAL[0-9]+' src tests` returns 0.
24. `archive/README.md` states what the directory is, that its contents are
    excluded from agent context, how to consult it deliberately, and that
    nothing in it is deleted or unversioned.

### D. Enforcing the archive boundary

25. `.claude/settings.json` is committed at the repository root and contains
    `permissions.deny` with a rule denying `Read` on `archive/**`. This also
    suppresses those paths from Grep and Glob results, which is the mechanism
    that removes the measured 42% search-noise share.
26. The deny list does **not** constrain Bash. Bash path patterns are brittle
    (`sed`, `awk`, `head` all bypass a `cat` rule) and risk false-positive
    refusals on unrelated commands.
27. `archive/README.md` and `AGENTS.md` both state that this is a context
    guardrail and not a security boundary, and that secrets must not be placed
    in `archive/` on the strength of it.
28. Acceptance requires demonstrating that the committed
    `.claude/settings.json` is actually honoured by **Sandcastle's
    containerised agents**, not only by a local session. If it is not picked
    up automatically, the finding is recorded in the PR — the container-side
    fix is upstream (see Non-goals) and does not block this PRD.
29. Adding `.claude/settings.json` must not disturb existing tool access.
    Nothing outside `archive/**` is denied by this change.

### E. The map

30. `docs/ARCHITECTURE.md` remains the durable "why" narrative and is not
    reorganised or split. It gains a header line directing readers who want
    "which file do I edit" to `docs/MAP.md`.
31. A script generates `docs/MAP.md` from citations already in the tree. For
    each of the 45 specs it lists: the spec number and title (from the spec's
    own heading), the `src/` files that cite it, and the E-numbered tests that
    cite it.
32. `docs/MAP.md` is generated, never hand-edited, and says so in its own
    header. Hand-written maps drift; a derived one cannot.
33. `scripts/validate.mjs` fails if `docs/MAP.md` differs from what the
    generator produces from the current tree, so a citation added without
    regenerating fails the gate.
34. The generator is added to `package.json` scripts so regenerating is one
    command, and `AGENTS.md` names that command.
35. `docs/MAP.md` is the answer to "where is feature X" in `AGENTS.md`'s
    navigation section, alongside the citation-grep of requirement 5.

### F. Coding standards

36. `.sandcastle/CODING_STANDARDS.md` is hydrated with real, repository-
    specific, checkable rules under its Style, Testing and Architecture
    headings. Every rule must be one a reviewer can decide against a diff
    without further context.
37. No placeholder content survives. No `<!-- Example:` block and no
    instruction-to-the-author comment remains in the file.
38. The rules are drawn from conventions the codebase already follows, and
    the PR states where each came from. This is documentation of existing
    practice, not the introduction of new policy.
39. The file does not restate anything in `AGENTS.md`. Navigation and cost
    live there; review-time rules live here.

### G. The specs directory rename

40. `specs/` is renamed to `issue-specs/`, carrying all 14 files.
41. `SPEC_DIR` in `.sandcastle/config.mts:12` is set to `"issue-specs"` in the
    same change, so the spec writer, goal statements and issue comments all
    follow. A rename without this knob silently breaks the loop.
42. Every in-repo reference to the old `specs/issue-<n>.md` path outside
    `archive/` is updated. References inside `archive/` are historical records
    of what was true then and are left alone.
43. `AGENTS.md` states the resulting rule in one line: `docs/specs/` is the
    app's numbered contract history that code cites; `issue-specs/` is
    Sandcastle's per-issue working specs.

### H. Evidence

44. `npm run validate` passes, printing `VALIDATION: ALL PASSED`.
45. The desktop-shim e2e suite collects the same 136 tests after the split as
    before it, demonstrated by the requirement 14 count and by the run itself.
46. Removing one split file causes `npm run validate:quick` to fail on the
    count floor (requirement 16), demonstrated and then reverted.
47. `rg sidecar` from the repository root returns materially fewer files than
    the 65 measured today, with the reduction attributable to `archive/`. The
    PR records the before and after numbers.
48. Regenerating `docs/MAP.md` on a clean tree produces no diff.
49. A cold agent session can locate the folder-sidebar implementation using
    only `AGENTS.md` and one `rg` command, without reading `App.tsx` or
    `ARCHITECTURE.md` in full. The PR records the sequence.

## Upstream follow-ups

Not requirements. Recorded so they are not lost when #23 closes; the owner
files these on `jorgeper/sandcastle`. Detail is in Non-goals above.

1. Doctor check for stale worktrees (218 MB idle on merged #15).
2. Doctor check for a missing `CLAUDE.md`/`AGENTS.md`.
3. Hydrate the template `CODING_STANDARDS.md` with real defaults.

## Prior art

A first pass wrote parts of this up as two prescriptive delta specs
(SPEC47/SPEC48) before the problem had been grilled. They were removed in
`bec5aaf` and remain readable at `e5208e2`. Treat as one person's early
draft, not a plan — this PRD supersedes it.

## Open questions

None.
