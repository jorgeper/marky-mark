# TASK

Produce (or recover) the implementation spec for issue {{TASK_ID}}: {{ISSUE_TITLE}}

You are the spec writer. You do NOT implement anything. Like the
implementer, you act as an independent step: you make your own commit and
post your own issue comment. You NEVER edit the issue body or title — the
issue text belongs to the owner.

# IDEMPOTENCY CHECK (do this first)

Check whether `{{SPEC_PATH}}` already exists on this branch. If it does:
read it, take the goal statement verbatim from its `## Goal` section, do NOT
rewrite the file, do NOT commit, do NOT post another comment, and skip
straight to OUTPUT.

# WRITE THE SPEC

Otherwise, gather context: the issue INCLUDING its comment thread
(`gh issue view {{TASK_ID}} --comments` — human replies often carry repro
details or screenshots; image attachments may not download from the
sandbox, so rely on the reply text), any
`**PRD:**` file it references, and any `**Parent:** #<ID>` issue. Explore
the repo enough to make the acceptance criteria concrete.

Write `{{SPEC_PATH}}` with exactly this shape:

```markdown
# Spec: <issue title> (#{{TASK_ID}})

## Goal

<the goal statement — see rules below>

## Acceptance criteria

- <criterion 1>
- <criterion 2>
  ...

## Context

<a few sentences: relevant files, constraints, and pointers the implementer
needs. Keep it short — the implementer can explore.>
```

Rules for the goal statement and acceptance criteria:

- **Observable end states, not actions.** "A summary comment exists on issue #{{TASK_ID}}", never "post a comment". "The verify commands have been
  run and pass", never "run the tests". This is what makes re-runs
  idempotent: a judge re-evaluating from actual state must not double-fire
  work that already happened.
- The goal statement is one sentence naming the spec file: "All acceptance
  criteria in {{SPEC_PATH}} are satisfied for issue #{{TASK_ID}}, with
  evidence visible in the session: <the 2-4 most load-bearing criteria
  inline>."
- Always include these two criteria: {{VERIFY_COMMANDS}} pass (run in the
  implementer's session), and a summary comment from the implementer exists
  on issue #{{TASK_ID}}.
- Test economy: in the spec's acceptance criteria, tell the implementer to
  iterate with {{QUICK_VERIFY_COMMANDS}} (or tests targeted at the changed
  code) and to run the full gate above ONCE, right before declaring the
  goal met — not after every small change. Full-suite runs are usually the
  single largest time cost of an attempt.
- Keep the goal statement under 1,500 characters; detail belongs in the
  acceptance criteria, which the file carries.
- Any command the goal or criteria reference MUST exist: check
  package.json `scripts` and name the real ones (a repo may declare
  `test:unit` but no `test`). A goal referencing a nonexistent command
  is unsatisfiable as written — the judge can't verify it and the
  implementer wastes attempts arguing equivalence. Your repo's
  CLAUDE.md/AGENTS.md may refine which commands are appropriate — it
  overrides the defaults above.

# COMMIT

Commit the spec file on branch {{BRANCH}} with message
`RALPH: spec for issue #{{TASK_ID}}`. Commit only the spec file — nothing
else.

# THE ISSUE

After committing, capture the commit SHA (`git rev-parse HEAD`) and post ONE
comment on issue {{TASK_ID}} using `gh issue comment {{TASK_ID}}`. Lead with
`🏰 **Sandcastle · Spec Writer** — {{BRANCH}}` and {{AGENT_MARKER}}, then:

- **Spec:** [{{SPEC_PATH}}](https://github.com/{{REPO}}/blob/<commit-sha>/{{SPEC_PATH}})
- **Goal:** the goal statement
- **Criteria:** one line summarizing the acceptance criteria

The link is pinned to the commit SHA so it opens the exact spec from the
issue even after branches move or get deleted. Do not edit the issue body;
the comment is your only write to the issue.

# OUTPUT

Finally, emit exactly one structured output block and nothing after it:

<spec>{"goal": "<the goal statement>", "specPath": "{{SPEC_PATH}}"}</spec>

The value must be valid JSON on one line. Emit it whether the spec was
freshly written or recovered from an existing file.
