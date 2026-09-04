# Spec: sharing link bugs (#226)

## Goal

All acceptance criteria in issue-specs/issue-226.md are satisfied for issue #226, with evidence visible in the session: the root cause of headings missing the copy-link icon (reported at the bottom of a document) is identified and stated in the implementer's issue comment; every heading rendered as `h1`–`h6` in the hosted preview of an addressed document carries the PRD 020 Req 18 copy-link affordance, demonstrated by at least one regression test that fails on the pre-fix code; `npm run validate:quick` passes in the implementer's session; and a summary comment from the implementer exists on issue #226.

## Acceptance criteria

- The root cause is diagnosed and named. The reporter's file is not available, so
  the diagnosis must come from a constructed repro: a markdown fixture (or test
  document) in which one or more headings render in the preview as `h1`–`h6`
  but do NOT receive the `.mm-heading-link` button (and/or the editor gutter
  marker), matching the report "headers at the bottom of the file don't get the
  link icon". Candidate mechanisms to probe (not exhaustive — follow the
  evidence): headings that are not direct children of the mdast root (inside a
  blockquote or list — `stampSourceLines` in `src/lib/markdown.ts` stamps
  `data-mm-line` only on root-level children, and `decorateHeadingLinks` skips
  unstamped headings); setext headings; headings whose line in the rendered
  stamp does not exactly match the section-model `headingLine` that
  `headingUrlForLine` (src/App.tsx) looks up, which suppresses the gutter
  marker; headings after raw HTML or unusual blocks lacking mdast position
  data; a document with no trailing newline; late re-renders (fence diagrams /
  split pane rebuild) clobbering already-grafted buttons.
- The bug is fixed at its root cause: for the diagnosed class of documents,
  every heading rendered in the hosted preview of a document with an address
  (`platform.kind === 'hosted'` && `docPath` — the existing Req 15 gate, which
  must be preserved, not widened) gets the copy-link button, including headings
  at the very end of the document, and clicking it copies a `#<slug>` URL that
  lands correctly via the Req 19 hash-landing path. The editor gutter placement
  (`src/components/Editor.tsx`) shows the marker for the same headings.
- At least one new unit test (in `tests/unit/heading-links.test.ts`,
  `tests/unit/share-links.test.ts`, or a related suite, using the repo's
  `U<n>` numbering without colliding with existing numbers) reproduces the
  pre-fix miss and passes with the fix. If the root cause is only observable
  through the full preview pipeline, an e2e regression test (numbered `E<n>`,
  no collisions) in `tests/e2e/` covers it instead of or in addition to the
  unit test.
- Existing behaviour holds: `getDocText()` byte-identity over the preview root
  (no text nodes contributed by the buttons) and the hosted-only gating are
  unchanged; no existing tests are deleted or weakened to make the fix pass.
- Iteration used `npm run typecheck` and `npm run test:unit` (or tests
  targeted at the changed code, e.g. `npx playwright test -g '<title>'` for a
  single e2e); the full gate `npm run validate:quick` was run ONCE, right
  before declaring the goal met — not after every small change and not as a
  full-suite baseline — and printed `QUICK VALIDATION: ALL PASSED` in the
  implementer's session.
- A summary comment from the implementer exists on issue #226, stating the
  root cause found, the fix, and the verification evidence.

## Context

The affordance shipped in issue #223 (PRD 020 Reqs 18–19; see
`prd/020-shareable-links.md` and commits `0f1eaad` / `ab68884`). The moving
parts: `src/lib/headingLinks.ts` grafts the button onto every rendered heading
that carries a `data-mm-line` stamp; `src/lib/markdown.ts`
(`stampSourceLines`) stamps only direct children of the hast root;
`src/lib/shareLinks.ts` (`headingAnchors`) derives slugs from
`parseSections` (`src/lib/sectionModel.ts`), which reads only root-level
mdast headings; `src/App.tsx` (~line 4045–4075) wires `headingUrlForLine` by
exact line match and calls `decorateHeadingLinks` at two sites (~5992 preview,
~6154 split pane); `src/components/Editor.tsx` gates its gutter marker on a
resolvable slug URL. A heading missing the *preview* icon means a missing/
invalid `data-mm-line` stamp or the graft never ran on that DOM; a missing
*gutter* icon means `headingUrlForLine` returned null. Grep `SPEC` citations
and `docs/MAP.md` for orientation; do not read `App.tsx` whole.
