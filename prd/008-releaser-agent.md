# PRD 008: Releaser agent — issue-driven releases with permanent release branches

**Status:** Draft
**Date:** 2026-08-04

## Problem

Releases today are a hand-run gated sequence (`docs/RELEASING.md`, the
`/release-mac` and `/release-windows` commands). That has produced real
incidents: v0.4.0-alpha.4 was published *after* alpha.5 (#19), the README
advertised a four-releases-old version until `release-prepare` learned to
bump it (#22), two abandoned draft releases still sit in the repo, and
release notes are systematically incomplete because most work lands as
direct `RALPH:` commits that PR-based "What's Changed" lists never see.
There is no `CHANGELOG.md`. Nothing about a release is visible in the
Sandcastle control panel, and the request itself lives nowhere — it is a
command invocation someone has to remember the shape of.

The fix (superseding the one-skill framing of #25): make the release
request a GitHub issue, make the executor a first-class Sandcastle lane,
and give every shipped version a permanent `release/vX.Y.Z` branch.

## Goals

- A release is requested through a short interview (`/new-release`) that
  ends in a `sandcastle:release` issue — the request, running log, and
  audit trail of the cut, visible like any other lane in the control
  panel timeline.
- The releaser lane runs the existing gated sequence unattended up to and
  including draft verification; publishing the draft remains the only
  human, irreversible act.
- The repo gains a curated `CHANGELOG.md` whose entries are drafted from
  commits + closed issues, approved by the owner before the cut, and
  reused verbatim as the GitHub Release notes.
- Every release leaves a permanent `release/vX.Y.Z` branch that the tag
  points into, exempt from all cleanup, so any shipped version has a
  durable line for inspection and future hotfixes.
- Ordering mistakes (#19-style) and malformed requests are refused at
  preflight, before anything touches the tree.

## Non-goals

- **Hotfix cuts** forking `release/vX.Y.1` from `release/vX.Y.0` instead
  of main. Deferred to a future PRD; branch permanence (R14–R15) is the
  enabling groundwork and lands now.
- **Auto-publishing.** The agent never flips `--draft=false`, under any
  configuration.
- **Automated release scheduling.** Only the owner (via `/new-release`)
  files release issues for now; "a future automation files them" stays
  future.
- **Pruning stale drafts automatically.** The agent reports them
  (R7); deletion stays a human act.
- **A dedicated watcher process.** The releaser runs inside the normal
  orchestrator loop; no new daemon or cron.
- **Keeping the old commands.** `/release-mac` and `/release-windows` are
  retired (R18); `docs/RELEASING.md` Flow 2 remains the manual fallback.
- Code signing / notarization, Linux packages, hosted web deployment —
  unchanged out-of-scope from SPEC10.

## Requirements

### The request: `/new-release` skill

1. A `/new-release` skill interviews the owner for the version, the
   platform set (`mac`, `windows`, or `both`), and optional highlights.
   It validates the version is strict semver (pre-release id never
   stripped) and newer than the newest existing tag before proceeding.
2. The skill drafts the changelog entry for the version from commits and
   closed issues since the last release tag, presents it to the owner
   for edit/approval, and does not continue until the owner approves the
   text.
3. The skill creates a GitHub issue labeled `sandcastle:release` with a
   structured, machine-parseable body carrying version, platforms, and
   the approved changelog entry. The skill never starts the cut itself,
   and it is the only supported way to file a release issue.

### Classification and preflight

4. `npm run sandcastle` classifies open `sandcastle:release` issues into
   a releaser lane driven by a dedicated prompt
   (`.sandcastle/release-prompt.md`). Releaser runs are recorded in
   `.sandcastle/logs/timings.jsonl` so the control panel timeline shows
   them like implementer/reviewer lanes.
5. Preflight validates the issue body parses (version, platforms,
   changelog entry). A malformed body ends the lane with an explanatory
   comment on the issue and no changes to the tree.
6. Ordering guard: the lane refuses to cut a version older than or equal
   to the newest existing tag, commenting why and stopping (the
   alpha.4-after-alpha.5 incident, #19, must be unreproducible).
7. Preflight reports any abandoned draft releases as an issue comment
   listing the exact `gh release delete` commands; the agent never
   deletes a release itself.

### The cut

8. The lane cuts branch `release/vX.Y.Z` from the default branch and
   performs all release mechanics on that branch: `npm run
   release:prepare -- X.Y.Z` (four version files + lockfiles), the
   changelog commit (R9), `npm run licenses` (commit
   THIRD-PARTY-NOTICES.md only if changed), the Windows-reserved-filename
   scan, and the full `npm run validate` gate, which must print
   `VALIDATION: ALL PASSED`.
9. The repo gains a `CHANGELOG.md` (created on the first cut). The lane
   commits the issue's approved entry at the top on the release branch;
   the identical text becomes the GitHub Release notes. A missing entry
   blocks the cut.
10. A failed gate aborts the cut before any push or tag exists. The lane
    comments the failure evidence on the issue; it never tags an
    unvalidated tree.
11. The agent itself pushes the release branch and the annotated tag
    `vX.Y.Z` (the tag points into the release branch), watches
    `release.yml` to completion, verifies the draft's asset list and
    `SHA256SUMS.txt`, and comments the draft URL plus verification
    evidence on the issue.
12. After draft verification the lane stops and hands over: publishing
    (`gh release edit --draft=false`) is exclusively the human's act.
13. Platform sequencing: when the issue requests `windows` or `both`, the
    lane dispatches `release-windows.yml` against the tag only after the
    mac/web draft exists, then verifies the appended installer and
    refreshed checksums. A `windows`-only request against an existing tag
    skips the mac cut.

### Branches and main

14. `release/*` branches are permanent: no Sandcastle path (merge,
    cleanup, or otherwise) may delete them.
15. After the tag push, the lane merges the release branch back into the
    default branch and pushes, so main always carries the shipped
    version files and changelog entry.

### Close-out and reporting

16. A workflow triggered on `release: published` (new, or a step
    alongside `updater-manifest.yml`) finds the matching open
    `sandcastle:release` issue, comments the final release links, and
    closes it. Release issues are closed by publish, not by merge
    keywords.
17. Every phase transition (preflight passed, gate passed, tag pushed,
    CI green, draft verified and awaiting publish, windows appended)
    lands as a comment on the release issue — the issue is the running
    log of the cut.

### Retirement and docs

18. `.claude/commands/release-mac.md` and
    `.claude/commands/release-windows.md` are deleted once the lane
    passes a real cut. `docs/RELEASING.md` is rewritten to document the
    issue-driven flow as the primary path and today's manual Flow 2 as
    the fallback.

## Open questions

None — all questions raised in #25 were resolved in the PRD interview
and are reflected above (lane model → R4; issue format → R3/R5;
changelog → R2/R9; publish handback → R12/R16; hotfixes → Non-goals).

## Amendment 2026-08-04 — pre-tag CI gate and failure flow

Superseding parts of R10/R11/R15/R17; full design in
`docs/superpowers/specs/2026-08-04-release-pretag-gate-design.md`.
The macOS test suite now runs on the release branch push
(`release-branch-test.yml`) **before** the tag is spent; the merge-back
is gated on that run being green. A failed cut files a
`sandcastle`-labeled bug (linked via `Blocked-by: #n` in the cut-failed
comment); the lane parks the release while that bug is open and
auto-resumes when it closes. The host reports every releaser run's
outcome from the issue's newest phase marker (new marker: `pre-tag CI
green`) instead of trusting process exit.
