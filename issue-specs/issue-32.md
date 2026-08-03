# Spec: Rename specs/ to issue-specs/ and repoint SPEC_DIR and every in-repo reference (#32)

## Goal

All acceptance criteria in issue-specs/issue-32.md (which this change itself
relocates to issue-specs/issue-32.md) are satisfied for issue #32, with
evidence visible in the session: `specs/` has been renamed to `issue-specs/`
carrying all 15 files, `SPEC_DIR` in `.sandcastle/config.mts` is
`"issue-specs"`, no in-repo reference to the old `specs/issue-<n>.md` path
survives outside the carve-outs named below, `npm run validate:quick` passes
in the implementer's session, and a summary comment from the implementer
exists on issue #32.

## Acceptance criteria

- The directory `issue-specs/` exists at the repository root and `specs/` no
  longer exists. Every file that was in `specs/` is in `issue-specs/` with
  the same basename — 15 files: `issue-3.md`, `issue-4.md`, `issue-5.md`,
  `issue-6.md`, `issue-7.md`, `issue-8.md`, `issue-10.md`, `issue-14.md`,
  `issue-15.md`, `issue-16.md`, `issue-17.md`, `issue-18.md`, `issue-19.md`,
  `issue-22.md`, and this file `issue-32.md`. (The issue body says 14; that
  count predates this spec file, which the spec-writer step added.)
- The move was done with `git mv` (or is otherwise recorded by git as a
  rename), so `git log --follow issue-specs/issue-19.md` still reaches the
  pre-rename history. No file content changed as part of the move itself.
- `.sandcastle/config.mts` declares `export const SPEC_DIR = "issue-specs";`.
  The surrounding comment still reads correctly for the new value.
- `.sandcastle/main.ts:17` no longer names the literal path
  `specs/issue-<n>.md`. It describes the spec location in a way that stays
  true — either `issue-specs/issue-<n>.md` or `<SPEC_DIR>/issue-<n>.md`.
  This is the only functional in-repo consumer comment; `main.ts:1019`
  already derives the path from `SPEC_DIR` and needs no change.
- The `## Goal` line inside each of the 15 relocated spec files names its own
  file at the new path (e.g. `issue-specs/issue-19.md`). Only the directory
  segment changes — the rest of each goal statement, and every other line of
  every spec file, stays byte-identical. These are historical goal statements
  for already-judged issues; do not reword them.
- Three carve-outs are left untouched, and the implementer's summary comment
  says so explicitly:
  - `docs/archive/how-marky-mark-is-built.md` and its `.html` sibling —
    historical records of what was true then (PRD requirement 42's carve-out;
    `docs/archive/` is this repo's `archive/`).
  - `prd/005-agent-context-hygiene.md` — its mentions of `specs/` are the
    text *specifying* this rename; rewriting them would make the requirement
    describe a no-op.
  - `.sandcastle/.template-base/` — the pristine upstream template baseline
    used to detect local drift on template updates. Editing it corrupts that
    comparison.
- `rg -n --hidden -g '!node_modules' -g '!.git' 'specs/issue-'` returns hits
  only in `docs/archive/`, `prd/005-agent-context-hygiene.md`,
  `.sandcastle/.template-base/`, and `issue-specs/` (the relocated goal
  lines). The implementer pastes this command's output as evidence.
- `docs/specs/` is untouched: `git status` and the diff show no changes under
  `docs/specs/`, and the 45 files there plus the 755 `SPEC<n>` code citations
  that point at it are unaffected. `docs/security/assessment.md`'s
  `../specs/SPEC11.md` link is a `docs/specs/` reference and must not change.
- While iterating, the implementer uses `npm run typecheck` and
  `npm run test:unit` (or checks targeted at the changed files) — not the
  full gate. Baseline with the quick tier only.
- `npm run validate:quick` has been run in the implementer's session, once,
  right before declaring the goal met, and passes.
- A summary comment from the implementer exists on issue #32, recording the
  rename, the `SPEC_DIR` value, the reference-sweep output, and the three
  carve-outs.

## Context

`SPEC_DIR` lives at `.sandcastle/config.mts:12` and is the only knob the
Sandcastle loop reads for the spec directory; `.sandcastle/main.ts:1019`
builds `` `${SPEC_DIR}/issue-${issue.id}.md` `` from it, so the rename and the
knob must land in the same change or the loop writes future specs into a
directory that no longer matches the committed ones.

The full set of old-path references in the repo today, from
`rg 'specs/issue-'`: `.sandcastle/main.ts:17` (comment, update),
`.sandcastle/.template-base/{main.ts,main.mts}:17` (leave),
`docs/archive/how-marky-mark-is-built.{md,html}` (leave, 8 sites),
`prd/005-agent-context-hygiene.md:279` (leave), and one `## Goal` line in each
of the 14 existing `specs/issue-*.md` files (update the directory segment).
Nothing under `scripts/`, `src/`, `tests/`, `.claude/`, or `.github/`
references the directory, and `scripts/validate.mjs` does not know about it —
so `validate:quick` is a regression check here, not a direct assertion of the
rename.

PRD `prd/005-agent-context-hygiene.md` section G (requirements 40–42) is the
source. Requirement 43 (the one-line `docs/specs/` vs `issue-specs/` rule in
`AGENTS.md`) is explicitly **out of scope** here — `AGENTS.md` does not exist
yet and lands in its own sub-issue. Do not create it. Parent issue is #23.

The trap this change closes: `specs/` (Sandcastle's per-issue working specs)
and `docs/specs/` (the app's numbered contract history, cited by 755 code
comments) differ by one path segment. `docs/specs/` is a PRD non-goal and
stays exactly where it is.
