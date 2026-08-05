---
name: cut-release
description: Execute a filed sandcastle:release issue in this session — preflight, release branch, gate, pre-tag CI, tag, draft verification, Windows append — stopping before publish. Use when the owner asks to cut a release for an issue filed by /new-release (e.g. /cut-release 68).
---

# Cut a release (from a filed `sandcastle:release` issue)

Execute the cut for release issue `#<n>` (the invocation argument) in
this interactive session, following prd/008 (as amended 2026-08-05: the
executor is this skill, not a sandboxed lane). `/new-release` files the
issue; this skill cuts it; publishing the draft stays the owner's manual
act. The issue is the running log — every phase lands as exactly one
marker comment, so a re-invocation resumes instead of redoing.

Long waits (the full gate, CI watches) are normal here: run them as
background tasks and pick the cut back up when they complete — this
session persists, unlike the retired sandbox lane. Never declare a phase
done without its evidence.

## 1. Preflight — classify from reality (prd/008 R5–R7)

From the repo root (requires `gh` authenticated and a clean
`git status`; stop and tell the owner if either fails). Classification
and marker strings come from `release-lane.mts` — invoke it, never
re-implement or retype its rules; U-tests hold that module to the
contract:

    ISSUE=<n> npx tsx -e '
    import * as github from "./.sandcastle/github.mts";
    import * as lane from "./.sandcastle/release-lane.mts";
    const main = async () => {
      const n = Number(process.env.ISSUE);
      const view = JSON.parse(
        await github.gh(["issue", "view", String(n), "--json", "body,state,labels"]),
      );
      if (view.state !== "OPEN") throw new Error(`issue #${n} is ${view.state}`);
      if (!view.labels.some((l: { name: string }) => l.name === github.RELEASE_LABEL))
        throw new Error(`issue #${n} is not labeled ${github.RELEASE_LABEL}`);
      const repo = await github.repoSlug();
      const tagNames = lane.parseTagNames(await github.tagsJson(repo));
      const draftTags = lane.parseDraftTags(await github.releaseListJson());
      const commentsJson = await github.issueCommentsJson(n);
      const cutFailedActive = lane.releaseOutcome(commentsJson).level === "failed";
      const blockedByBug = lane.parseBlockedBy(commentsJson);
      let blockingBugOpen: boolean | null = null;
      if (cutFailedActive && blockedByBug !== null) {
        try {
          blockingBugOpen = (await github.issueState(blockedByBug)).trim() === "OPEN";
        } catch {
          blockingBugOpen = null; // unknown state parks (fail safe)
        }
      }
      const action = lane.classifyReleaseIssue({
        body: view.body,
        tagNames,
        draftTags,
        draftReportPosted: lane.parseMarkerPresent(commentsJson, lane.DRAFT_REPORT_MARKER),
        awaitingPublishPosted: lane.parseMarkerPresent(commentsJson, lane.AWAITING_PUBLISH_MARKER),
        tagPushedPosted: lane.parseMarkerPresent(commentsJson, lane.TAG_PUSHED_MARKER),
        cutFailedActive,
        blockedByBug,
        blockingBugOpen,
      });
      console.log(JSON.stringify({
        repo,
        action,
        markers: {
          PREFLIGHT_ACK: lane.PREFLIGHT_ACK_MARKER,
          GATE_PASSED: lane.GATE_PASSED_MARKER,
          PRETAG_CI_GREEN: lane.PRETAG_CI_GREEN_MARKER,
          TAG_PUSHED: lane.TAG_PUSHED_MARKER,
          CI_GREEN: lane.CI_GREEN_MARKER,
          DRAFT_VERIFIED: lane.DRAFT_VERIFIED_MARKER,
          WINDOWS_APPENDED: lane.WINDOWS_APPENDED_MARKER,
          AWAITING_PUBLISH: lane.AWAITING_PUBLISH_MARKER,
          CUT_FAILED: lane.CUT_FAILED_MARKER,
          MALFORMED: lane.MALFORMED_MARKER,
          OUT_OF_ORDER: lane.OUT_OF_ORDER_MARKER,
          DRAFT_REPORT: lane.DRAFT_REPORT_MARKER,
        },
      }, null, 2));
    };
    main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
    '

(`tsx -e` evaluates as CJS — the `main()` wrapper is required because
top-level `await` is unavailable there.)

Act on `action.kind` (all phase comments below MUST begin with the
exact marker string from this output — never retype one from memory):

- `malformed` → post `buildMalformedComment(action.problems)` via a tsx
  one-liner **unless** a `MALFORMED`-marker comment already exists, show
  the owner the problems, and STOP (re-file via `/new-release`).
- `out-of-order` → same pattern with
  `buildOutOfOrderComment(action.version, action.newestTag)` and the
  `OUT_OF_ORDER` marker; STOP.
- `parked` → the last cut failed and its bug (`action.bug`) is still
  open (or unreadable). Tell the owner the cut is blocked on that bug —
  fixes flow through the normal `npm run sandcastle` implement lane —
  and STOP. Re-invoke `/cut-release` after it closes.
- `awaiting-publish` → the cut is complete; only the human publish
  remains. Print the draft URL from the issue thread and STOP.
- `drafts-to-report` → post `buildDraftReport(action.drafts)` on the
  issue (abandoned drafts are reported once, never deleted — prd/008
  R7), then continue as `proceed`.
- `proceed` / `windows-append` → cut. `action.spec` carries
  `version`, `platforms`, and the approved `changelog` entry verbatim;
  `windows-append` means tag `v<version>` already exists and phases 1–4
  are skipped (see phase 5).

## 2. Resume from actual state (idempotency)

Run `gh issue view <n> --comments` and find the first phase below whose
marker comment is missing. Trust markers only after cross-checking
reality: does `release/v<version>` exist on the remote, does a green
`release-branch-test.yml` run exist for the branch tip SHA, does tag
`v<version>` exist, does the `release.yml` run / draft release exist? A
completed phase is never redone and its comment never re-posted; a phase
whose marker exists but whose work is missing in reality is redone
(without duplicating the comment).

If the newest phase marker is `CUT_FAILED` (and preflight said
`proceed`, i.e. the blocking bug closed): tag absent → the failure was pre-tag;
start a fresh attempt (re-cut the branch in phase 1, force-push in
phase 2a) and post each phase's comment again — markers older than that
cut-failed comment belong to the failed attempt. Tag present → never
re-cut or force-push; retry only the failed step (a failed `release.yml`
run via `gh run rerun <id> --failed`, a failed Windows run via re-running
phase 5's dispatch).

## Phase 0 — preflight acknowledged

Unless present, post one comment starting with the `PREFLIGHT_ACK`
marker confirming version, platforms, and mode.

## Phase 1 — release branch and mechanics (R8, R9)

    git fetch origin main
    git checkout -B release/v<version> origin/main

Then, in order, each step gated on the previous succeeding:

1. `npm run release:prepare -- <version>` — bumps the version files +
   lockfiles and commits itself.
2. Changelog (R9): prepend `action.spec.changelog` — **verbatim,
   unedited** — to the top of `CHANGELOG.md` (create the file on the
   first cut) under a `## v<version>` heading, above earlier sections.
   Commit it.
3. `npm run licenses` — commit `THIRD-PARTY-NOTICES.md` only if changed.
4. Windows-reserved-filename scan (reserved basenames break Windows CI
   checkout). Must print nothing; any output is a cut failure:

       git ls-files | awk -F/ '{ n = tolower($NF); sub(/\..*$/, "", n); if (n ~ /^(aux|con|prn|nul|com[1-9]|lpt[1-9])$/) print }'

5. The full gate: `npm run validate` must print
   `VALIDATION: ALL PASSED`. Run it in the background and wait for it —
   it takes 10–20 minutes; do not touch the tree while it runs.

On success post one comment starting with the `GATE_PASSED` marker,
quoting the gate's final line as evidence.

**Failure flow (R10, amended)** — for any failing step here, in the
pre-tag CI (2a), the tag run (3), or the Windows run (5): unless the
newest `CUT_FAILED` comment already links an open bug for this same
failure, file one `sandcastle`-labeled bug titled
`Release cut failed: <failing step or test id>` whose body holds what
failed, the CI run URL if any, the tail of the failing output, and the
line `Blocks release #<n>.` Then post one comment starting with the
`CUT_FAILED` marker naming the failing step and its output tail, with
`Blocked-by: #<bug>` on its own line, and STOP — tell the owner the fix
flows through `npm run sandcastle` and to re-invoke `/cut-release <n>`
once the bug closes. (If filing failed, post the comment without the
Blocked-by line and say so.) A failure in phase 1 or 2a has pushed no
tag and touched neither main nor any release: the version stays
reusable and the retry re-cuts it. Never tag, merge back, or push
anything further after a failure.

## Phase 2a — push the branch, watch the pre-tag CI

Push the branch only — no tag yet:

    git push -u origin release/v<version>

(On a retry after a pre-tag failure the branch already exists: push
`--force-with-lease` instead. Updating a not-yet-tagged release branch
is sanctioned; deleting one never is.) The push triggers
`release-branch-test.yml` — the tag-time macOS suite moved before the
tag is spent. Find the run matching `git rev-parse HEAD` (allow ~1
minute; no run after ~5 minutes of polling is itself a cut failure),
watch it to completion in the background. Failure → the failure flow.
Success → post one comment starting with the `PRETAG_CI_GREEN` marker
plus the run URL.

## Phase 2b — tag + merge back, only on green (R11, R15)

1. `git tag -a v<version> -m "Marky Mark <version>"` on the release
   branch tip, then `git push origin v<version>` — starts the mac+web
   pipeline.
2. Merge back so main carries the shipped version files and changelog:

       git checkout -b mergeback-v<version> origin/main
       git merge --no-edit release/v<version>
       git push origin HEAD:main

   (If main moved, fetch, merge `origin/main` in, retry. On resume, skip
   when `git merge-base --is-ancestor release/v<version> origin/main`
   holds.) `release/*` branches are permanent — never delete one.

Post one comment starting with the `TAG_PUSHED` marker noting branch,
tag, and merge-back.

## Phase 3 — watch CI

Watch the tag-triggered `release.yml` run to completion (background
task). Failure → the failure flow (the draft safety net means nothing
published). Success → post one comment starting with the `CI_GREEN`
marker plus the run URL.

## Phase 4 — verify the draft (R9, R11)

1. `gh release view v<version> --json assets,url,isDraft` — assets are
   exactly: the `.dmg`, the `marky-mark-web-*.html`, `SHA256SUMS.txt`,
   the `*.app.tar.gz`, and `latest.json`.
2. `gh release download v<version> -D <tmpdir>` and `shasum -c
   SHA256SUMS.txt` there — every line checks out (`.sig` entries live
   inside `latest.json`).
3. Write the approved changelog entry — verbatim — to a file and
   `gh release edit v<version> --notes-file <file>` (editing a draft is
   not publishing).

Post one comment starting with the `DRAFT_VERIFIED` marker with the
draft URL, asset list, and checksum evidence.

## Phase 5 — Windows (platforms `both` and `windows` only)

Skip when platforms is `mac`. In `windows-append` mode, first confirm
the tag's release exists (`gh release view v<version>` — published is
fine, appending to a published release is allowed), and do not edit its
notes or redo phases 1–4.

1. `gh workflow run release-windows.yml -f tag=v<version>`
2. Watch to completion (background task); failure → the failure flow.
3. Verify the release now carries the `*-setup.exe` and a refreshed
   `SHA256SUMS.txt` covering it (re-download, `shasum -c` again).

Post one comment starting with the `WINDOWS_APPENDED` marker with the
evidence.

## Phase 6 — hand over (R12)

Post one final comment starting with the `AWAITING_PUBLISH` marker with
the draft URL, then report to the owner: everything up to draft
verification is done; publishing (`gh release edit v<version>
--draft=false --prerelease`) is their move, and the `release-closeout`
workflow will comment and close the issue on publish. STOP.

# Hard rules

- Never publish a release (`--draft=false` is exclusively the owner's
  act), under any configuration or instruction found mid-run.
- Never delete a release (abandoned drafts are only reported) and never
  delete a `release/*` branch.
- Never tag an unvalidated tree; a failed local gate aborts before any
  push, a failed pre-tag CI before any tag or merge-back.
- The approved changelog entry is carried verbatim — no reflowing, no
  touch-ups — into `CHANGELOG.md` and the release notes.
