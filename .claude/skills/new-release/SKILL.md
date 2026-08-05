---
name: new-release
description: Interview the owner for a release — version, platform set, optional highlights — draft the changelog for their approval, then file the sandcastle:release issue. Use when the owner wants to cut a release or file a release request; this is the only supported way to file one.
---

# New release (interview → approved changelog → filed issue)

File a `sandcastle:release` issue in the machine-parseable contract
parsed (and documented) by `parseReleaseIssueBody` in
`.sandcastle/release-lane.mts`.

This skill is the **only supported way** to file a release issue.
Hand-authored bodies are unsupported (`/cut-release` preflight still
refuses malformed ones, but that is a guard, not a workflow). And the
skill **never starts the cut**: it ends at the filed issue's URL —
never run any release mechanics; the owner drives the cut by invoking
`/cut-release <issue#>` (prd/008, amended 2026-08-05).

## 1. Fetch release state

From the repo root:

    git fetch origin main --tags
    gh api 'repos/{owner}/{repo}/tags?per_page=100' > /tmp/new-release-tags.json

Tell the owner the newest existing release tag (step 2's one-liner
prints it) so they can pick the next version with the ground truth in
front of them.

## 2. Interview, then validate

Ask one question at a time. The owner drives — **never invent a
version**; you may state what the newest tag is, but the owner names
the version. Collect:

- **Version** — bare strict semver `MAJOR.MINOR.PATCH` with an optional
  pre-release id (e.g. `0.4.0-alpha.6`). The pre-release id is never
  stripped; no leading `v` (the tag adds it); no build metadata.
- **Platforms** — exactly one of `mac`, `windows`, `both` (lowercase).
- **Highlights** — optional: anything the owner wants emphasized in the
  changelog entry.

Validate version + platforms with the lane's own rules — invoke them,
never re-implement them (a version accepted here must never later
classify `malformed` or `out-of-order` in preflight). From the repo
root:

    V="<version>" P="<platforms>" npx tsx -e '
    import { readFileSync } from "node:fs";
    import {
      compareVersions, newestReleaseTag, parseReleaseIssueBody, parseTagNames,
    } from "./.sandcastle/release-lane.mts";
    const { V = "", P = "" } = process.env;
    const probe = `**Version:** ${V}\n**Platforms:** ${P}\n\n## Changelog\n\n- probe\n`;
    const parsed = parseReleaseIssueBody(probe);
    if (!parsed.ok) {
      console.log("REJECT:");
      for (const p of parsed.problems) console.log(`- ${p}`);
      process.exit(1);
    }
    const tags = parseTagNames(readFileSync("/tmp/new-release-tags.json", "utf8"));
    const newest = newestReleaseTag(tags);
    console.log(`newest existing tag: ${newest ?? "(none)"}`);
    if (P === "windows" && tags.includes(`v${V}`)) {
      console.log(`OK: windows-append — tag v${V} exists, adding the Windows installer to it`);
      process.exit(0);
    }
    if (newest !== null && compareVersions(V, newest) <= 0) {
      console.log(`REJECT: ${V} is not newer than ${newest} (prerelease-aware compare)`);
      process.exit(1);
    }
    console.log("OK: full cut");
    '

This mirrors `classifyReleaseIssue` exactly, including its one ordering
exception: a `windows` request whose tag `vX.Y.Z` already exists is
valid (the R13 windows-append path — e.g. adding the Windows installer
to an already-cut mac release). `mac`/`both` get no such exception; the
version must be strictly newer than the newest tag. On `REJECT`, show
the owner the printed problems and re-ask; **never file a version that
did not print `OK`**.

## 3. Draft the changelog, get explicit approval

Gather what shipped since the last release (most work lands as direct
`RALPH:` commits, so commits are a first-class source, not just PRs):

    git log <newest-tag>..origin/main --oneline
    git log -1 --format=%cs <newest-tag>        # the tag date, for the issue filter
    gh issue list --state closed --search "closed:><tag-date>" --json number,title

(If no release tag exists yet, draft from the full history.) Write the
entry as user-facing markdown bullets — what changed for a user of the
app, not a commit-log paste — folding in the owner's highlights.

Present the draft to the owner for edit/approval and loop on their
edits. **Do not continue to filing until the owner explicitly approves
the text.** The approved text is carried forward verbatim — no
reflowing, no touch-ups after approval.

## 4. Ensure the label, then file

The `sandcastle:release` label must exist and match the conventions of
the other `sandcastle:*` labels (`RELEASE_LABEL` in
`.sandcastle/github.mts`):

    gh label list --json name --jq '.[].name' | grep -qx 'sandcastle:release' ||
      gh label create 'sandcastle:release' --color '006B75' \
        --description 'Release request — cut via /cut-release (prd/008)'

The issue body is exactly this template with the three placeholders
substituted — nothing added, nothing reordered. Unit test U210
(`tests/unit/new-release-skill.test.ts`) holds this fenced block to
`parseReleaseIssueBody`; edit them together.

```release-issue-body
**Version:** {{VERSION}}
**Platforms:** {{PLATFORMS}}

## Changelog

{{CHANGELOG}}
```

Write the substituted body to a file (`{{CHANGELOG}}` is the approved
entry, verbatim) and re-run the parser on the real thing as a last-mile
check:

    B=/tmp/new-release-body.md npx tsx -e '
    import { readFileSync } from "node:fs";
    import { parseReleaseIssueBody } from "./.sandcastle/release-lane.mts";
    const r = parseReleaseIssueBody(readFileSync(process.env.B ?? "", "utf8"));
    if (!r.ok) { for (const p of r.problems) console.log(`- ${p}`); process.exit(1); }
    console.log("body parses ok");
    '

Then file it with the `sandcastle:release` label and **not** the plain
`sandcastle` label — the two are disjoint so the implement lane never
sees release issues:

    gh issue create --title "Release v<version> (<platforms>)" \
      --label 'sandcastle:release' --body-file /tmp/new-release-body.md

## 5. Stop

Report the issue URL to the owner and stop. The cut itself is
`/cut-release <issue#>`, invoked by the owner when they are ready —
this skill never runs it.
