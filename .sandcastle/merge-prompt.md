# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run `npm run typecheck` and `npm run test` to verify everything works
4. If tests fail, fix the issues before proceeding to the next branch

After all branches are merged, make a single commit summarizing the merge.

# CLOSE ISSUES

For each branch that was merged, first leave a single comment on its issue recording the merge, using:

`gh issue comment <ID> --body "<BODY>"`

Lead the comment with `🏰 **Sandcastle · Merger**`, then keep it concise:

- **Merged:** `<branch>` → the current branch
- **Tests:** the result of `npm run typecheck` and `npm run test`

Then close the issue using the following command:

`gh issue close <ID> --comment "Completed by Sandcastle"`

# CLOSE FINISHED PARENTS

After closing an issue, check its body for a `**Parent:** #<ID>` line. If present, use your issue tracker's tools to search for any OTHER open issues whose body also contains `**Parent:** #<ID>` — that body line is how sub-issues are marked. Viewing the parent alone with `gh issue view <ID>` will not show its sub-issues, and the `{{ISSUES}}` list below is not sufficient either, since sub-issues created without the `Sandcastle` label are invisible to this run. Only if that search turns up no other open sub-issues, close the parent too using `gh issue close <ID> --comment "Completed by Sandcastle"`, with a comment noting that all sub-issues are complete. If you cannot verify that no open sub-issues remain, leave the parent open rather than closing it. If the issue has no `**Parent:**` line, skip this step.

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
