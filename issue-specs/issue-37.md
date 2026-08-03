# Spec: Add AGENTS.md (+ CLAUDE.md symlink) as the cold-session map, gated by validate.mjs (#37)

## Goal

All acceptance criteria in issue-specs/issue-37.md are satisfied for issue #37, with evidence visible in the session: `AGENTS.md` exists at the repository root as a pointers-and-costs cold-session map (citation-grep navigation, verification-command costs, do-not-read list, one-line directory map) with `CLAUDE.md` as a root symlink resolving to it; `scripts/validate.mjs` fails — in the quick tier too — when `CLAUDE.md` does not resolve to `AGENTS.md`, demonstrated by breaking and restoring the link; `npm run validate:quick` passes in the implementer's session; and a summary comment from the implementer exists on issue #37.

## Acceptance criteria

- `AGENTS.md` exists at the repository root and is the single source of truth.
  `CLAUDE.md` at the root is a symlink to `AGENTS.md` (git mode `120000`,
  visible via `git ls-files -s CLAUDE.md`), so both harnesses resolve the same
  content.
- `scripts/validate.mjs` contains a check that fails when `CLAUDE.md` does not
  resolve to `AGENTS.md` — covering both a missing/regular-file `CLAUDE.md`
  (a Windows checkout without `core.symlinks` materialises the symlink as a
  text file containing the path) and a symlink pointing elsewhere. The check
  runs in **both** the full and `--quick` tiers: like the version lock-step
  and `docs/MAP.md` checks at the top of the script, it is a spawn-free file
  check that sits ahead of the `steps` array (`scripts/validate.mjs:212`)
  rather than inside it.
- The gate is demonstrated in-session: with the symlink replaced by a regular
  file (or removed), `node scripts/validate.mjs --quick` fails at the new
  step with an error naming the fix; the break is then reverted. The
  demonstration is recorded in the implementer's summary comment.
- `AGENTS.md` states its own size budget in its header — a target of ~150
  lines / ~2k tokens — with the reason (every agent loads it on every
  session). The budget is documented, not gate-enforced, and the shipped file
  respects it in spirit (roughly that size, not multiples of it).
- `AGENTS.md` contains pointers and costs, not behaviour: no coding rules are
  duplicated from `.sandcastle/CODING_STANDARDS.md`; it points there for
  standards instead.
- `AGENTS.md` teaches citation-grep as the primary navigation move: the
  `// SPEC<n> §x.y:` comment convention, the current count of citation sites
  in `src/` + `tests/` (PRD 005 measured 755 on 2026-08-03 at `5e77171`;
  recount at implementation time — e.g. `grep -rEo 'SPEC[0-9]+' src tests |
  wc -l` — and state the fresh number), and a worked example showing that
  `rg 'SPEC34' src` locates the folder sidebar's implementation for roughly
  2k tokens instead of a ~50k-token read of `App.tsx`.
- `AGENTS.md` states the cost of each verification command and which to use
  when: `npm run test:e2e` is too slow for the inner loop; `npm run
  typecheck` + `npm run test:unit` is the iteration pair; `npm run
  validate:quick` is the gate before declaring work done. This must be
  consistent with `QUICK_VERIFY_COMMANDS` and `VERIFY_COMMANDS` in
  `.sandcastle/config.mts:56-75`.
- `AGENTS.md` names what an agent should **not** read and why: `archive/`
  (historical material, excluded from agent context), and
  `docs/ARCHITECTURE.md` when the question is "which file do I edit" —
  `docs/MAP.md` answers that instead.
- `AGENTS.md`'s navigation section names `docs/MAP.md` as the answer to
  "where is feature X", alongside citation-grep, and names `npm run map` as
  the one-command regeneration for it (requirement 34's `AGENTS.md` half).
- `AGENTS.md` gives the directory map — one line apiece for `docs/specs/`,
  `issue-specs/`, `prd/`, `archive/`, `src/lib/`, `tests/e2e/`, and
  `fixtures/` — including the requirement-43 rule in one line: `docs/specs/`
  is the app's numbered contract history that code cites; `issue-specs/` is
  Sandcastle's per-issue working specs.
- Both `archive/README.md` and `AGENTS.md` state that the archive exclusion
  is a context guardrail, not a security boundary, and that secrets must not
  be placed in `archive/` on the strength of it. (`archive/README.md` does
  not currently say this — a short addition is needed.)
- PRD evidence 49 is recorded in the implementer's summary comment: the
  sequence by which a cold session locates the folder-sidebar implementation
  using only `AGENTS.md` and one search command (`rg 'SPEC34' src`, or the
  `grep -rn` equivalent since `rg` is not installed in the sandbox), without
  reading `App.tsx` or `docs/ARCHITECTURE.md` in full.
- `npm run validate:quick` passes, run **once** in the implementer's session
  immediately before declaring the goal met, printing `QUICK VALIDATION: ALL
  PASSED`. Iterate with `npm run typecheck` and `npm run test:unit` (or tests
  targeted at the changed code) during development — do not run the quick
  gate after every small change, and do not run it as a starting baseline.
  The PRD's evidence 44 (`npm run validate` printing `VALIDATION: ALL
  PASSED`) cannot run in this sandbox — `cargo` is not on PATH, and the full
  gate's build steps need it — so `validate:quick` stands in; the new
  symlink check running in the quick tier is what makes that substitution
  meaningful.
- A summary comment from the implementer exists on issue #37.

## Context

Parent issue #23; PRD `prd/005-agent-context-hygiene.md` (section A
requirements 1–8, plus 27, 34-half, 35, 43, 44, 49 — the issue body quotes
them all). All blockers (#32, #33, #35, #36) are merged: `archive/`,
`docs/MAP.md` + `npm run map`, and `issue-specs/` all exist on main, so every
path `AGENTS.md` points at is real. `scripts/validate.mjs` already has two
spawn-free pre-`steps` checks to use as templates — version lock-step and the
`docs/MAP.md` comparison at lines ~150–165; follow their error-message and
`record()` pattern. Note `.claude/settings.json` denies `Read` on
`archive/**`: inspect `archive/README.md` with `git show
HEAD:archive/README.md` and edit it via Bash (e.g. a heredoc append) rather
than the Read/Edit tools. `package.json` has `validate:quick`, `validate`,
`typecheck`, `test:unit`, and `map` scripts; there is no plain `test` script.
`rg` is not installed in the sandbox — use `grep -rn` when reproducing the
worked examples, but keep `rg` in `AGENTS.md`'s text (it is what agent
harnesses ship). The PRD's citation-site count (755) has drifted (a raw grep
today returns ~829 mentions); recount rather than copying 755.
