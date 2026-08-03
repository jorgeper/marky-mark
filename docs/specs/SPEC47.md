# SPEC47: agent context & repo hygiene (no app change)

Delta spec on top of SPEC.md–SPEC46.md as implemented. This file wins on
conflict; nothing may regress. Like SPEC46, SPEC47 ships **no user-visible
change**: no app behavior, no file format, no version bump. What changes is
what an agent has to read before it can work here.

Companion: **SPEC48** (splitting the e2e suite, restructuring
ARCHITECTURE.md) — the structural half, deliberately deferred.

Framework-side companion: **sandcastle `prd/009-agent-context-hygiene.md`**
on branch `feat/agent-context-hygiene`. Two doctor checks and the
`CODING_STANDARDS.md` template ship there and are vendored back into
`.sandcastle/` here by §6. Do not fix those in this repo alone — they will
be overwritten on the next template sync.

## §0 Motivation (the measurement)

A cold agent session in this repo starts with **zero** loaded context: there
is no `CLAUDE.md`, no `AGENTS.md`, no `.claude/settings.json`. Two systems
already assume one exists and silently no-op without it:

- `.sandcastle/config.mts:58` — "Repo nuance (e.g. `test:e2e` is too slow
  for the inner loop) belongs in your CLAUDE.md/AGENTS.md."
- `.claude/skills/sandcastle-implementer/SKILL.md:58` — "Your repo's
  CLAUDE.md/AGENTS.md may refine which commands are appropriate; it
  overrides these lists."

The cost is concentrated, not diffuse. Churn over the last 200 commits
against file size:

| File | Lines | ~Tokens | Commits touching it |
| --- | --- | --- | --- |
| `tests/e2e/app.spec.ts` | 6,162 | ~76k | 61 |
| `src/App.tsx` | 4,604 | ~50k | 52 |
| `src/styles.css` | 2,290 | ~14k | 51 |
| `docs/ARCHITECTURE.md` | 1,033 | ~15k | 23 |

Two files are 57% of `src/` and are also the two most-edited. A typical
feature reads ~140k tokens before writing a line, on a codebase whose
entire `src/` is 19k lines.

Two counter-measurements that shaped the scope:

1. **Search noise is docs, not worktrees.** Measured with ripgrep (what
   agent tooling actually uses) from the repo root, `sidecar` returns 65
   files: **27 in `docs/goals/`, 11 in `docs/specs/`, 9 in `src`+`tests`**.
   Worktree copies contribute **zero** — they are already skipped. The
   archive outweighs live code 4:1 and `docs/goals/` alone is 42% of it.
2. **`docs/specs/` is load-bearing; `docs/goals/` is not.** Live code
   carries **753 `SPEC<n>` citation sites across 40 spec files**, plus 90
   `PRD <n>` citations. `docs/goals/` (35 files) is cited by exactly two
   places, neither of them code. Prune by citation count, not by age.

The third measurement is that the codebase is *already* well-indexed and
nobody is told: `grep -rn 'SPEC34' src` returns the folder sidebar across
`App.tsx` and `styles.css` in ~2k tokens, replacing a 50k-token read.
SPEC47 is mostly the act of writing that down.

## §1 `CLAUDE.md` — the Tier-0 file

New file at repo root. **Hard cap: 120 lines.** This cap is the spec, not a
suggestion — a 400-line CLAUDE.md describing behavior is wrong within a
month and is worse than nothing, because agents trust it.

Governing rule: **pointers and costs, never behavior.** A pointer that rots
produces a 404 the agent notices immediately; prose that rots produces
confident wrong work. Nothing in `CLAUDE.md` may restate what a function
does, what a format contains, or how a feature behaves — that is what the
SPEC tags and the specs themselves are for.

The success test: an agent that reads **only** `CLAUDE.md` knows which file
to open next for any task in this repo, without having opened `App.tsx`.

Required content, in this order (full proposed text in **Appendix A**):

1. **Cost tiers** — the table from `docs/DEVELOPING.md`, condensed, plus the
   explicit rule that `test:e2e` and `validate` never run in the inner loop.
   This is the line `.sandcastle/config.mts` defers to; it must appear
   verbatim enough to override `VERIFY_COMMANDS`.
2. **The SPEC-tag grep convention**, with a worked example.
3. **The two files to never read whole**, with the grep-first instruction.
4. **Where things live** — `src/lib/` clusters, components, the platform
   seam. One line per cluster, not per file.
5. **Pointer table** — "read X when Y" for `DEVELOPING.md`,
   `ARCHITECTURE.md`, `docs/specs/INDEX.md`, `CONTRIBUTING.md`.

`AGENTS.md` is a symlink to `CLAUDE.md` (matching sandcastle's own repo, so
non-Claude harnesses resolve it).

## §2 Archive `docs/goals/`

`git mv docs/goals docs/archive/goals`. 35 files, zero code citations, 42%
of doc search noise.

- New `docs/archive/README.md`: one paragraph stating the directory is
  historical, superseded, and not consulted for current work.
- Fix the two referrers: `CONTRIBUTING.md:51` (link path) and
  `docs/specs/SPEC18.md:106` (mentions `GOAL18` by name — text reference
  only, update the path if it links).
- **Not deleted.** Archiving costs the same as deleting and is reversible;
  git history alone loses the "why" for milestones the specs still assume.

## §3 Hydrate `.sandcastle/CODING_STANDARDS.md`

Today: 27 lines, entirely HTML comments and placeholder examples ("Use
camelCase for variables"). The reviewer agent loads this on **every** code
review via `@.sandcastle/CODING_STANDARDS.md`. It is a guaranteed-delivery
slot currently carrying zero signal — and the commented-out examples are
generic enough that a reviewer may treat them as real house rules.

Content = the generic base from the sandcastle template (§6, shipped by
`prd/009`) **plus** a Marky Mark section encoding the conventions this repo
already follows but never wrote down. Full text in **Appendix B**. The four
repo-specific rules that matter:

- **Spec provenance.** A change implementing a spec section adds or updates
  its `// SPEC34 §2.3:` tag. Those 753 tags are the navigation index; an
  untagged change is a hole in it.
- **Test IDs.** Global and sequential — `U<n>` unit, `E<n>` desktop e2e,
  `W<n>` web e2e. New tests take the next free number and are named in the
  spec's Definition of Done. Existing tests are never weakened; an
  amendment must be named in the spec.
- **The platform seam.** `src/platform/types.ts` is the only contract
  between app code and the host. App code never imports `@tauri-apps/*`
  directly. Dev-shim seams (`__mmfs`, `__mmMenu`, `__mmEdit`) stay gated and
  never become app logic.
- **Logic goes in `src/lib/`.** Pure, unit-tested, one concern.
  `App.tsx` is 4,600 lines; adding logic there instead of a lib module is a
  review finding. This is the ratchet that stops §0 getting worse while
  SPEC48 waits.

## §4 `docs/specs/INDEX.md`

One line per spec, 45 entries, `SPEC<n> — <one line of English>`. Derived
from each file's existing `# SPEC<n>: <title>` heading, so generating the
first version is mechanical.

Purpose: an agent that greps a SPEC number needs to pick 1 of 45 files, not
read them. `CLAUDE.md` §2 points here first, then to the grep.

Maintenance: a new SPEC adds its line in the same commit. Not enforced by
the gate in this spec — see §7.

## §5 `.gitignore` += `.claude/worktrees/`

Hygiene only. Verified: agent tooling already skips these directories, so
this is **not** a token win — it is `git status` cleanliness, keeping the
one untracked entry in this repo from masking real ones.

## §6 Vendor the sandcastle template changes

`prd/009-agent-context-hygiene.md` ships three things framework-side. Once
that branch lands, sync into this repo:

| From (sandcastle) | To (here) |
| --- | --- |
| `src/templates/parallel-planner-goal-with-pr-review/setup.mts` | `.sandcastle/setup.mts` **and** `.sandcastle/.template-base/setup.mts` |
| `src/templates/parallel-planner-goal-with-pr-review/CODING_STANDARDS.md` | `.sandcastle/.template-base/CODING_STANDARDS.md` |

`.sandcastle/CODING_STANDARDS.md` (the live one) is **not** overwritten by
the sync — §3 owns it. `.template-base/` is the ancestor snapshot for future
template upgrades and must match the framework exactly.

Both copies of `setup.mts` must be updated. They are currently identical;
divergence here is what makes a later template upgrade unmergeable.

## §7 Explicitly out of scope

- **Splitting `app.spec.ts` and restructuring `ARCHITECTURE.md`** — SPEC48.
- **Decomposing `App.tsx`.** Highest ceiling of anything measured, and not
  scheduled. 4,604 lines, 233 hook calls, the most-churned file in the repo,
  and every in-flight agent branch would conflict. Do it opportunistically
  when a feature already forces you into a region; never as a standalone
  refactor.
- **A validate step asserting every path cited in `CLAUDE.md` still
  exists.** Worth doing, and the natural enforcement for §1 and §4 — but it
  is a change to `scripts/validate.mjs`, which gates every commit in the
  repo. It gets its own spec rather than riding along with a docs change.
- **Auto-deleting worktrees.** See `prd/009` §3; doctor reports, humans
  delete.

## Definition of Done

1. `CLAUDE.md` exists, is **≤120 lines**, and contains no statement about
   app behavior — only commands, costs, paths, and conventions. `AGENTS.md`
   symlinks to it.
2. Every path, command, and file named in `CLAUDE.md` and
   `docs/specs/INDEX.md` resolves. Verify by hand this once:
   `grep -oE '`[a-zA-Z0-9_./-]+`' CLAUDE.md` → check each path exists.
3. `docs/archive/goals/` contains the 35 former `docs/goals/` files;
   `docs/archive/README.md` marks it historical; `CONTRIBUTING.md:51`
   resolves; no live link points at `docs/goals/`.
4. `.sandcastle/CODING_STANDARDS.md` contains zero HTML-comment
   placeholders and includes all four §3 rules.
5. `docs/specs/INDEX.md` has one line for each of the 45 spec files, and
   every referenced file exists.
6. `.claude/worktrees/` is gitignored; `git status` is clean on a fresh
   checkout.
7. §6 sync done, with `.sandcastle/setup.mts` and
   `.sandcastle/.template-base/setup.mts` byte-identical to each other.
8. `npm run sandcastle:doctor` runs and its two new checks report against
   this repo (they may report ✗ — the point is that they run and print
   commands).
9. `npm run validate` prints `VALIDATION: ALL PASSED`. No source file
   changed, so this is a regression check, not a feature gate.

**No version bump.** No `package.json`, `Cargo.toml`, or `tauri.conf.json`
change; the validate version lock-step check is unaffected.

---

## Appendix A — proposed `CLAUDE.md`

Implement as written unless a fact has changed; the line budget assumes it.

```markdown
# Marky Mark — agent orientation

Tauri + React markdown editor with margin comments. `src/` is ~19k lines.
Read this file, then go to the file you need. Do **not** read `App.tsx` or
the e2e suite to orient yourself — grep them (see below).

## Cost tiers — pay only for the tier you're in

| Doing | Command | Time |
| --- | --- | --- |
| One unit test | `npx vitest run tests/unit/<file>.test.ts` | seconds |
| One e2e test | `npx playwright test -g "E90"` | ~30 s |
| Inner loop | `npm run typecheck && npm run test:unit` | ~20 s |
| Checkpoint | `npm run validate:quick` | ~2 min |
| Before any commit | `npm run validate` | ~4 min |

**Never run `test:e2e` or `validate` in the inner loop.** Iterate on
`typecheck` + `test:unit`; run the full gate once, at the end. This
overrides `VERIFY_COMMANDS` in `.sandcastle/config.mts`.

`npm run validate` must print `VALIDATION: ALL PASSED` before any commit.
`QUICK VALIDATION: ALL PASSED` is a deliberately different string — it is
not release evidence.

## Finding code: grep the SPEC tag, don't read the file

Every non-obvious line in `src/` carries the spec that put it there — 753
tags. This is the navigation index:

    grep -rn 'SPEC34' src tests    # the folder sidebar, everywhere it lives
    grep -rn 'PRD 002' src         # workspaces & layered configuration

`docs/specs/INDEX.md` maps every SPEC number to one line of English. Find
your number there first, then grep for it.

## The two files to never read whole

- `src/App.tsx` — 4,600 lines, 233 hooks, one component. Grep it.
- `tests/e2e/app.spec.ts` — 6,200 lines, tests `E1`–`E136`, each
  independent. `grep -n "E90" tests/e2e/app.spec.ts`, read that block only.

## Where things live

`src/lib/` — pure, unit-tested, one concern each. Most logic is here, and
new logic belongs here rather than in `App.tsx`.

| Cluster | Modules |
| --- | --- |
| Comments & anchoring | `anchoring` `commentFormat` `commentNav` `sidecar` `embedded` `selectionMap` `activePosition` |
| Markdown & output | `markdown` `frontmatter` `domtext` `exportDoc` `reviewBundle` |
| Text operations | `smartEdit` `tableEdit` `diffLines` `imagePaste` `imageResize` `wordCount` `fuzzy` |
| Settings & workspace | `settings` `workspace` `themes` `drafts` `readingPositions` `recentFiles` `openFiles` `folderTree` `folderOps` |
| Shell & commands | `commands` `menuSpec` `hotkeys` `appMode` `windowRole` `auxProtocol` `vimnav` `scrollSync` `paneSlide` |

`src/components/` — `Editor.tsx` (CodeMirror), `SettingsPanel`,
`FolderPanel`, `CommentCard`, `Toolbar`, `tableMode`, `imageView`.

`src/platform/` — **the seam.** `types.ts` is the only contract between app
code and the host; `tauri.ts` (desktop), `browser.ts` (dev shim + e2e),
`web.ts` (web build). App code never imports `@tauri-apps/*` directly.

`src-tauri/src/lib.rs` — 86 lines. The Rust side is thin by design.

## Read these when

| Read | When |
| --- | --- |
| `docs/DEVELOPING.md` | full tier table, dev shim seams, release tiers |
| `docs/specs/INDEX.md` | picking which spec covers your area |
| `docs/specs/SPEC<n>.md` | the contract for a feature you're changing |
| `docs/ARCHITECTURE.md` | why a decision is the way it is (anchor space, platform seam, sidecar vs embedded) |
| `CONTRIBUTING.md` | setup, PR conventions, themes |
| `.sandcastle/CODING_STANDARDS.md` | the rules review enforces |

## Conventions that bite

- Test IDs are global and sequential: `U<n>` unit, `E<n>` desktop e2e,
  `W<n>` web e2e. New tests take the next free number.
- Existing tests are never weakened. An amendment must be named in a spec.
- Tag your work: `// SPEC34 §2.3: <what and why>`. Untagged changes are
  holes in the index above.
- `docs/archive/` is historical. Not consulted for current work.
```

## Appendix B — proposed `.sandcastle/CODING_STANDARDS.md`

Generic base (§ Style through § Security) is the sandcastle template from
`prd/009` — keep it in sync with the template rather than editing it here.
The Marky Mark section is this repo's.

```markdown
# Coding Standards

Loaded by the reviewer agent on every code review via
`@.sandcastle/CODING_STANDARDS.md`, so it costs nothing during
implementation. A rule the reviewer cannot check against a diff is noise —
delete it rather than let it dilute the ones that can be checked.

## Style

- Match the surrounding file: naming, comment density, and idiom come from
  the code being edited, not from a global preference.
- Names say what a thing is for. No `data`, `info`, `handle`, `tmp`.
- Comments explain *why*, not *what*. A comment restating the line below it
  is noise.
- No commented-out code, no leftover debug logging, no TODO without an
  owner or an issue link.

## Testing

- Every behavior change ships with a test that fails before the change.
- Existing tests are never weakened to make a change pass. If a test must
  change, the PR body says which and why.
- Test names state the expected behavior, not the function under test.
- No sleeps or wall-clock assertions; wait on the condition, not the clock.

## Architecture

- Prefer the smallest change that fully solves the problem. Refactors not
  required by the task belong in their own change.
- One module, one concern. A module needing "and" to describe it is two.
- Push logic out of framework-coupled code (components, handlers,
  entrypoints) into pure functions testable without the framework.
- Duplication is cheaper than the wrong abstraction. Extract on the third
  use.

## Errors and edge cases

- Handle the error path explicitly or let it propagate. Never swallow.
- Error messages name what failed and what to do about it.
- Validate at the boundary (input, parse, deserialize); trust internal
  callers.

## Security

- Never log or commit secrets, tokens, or credentials.
- Treat external input as untrusted: validate, escape, parameterize.

## Marky Mark

### Spec provenance

- Every non-obvious line carries the spec that put it there:
  `// SPEC34 §2.3: <what and why>`. A change implementing a spec section
  adds or updates that tag. These 753 tags are the codebase's navigation
  index — an untagged change is a hole in it.

### Tests

- Test IDs are global and sequential: `U<n>` unit, `E<n>` desktop e2e,
  `W<n>` web e2e. New tests take the next free number and are named in the
  spec's Definition of Done.
- `npm run validate` must print `VALIDATION: ALL PASSED` before any commit.
  `QUICK VALIDATION: ALL PASSED` is deliberately a different string and is
  not release evidence.

### The platform seam

- `src/platform/types.ts` is the only contract between app code and the
  host. App code never imports `@tauri-apps/*` directly — it goes through
  the seam, so the browser shim (`browser.ts`) and the web build (`web.ts`)
  stay honest.
- Dev-shim seams (`window.__mmfs`, `__mmMenu`, `__mmEdit`) are e2e-only and
  stay gated. They never become app logic.

### Where logic goes

- Pure logic lives in `src/lib/*` with unit tests. `App.tsx` is already
  4,600 lines and 233 hooks; adding logic there instead of a lib module is
  a review finding.
```
