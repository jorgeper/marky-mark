# TASK

Review the code changes on branch `{{BRANCH}}` and improve code clarity, consistency, and maintainability while preserving exact functionality.

# CONTEXT

## Branch diff

!`git diff {{TARGET_BRANCH}}...{{BRANCH}}`

## Commits on this branch

!`git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline`

# REVIEW PROCESS

1. **Understand the change**: Read the diff and commits above to understand the intent.

2. **Analyze for improvements**: Look for opportunities to:
   - Reduce unnecessary complexity and nesting
   - Eliminate redundant code and abstractions
   - Improve readability through clear variable and function names
   - Consolidate related logic
   - Remove unnecessary comments that describe obvious code
   - Avoid nested ternary operators - prefer switch statements or if/else chains
   - Choose clarity over brevity - explicit code is often better than overly compact code

3. **Check correctness**:
   - Does the implementation match the intent? Are edge cases handled?
   - Are new/changed behaviours covered by tests?
   - Are there unsafe casts, `any` types, or unchecked assumptions?
   - Does the change introduce injection vulnerabilities, credential leaks, or other security issues?

4. **Maintain balance**: Avoid over-simplification that could:
   - Reduce code clarity or maintainability
   - Create overly clever solutions that are hard to understand
   - Combine too many concerns into single functions or components
   - Remove helpful abstractions that improve code organization
   - Make the code harder to debug or extend

5. **Apply project standards**: Follow the coding standards defined in @.sandcastle/CODING_STANDARDS.md

6. **Preserve functionality**: Never change what the code does - only how it does it. All original features, outputs, and behaviors must remain intact.

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
