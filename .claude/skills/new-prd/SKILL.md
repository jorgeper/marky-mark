---
name: new-prd
description: Grill the user into a PRD for a sandcastle:requires-prd GitHub issue, then open the PRD PR linked to it. Use when the user wants to write a PRD, spec out a feature, or the orchestrator said an issue needs a PRD.
---

# New PRD (issue-anchored)

Turn a `sandcastle:requires-prd` issue into a PRD pull request through a
relentless interview. The owner filed the issue; you never create issues.

## 1. Resolve the target issue

If the user gave an issue number or URL, use it. Otherwise list the
candidates and let them pick:

    gh pr list --state all --limit 200 --json headRefName --jq '[.[].headRefName]'
    gh issue list --state open --label "sandcastle:requires-prd" --json number,title

An issue is a candidate only if NO branch `prd/issue-<N>-*` appears in
the PR list (those already have a PRD PR). If the picked issue's PRD PR is
already MERGED, say so and stop — decompose is the orchestrator's job
(`npm run sandcastle`).

**Feedback mode:** if the issue has an OPEN PRD PR, skip to section 6.

## 2. De-escalation check

Read the issue (`gh issue view <N> --comments`). If it becomes clear this
is a contained bug or small task that needs no PRD, say so and offer to
remove the label:

    gh issue edit <N> --remove-label "sandcastle:requires-prd"

On agreement, also comment on the issue explaining the de-escalation, add
any acceptance criteria you learned, and stop — the plain implement lane
picks it up. Confirm the issue still carries the `Sandcastle` label after
de-escalation (removing `sandcastle:requires-prd` alone does not queue
it); if missing, tell the user to add it.

## 3. Grill

If a `/grilling` or `/grill-me` skill is available, invoke it on the
issue's idea.

If neither is available, tell the user those skills come from Matt Pocock's
skills collection (https://github.com/mattpocock/skills) and offer to
install it for them. If they say yes, run:

    claude plugin marketplace add mattpocock/skills
    claude plugin install mattpocock-skills@mattpocock

Newly installed plugin skills may not be visible until the next session, so
after installing — or if the user declines — conduct the interview yourself
this time: interview the user relentlessly about every aspect of the idea
until you reach shared understanding. Ask questions ONE AT A TIME, each
with your recommended answer first. Look up facts in the repo yourself;
only decisions go to the user. Do not write the PRD until the user
confirms shared understanding.

## 4. Write the PRD

- Find the next free number: list `prd/`, take the highest NNN prefix + 1
  (three digits, zero-padded; first PRD is 001).
- Create branch `prd/issue-<N>-<kebab-slug>` from the default branch —
  this exact branch-name shape is load-bearing: it is how the orchestrator
  links the PR to issue #<N>.
- Write `prd/NNN-<kebab-slug>.md` following `prd/TEMPLATE.md`. Fill every
  section — an empty Non-goals section means you have not grilled hard
  enough. Requirements are numbered, testable statements: the decomposer
  turns each one into a sub-issue acceptance criterion.

## 5. Open the PR

Commit, push, and open the PR:

    git add prd/NNN-<slug>.md && git commit -m "docs: add PRD NNN — <title>"
    git push -u origin prd/issue-<N>-<slug>
    gh pr create --title "PRD NNN: <title>" --body "PRD for #<N>.

<one-paragraph summary>"

The body's first line is `PRD for #<N>.` — NEVER write `Closes #<N>` (or
Fixes/Resolves): the issue must stay open after the merge; it becomes the
parent of the decomposed sub-issues. Comment the PR URL on the issue for
visibility, then return to the default branch.

Tell the user the next steps: review the PR; approve with
`gh pr edit <PR> --add-label "sandcastle:approved"`; then run
`npm run sandcastle` — it merges the PR, decomposes the PRD into
sub-issues, and the implementers take it from there.

## 6. Feedback mode (open PRD PR exists)

Fetch the PR's comments and review threads, check out its branch, revise
the PRD to address them, commit, push, and reply on the threads. Then
remind the user of the approval command above. The PR thread is the
memory — nothing else tracks this conversation.
