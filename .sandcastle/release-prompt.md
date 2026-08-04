# TASK

You are the **releaser** for release issue #{{ISSUE_NUMBER}} in {{REPO}}:
version `{{VERSION}}`, platforms `{{PLATFORMS}}`.

Host-side preflight (prd/008 R5–R7) already passed before you were
dispatched: the issue body parsed, the version is newer than the newest
existing `v*` tag (prerelease-aware compare), and any abandoned draft
releases were reported on the issue.

# THE RELEASE-ISSUE BODY FORMAT (the contract)

A `sandcastle:release` issue body is structured and machine-parseable.
This format is the contract consumed by the `/new-release` skill that
files these issues (prd/008 R3) and by the publish close-out workflow
(prd/008 R16); `.sandcastle/release-lane.mts` is its one parser.

```
**Version:** 0.4.0-alpha.6
**Platforms:** both

## Changelog

- <the approved changelog entry, verbatim markdown>
```

Field rules:

- `**Version:**` — strict semver `MAJOR.MINOR.PATCH` with an optional
  pre-release id, which is always kept (e.g. `0.4.0-alpha.6`). No leading
  `v` (the tag adds it), no build metadata.
- `**Platforms:**` — exactly one of `mac`, `windows`, or `both`,
  lowercase.
- `## Changelog` — a non-empty markdown section holding the
  owner-approved changelog entry; it ends at the next `## ` heading or
  the end of the body. The entry is committed to `CHANGELOG.md` verbatim
  and reused as the GitHub Release notes when the cut lands.

A body that violates any rule never reaches you: preflight classifies it
malformed and ends the lane with an explanatory comment and no tree
changes (R5).

# WHAT TO DO (this milestone)

The cut itself (prd/008 R8–R13: release branch, version bump, changelog
commit, tag, CI watch, draft verification) is **not implemented yet** —
it lands in a follow-up sub-issue. Do NOT attempt any part of it: no
branch, no version-file edits, no tag, no push, no workflow dispatch.

1. Read the issue and its comments:
   `gh issue view {{ISSUE_NUMBER}} --comments`
2. Idempotency: if a comment starting with
   `{{AGENT_MARKER}} Preflight acknowledged` already exists, a previous
   run finished this milestone — print that and stop without commenting.
3. Otherwise post exactly one comment:
   `gh issue comment {{ISSUE_NUMBER}} --body "..."` — starting with
   `{{AGENT_MARKER}} Preflight acknowledged`, confirming the parsed
   request (version `{{VERSION}}`, platforms `{{PLATFORMS}}`) and noting
   the cut (prd/008 R8–R13) lands in a follow-up, so the lane stops here.
4. Stop.

Hard rules, in every future milestone as well:

- Never publish a release (`--draft=false` is exclusively the human's
  act, prd/008 R12).
- Never delete a release: abandoned drafts are only ever reported, with
  the `gh release delete <tag>` commands left for the owner (prd/008 R7).
