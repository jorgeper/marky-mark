# TASK

Decompose the approved, merged PRD `{{PRD_PATH}}` into implementation
sub-issues of parent issue #{{PARENT_NUMBER}} — "{{PARENT_TITLE}}".

You are the decomposer. The PRD was already approved by the owner (that
approval is the gate — do NOT ask for approval of the breakdown). You do
not implement anything and you NEVER edit the parent issue's body, title,
or labels. Derived issues are the one thing you create.

# IDEMPOTENCY CHECK (do this first)

List the parent's sub-issues:
`gh api repos/{{REPO}}/issues/{{PARENT_NUMBER}}/sub_issues`
If ANY exist, a previous run already decomposed (perhaps partially): do
NOT create more issues, do NOT comment. Print what exists and stop.

# DECOMPOSE

Read `{{PRD_PATH}}` and the parent issue (`gh issue view {{PARENT_NUMBER}}
--comments`). Break the PRD into N ≥ 1 implementable sub-issues. A simple
PRD is a single sub-issue — that is normal, not a special case.

Rules:

- Every sub-issue must be independently landable on the default branch:
  its own branch and PR, tests passing, no half-wired user-visible state.
  Order user-visible wiring last via `Blocked by` edges.
- Acceptance criteria are lifted from the PRD's numbered Requirements —
  each requirement lands in exactly one sub-issue.

Create the sub-issues in dependency order, so earlier siblings' numbers
can be referenced in `Blocked by` lines. Link each sub-issue to the parent
IMMEDIATELY after creating it, before moving on to the next one — a crash
between creation and linking would otherwise leave a labeled, unlinked
child that the next run's sub_issues-based idempotency check can't see,
causing it to re-create everything from scratch:

```
gh issue create --title "<sub-issue title>" --label "{{TRIGGER_LABEL}}" --body "**Parent:** #{{PARENT_NUMBER}}
**PRD:** {{PRD_PATH}}

## Acceptance criteria

- <criterion>

Blocked by #<earlier sibling number>"
```

Omit the `Blocked by` line for unblocked sub-issues. The `**Parent:**` and
`**PRD:**` lines are load-bearing: downstream agents read them.

Then, before creating the next sub-issue, link this one to the parent via
the sub-issue API (it takes the child's database id, not its number):

```
CHILD_ID=$(gh api repos/{{REPO}}/issues/<child number> --jq .id)
gh api repos/{{REPO}}/issues/{{PARENT_NUMBER}}/sub_issues -F sub_issue_id="$CHILD_ID"
```

# REPORT

Comment on the parent (first line is your marker):

```
gh issue comment {{PARENT_NUMBER}} --body "{{AGENT_MARKER}}

Decomposed {{PRD_PATH}} into: #<n1>, #<n2>, …  (dependency edges in the issue bodies)"
```

Finally, print the created issue numbers to stdout.
