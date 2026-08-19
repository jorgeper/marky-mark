# Spec: TOC model: pure heading-tree logic in src/lib (#131)

## Goal

All acceptance criteria in issue-specs/issue-131.md are satisfied for issue
#131, with evidence visible in the session: a pure, unit-tested `src/lib/`
TOC module exists that derives the H1–H6 heading tree from
`src/lib/sectionModel.ts` output (positional identity, no HTML scraping,
code-fence headings absent), resolves collapse state and the active section,
`npm run validate:quick` passes in the implementer's session, and a summary
comment from the implementer exists on issue #131.

## Acceptance criteria

- A new module `src/lib/tocModel.ts` exists and is pure per
  `.sandcastle/CODING_STANDARDS.md`: no `react`, no `@tauri-apps/*`, no
  `src/components/` imports, no DOM or network access, no `console.*`. It
  takes plain data in (a `DocumentSections` / `SectionNode[]` from
  `src/lib/sectionModel.ts`, a collapse set, a line number) and returns plain
  data out. Nothing user-visible changes in this issue: no component,
  toolbar, hotkey or settings wiring lands here (those are issues #132–#134).
- **Tree derivation** (PRD 012 Req 2, Req 13): an exported function turns the
  section model into the TOC entry tree — every H1–H6 heading, in document
  order, each entry nested under its nearest shallower heading, with skipped
  levels handled (an H1 followed by an H3 nests the H3 under the H1, and an
  H3 with no shallower heading before it is a root). Each entry carries at
  minimum its id, heading text, depth, 1-based heading line, and children.
- Entries carry **positional identity** (PRD 012 Req 3): the id comes from
  `SectionNode.id` (`'1'`, `'1.2'`, …), not from heading text, so two
  headings with identical text are distinct entries. A unit test proves it.
- The synthetic `preamble` node (`depth: 0`, no heading) is **not** a TOC
  entry; content before the first heading produces no row.
- Derivation is from the mdast parse only, never from scraping rendered HTML:
  the module reads `sectionModel.ts` output and does not touch `data-mm-line`
  anchors or any DOM. A unit test with a fenced code block containing `#`
  lines proves those headings do not appear as entries.
- **Collapse-set handling** (PRD 012 Req 4): exported functions cover
  (a) toggling an entry's expand/collapse state, with entries **defaulting to
  expanded** (model the state as the set of *collapsed* ids so the empty set
  means all-expanded); (b) resolving the visible/flattened entry list for a
  given collapse set — an entry inside a collapsed ancestor is not visible,
  and a collapsed entry itself still is; (c) expanding the full ancestor
  chain of a given entry id (the operation PRD 012 Req 7's auto-reveal will
  call), which is a no-op when nothing on the chain is collapsed.
- **Active-section resolution** (PRD 012 Req 7): an exported function takes a
  scroll/position input (a 1-based document line, e.g. the top visible line
  or the cursor line) plus the tree/section model and returns the id of the
  active entry — the deepest heading whose source range contains that line —
  or `null` when the line falls before the first heading. Unit tests cover a
  line on the heading itself, a line inside a nested section's body, and the
  before-first-heading case.
- An **empty document** (or one with no headings) yields an empty entry tree,
  an empty visible list, and a `null` active entry — covered by unit tests;
  no function throws on empty or unknown input (an unknown entry id resolves
  to no-op / `null` rather than an error).
- Unit tests live in `tests/unit/toc-model.test.ts` (the required
  `tocModel.ts` → `toc-model.test.ts` pairing), every test title starts with
  its stable `U<n>:` id taking the next unused numbers (U653 is the current
  highest, so start at U654; numbers are never reused), and `describe` blocks
  name the contract (e.g. `describe('PRD 012 Req 13 — TOC model')`). No
  existing test is weakened, renumbered, deleted, or marked
  `.skip`/`.only`/`.fixme`, and the new tests do not depend on per-file
  isolation (`isolate: false`).
- Module and tests carry citation comments per `.sandcastle/CODING_STANDARDS.md`
  and `docs/COMMENT-FORMAT.md`, in the `PRD 012 Req <n>: <what and why>` form
  that `src/lib/sectionModel.ts` already uses for PRD 011. If any `SPEC<n>`
  citation is added, `npm run map` has been run and the regenerated
  `docs/MAP.md` is committed.
- Iteration during the attempt uses `npm run typecheck` and `npm run test:unit`
  (or `npx vitest run tests/unit/toc-model.test.ts` targeted at the changed
  code). `npm run validate:quick` is run **once**, right before declaring the
  goal met — not after every change, and not as a start-of-attempt baseline
  (baseline with the quick tier only) — and it prints
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #131, naming the
  module and test file, the U-numbers added, and the `validate:quick` result.

## Context

- **PRD:** the issue references `prd/012-table-of-contents.md`, which is
  **not on this branch** — it lives on the unmerged PR #129
  (`prd/issue-85-table-of-contents`). Read it with
  `git show origin/prd/issue-85-table-of-contents:prd/012-table-of-contents.md`.
  Req 13 is this issue; Reqs 2, 3, 4, 7 are the behaviours the model must
  make possible. Do not add the PRD file to this branch.
- **The input:** `src/lib/sectionModel.ts` already does the parse.
  `parseSections(source)` returns `DocumentSections` — `sections`
  (root `SectionNode[]`, already nested under the nearest shallower heading,
  ids positional), `preamble`, `title`, `lineCount`; `flattenSections` and
  `findSection` are there too. `SectionNode` carries `id`, `depth`, `title`,
  `headingLine`, `startLine`, `endLine` (covers descendants), `bodyEndLine`.
  `endLine` is what active-section containment should use. Do not re-parse
  markdown in the new module and do not modify `sectionModel.ts`.
- **Shape to copy:** `src/lib/semanticZoom.ts` is the closest sibling — a
  pure PRD-cited layer built on top of `sectionModel.ts` (see `focusLine`,
  `diveFrom`). `src/lib/folderTree.ts` shows the expansion-set idiom the TOC
  mirrors (`ancestorsOf`, `visibleEntries`), and its tests are in
  `tests/unit/folder-tree.test.ts`.
- **Collapse state is session-only** (PRD 012 non-goal: no new persistence
  file). This module holds no state itself — callers own the collapse set and
  pass it in.
- Commands worth knowing: `npm run typecheck`, `npm run test:unit`,
  `npm run validate:quick` (the gate; the e2e suite is slow and serialized —
  run it once at the end via the gate, not in the inner loop).
