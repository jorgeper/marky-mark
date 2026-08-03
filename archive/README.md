# archive/

Historical material the project keeps but agents are not expected to read.
One location, one rule: if it lives here, it is a record of how something was
done, not a description of how the code works today.

What's here:

- **`goals/`** — the GOAL files (`GOAL.md`, `GOAL2.md`, …) that launched and
  verified each numbered milestone. The specs they were written against are
  still live at [`docs/specs/`](../docs/specs/).
- **`superpowers/plans/`** — dated implementation plans from a retired
  planning workflow.
- **`articles/`** — long-form write-ups about the project, including
  `how-marky-mark-is-built.html`. The control panel's Docs tab lists and
  serves these from here.

## Excluded from agent context

Coding agents working in this repo do not read `archive/`. Its contents are
kept out of the files agents open by default and out of their search results,
so that repo-wide greps surface current code and specs rather than years of
superseded narrative. Nothing in here is required to implement, review, or
verify a change.

The live sources agents *do* consult are unaffected: `docs/specs/` (the app's
numbered contract history), `specs/` (per-issue working specs), `prd/`
(product requirements) and the rest of `docs/`.

## Consulting it deliberately

When you actually want the history — reconstructing why a milestone was
accepted, tracing a decision back to the plan that made it — read it on
purpose. Open a file here by its explicit path, or ask an agent to read a
named file under `archive/` and say that you mean it. Deliberate, targeted
access is the intended use; the exclusion only stops this material from
arriving uninvited.

## Nothing is deleted or unversioned

Every file here is tracked in git and moved, not copied or trimmed. The 45
files under `goals/`, `superpowers/plans/` and `articles/` arrived from their
former homes under `docs/` byte-for-byte, recorded in git as renames, so
`git log --follow` reaches their full history. Nothing
was dropped in the move, and nothing here is excluded from version control.
