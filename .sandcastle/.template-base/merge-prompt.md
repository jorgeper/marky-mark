# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. If the merge was a clean FAST-FORWARD, skip verification for that branch: the resulting tree is byte-identical to the branch tip, which the implementer's final gate already verified — re-running the suite proves nothing and wastes minutes
4. Otherwise (a real merge commit, with or without conflicts), run {{VERIFY_COMMANDS}} to verify everything works
5. If tests fail, fix the issues before proceeding to the next branch

After all branches are merged, make a single commit summarizing the merge.

# CLOSE ISSUES

For each branch that was merged, first leave a single comment on its issue recording the merge, using:

`{{COMMENT_TASK_COMMAND}}`

Lead the comment with `🏰 **Sandcastle · Merger**`, then keep it concise:

- **Merged:** `<branch>` → the current branch
- **Tests:** the result of {{VERIFY_COMMANDS}} — or "fast-forward; already gated on the branch" when verification was skipped per the rule above

Then close the issue using the following command:

`{{CLOSE_TASK_COMMAND}}`

# CLOSE FINISHED PARENTS

After closing an issue, check its body for a `**Parent:** #<ID>` line. If present, use your issue tracker's tools to search for any OTHER open issues whose body also contains `**Parent:** #<ID>` — that body line is how sub-issues are marked. Viewing the parent alone with `{{VIEW_TASK_COMMAND}}` will not show its sub-issues, and the `{{ISSUES}}` list below is not sufficient either, since sub-issues created without the `Sandcastle` label are invisible to this run. Only if that search turns up no other open sub-issues, close the parent too using `{{CLOSE_TASK_COMMAND}}`, with a comment noting that all sub-issues are complete. If you cannot verify that no open sub-issues remain, leave the parent open rather than closing it. If the issue has no `**Parent:**` line, skip this step.

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
