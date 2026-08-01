# TASK

Branch {{BRANCH}} (checked out here) has merge conflicts with
{{TARGET_BRANCH}} and cannot be merged. You are agent "{{AGENT_NAME}}".

1. `git fetch origin {{TARGET_BRANCH}}`
2. `git merge origin/{{TARGET_BRANCH}} --no-edit`
3. Resolve every conflict by reading both sides and choosing the correct
   resolution — preserve the intent of BOTH the branch changes and the
   {{TARGET_BRANCH}} changes.
4. Verify: while fixing, use {{QUICK_VERIFY_COMMANDS}} or tests targeted at
   the conflicted files; run {{VERIFY_COMMANDS}} once before finishing and
   fix failures caused by the merge.
5. Commit the merge. Do NOT push — the orchestrator pushes after you finish.

Once complete, output <promise>COMPLETE</promise>.
