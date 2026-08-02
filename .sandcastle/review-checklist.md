# THE REVIEW BAR

The single standard every reviewer in this repo applies. Both review modes
read this file: the branch reviewer (works on the diff, edits the code
itself) and the PR reviewer (works on the pull request, comments in review
threads). Same bar, different surface — only the way you act on what you
find differs, and that lives in your own prompt.

## 1. Understand the change first

Read the diff and the commits before judging anything. Ask what the change
is trying to do; review against that intent, not against the code you would
have written.

## 2. Correctness

- Does the implementation actually match the intent?
- Edge cases: empty/missing/malformed input, boundaries, concurrency,
  failure paths. What happens when the thing being called fails?
- Are new and changed behaviours covered by tests? A behaviour change with
  no test is a finding.
- Unsafe casts, `any`, non-null assertions, unchecked assumptions.
- Security: injection, credential or token leaks (including into logs and
  error messages), unvalidated external input, secrets in committed files.
- Error handling that silently swallows failures.

## 3. Clarity and simplicity

- Unnecessary complexity and nesting.
- Redundant code, dead code, and abstractions that earn nothing.
- Names that don't say what the thing is.
- Related logic that belongs together but is scattered (or vice versa).
- Comments that restate obvious code. Comments should explain *why*.
- Nested ternaries — prefer `switch` or an `if`/`else` chain.
- Clarity over brevity: explicit code beats clever compact code.

## 4. Balance — don't over-correct

Simplification has a cost too. Do not push changes that:

- reduce clarity or maintainability,
- produce clever solutions that are hard to follow,
- fold too many concerns into one function or component,
- delete helpful abstractions that organize the code,
- make the code harder to debug or extend.

## 5. Project standards

Read @.sandcastle/CODING_STANDARDS.md and apply it, plus any CLAUDE.md /
AGENTS.md conventions in the repo. Repo conventions beat personal taste.

## 6. Preserve functionality

Never change what the code does — only how it does it. All original
features, outputs, and behaviours must remain intact. Behaviour changes
belong to the implementer, not the reviewer.

## 7. What NOT to raise

- Praise-only remarks and "looks good" noise.
- Nitpick floods — batch related small points into one place.
- Style already settled by the coding standards or the formatter.
- Scope growth: work the change never claimed to do. If it's worth doing,
  it's worth a separate issue, not a blocked review.
- Points you have already made once. Add a new argument or let it go.
