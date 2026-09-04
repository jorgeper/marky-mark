# Spec: file vs workspace link tooltip (#227)

## Goal

All acceptance criteria in issue-specs/issue-227.md are satisfied for issue #227, with evidence visible in the session: the workspace, file, and heading copy-link controls each carry a placement-specific tooltip and rest accessible name ("Copy link to workspace" / "Copy link to file" / "Copy link to heading"), `npm run validate:quick` passes in the implementer's session, and a summary comment from the implementer exists on issue #227.

## Acceptance criteria

- The workspace copy-link control (testid `copy-link-workspace`, top-left
  cluster) has `title` and rest `aria-label` **"Copy link to workspace"**.
- The file copy-link control (testid `copy-link-file`, top-right cluster)
  has `title` and rest `aria-label` **"Copy link to file"**.
- Every heading copy-link button — both placements, the preview graft and
  the editor gutter marker, both built by `createHeadingLinkButton` in
  `src/lib/headingLinks.ts` — has `title` and rest `aria-label`
  **"Copy link to heading"**. (The issue says "header"; "heading" is the
  established term across PRD 020 and the codebase, and satisfies the ask:
  the hover text names the target explicitly.)
- The confirmation contract is unchanged: on a landed copy the control
  shows "Link copied", the `aria-label` swaps to "Link copied", and after
  ~2s it reverts to that placement's specific label (not a shared generic
  one).
- Unit tests assert the three distinct labels (the existing label
  assertions in `tests/unit/share-links.test.ts` and
  `tests/unit/heading-links.test.ts` are updated, not deleted), and the
  `title`/`aria-label` assertions in `tests/e2e/hosted.spec.ts` are updated
  to the placement-specific labels.
- Iteration used `npm run typecheck` + `npm run test:unit` (or tests
  targeted at the changed code) after each change; the full gate
  `npm run validate:quick` was run ONCE, right before declaring the goal
  met — not after every small change and not as a start-of-attempt
  baseline — and prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #227.

## Context

One constant feeds all three placements today: `COPY_LINK_LABEL = 'Copy
link'` in `src/lib/shareLinks.ts` (PRD 020 Req 14's "one primitive"). It is
consumed by `src/components/CopyLinkButton.tsx` (the React control App.tsx
mounts for the workspace and file placements — grep `copy-link-workspace` /
`copy-link-file` in `src/App.tsx`) and by `createHeadingLinkButton` in
`src/lib/headingLinks.ts` (the plain-DOM factory both heading placements
share; the gutter caller is in `src/components/Editor.tsx`). The natural
shape is per-placement labels (e.g. a label prop/option, or three exported
constants) while `LINK_COPIED_LABEL` stays shared. PRD 020 Req 14 wrote the
tooltip as a uniform "Copy link"; this issue supersedes that label — keep
the rest of Req 14's contract (icon, click-to-copy, ~2s confirmation, live
region) intact, and update the SPEC/PRD citation comments you touch so they
still tell the truth. The placements are hosted-only for workspace/file;
`tests/e2e/hosted.spec.ts` is where the e2e label assertions live.
