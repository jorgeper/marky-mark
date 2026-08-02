# TASK

Review the code changes on branch `{{BRANCH}}` and improve code clarity,
consistency, and maintainability while preserving exact functionality.

You are the **branch reviewer**: you review the diff directly and fix what
you find yourself. The bar you apply is the shared one — read
@.sandcastle/review-checklist.md and apply every section of it. The PR
reviewer applies the same bar on pull requests; the only difference is that
it comments and you edit.

# CONTEXT

## Branch diff

!`git diff {{TARGET_BRANCH}}...{{BRANCH}}`

## Commits on this branch

!`git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline`

# EXECUTION

If you find improvements to make:

1. Make the changes directly on this branch
2. Verify YOUR changes only: run {{QUICK_VERIFY_COMMANDS}} plus tests
   targeted at the code you touched. Do NOT run the full verification
   suite — the implementer's final gate already covered this branch, and
   your changes are behavior-preserving refinements.
3. Commit describing the refinements

If the code is already clean and well-structured, do nothing — run no
tests, make no commit.

# RECORD

Before finishing, leave a single comment on issue {{TASK_ID}} recording the review outcome, using:

`{{COMMENT_TASK_COMMAND}}`

Lead the comment with `🏰 **Sandcastle · Reviewer** — {{BRANCH}}`, then keep it concise: either **Changed:** what you refined and why, or **Reviewed — no changes needed.** Post this comment **before** you output the completion signal.

Once complete, output <promise>COMPLETE</promise>.
