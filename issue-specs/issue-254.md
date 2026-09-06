# Spec: Move the copy-link-to-workspace button next to the workspace name in the top bar (#254)

## Goal

All acceptance criteria in issue-specs/issue-254.md are satisfied for issue #254, with evidence visible in the session: the hosted workspace copy-link control (`copy-link-workspace`) renders in the top bar immediately left of the workspace name (hamburger · link · workspace name · `/` · file name) and nowhere else, its hosted-only gating, label and copied-URL behaviour are unchanged, the file copy-link is untouched, `npm run validate:quick` passes in the implementer's session, and a summary comment from the implementer exists on issue #254.

## Acceptance criteria

- On the hosted build with a workspace bound, the workspace copy-link
  control (testid `copy-link-workspace`) renders inside the top bar
  (`.toolbar` / `src/components/Toolbar.tsx`), positioned between the
  hamburger menu button and the workspace name, so the top bar reads
  left to right: hamburger menu · link icon · workspace name · `/` ·
  file name.
- Exactly one `copy-link-workspace` element exists in the DOM in every
  state — the control no longer rides the corner-control clusters
  (`leftCluster` in `src/App.tsx`, mounted as `.edge-cluster-left` or the
  `FileTabStrip` `leading` slot), and the folder pane's open/closed state
  no longer affects whether or where it shows.
- The remaining left cluster still behaves as before for its other
  members: with the pane closed the reopen chevron + sidebar view switch
  appear as they do today, and with nothing else to show the cluster
  (and its `.edge-cluster-left` / tab-strip leading wrapper) is absent
  rather than rendered empty.
- Behaviour and gating are unchanged: hosted-only (PRD 020 Req 15 — zero
  share DOM on Tauri, the dev shim and the single-file build), tooltip
  and rest accessible name stay "Copy link to workspace" (issue #227),
  the copied text is still the canonical absolute `/<workspace-name>`
  URL read off `window.location` at click time, and the "Link copied"
  confirmation (~2s, `aria-live`, then revert) still comes from the
  shared `CopyLinkButton` primitive — no second copy-link implementation
  is introduced.
- The file copy-link (PRD 020 Req 17, testid `copy-link-file`) keeps its
  current top-right placement, gating and behaviour; the heading
  placements (Req 18) are untouched.
- Styling follows the top bar's existing icon conventions per
  `docs/STYLE-GUIDE.md`: the control stays the `.icon-btn`-based
  `.copy-link` primitive, any new CSS is a token-driven rule scoped to
  the toolbar (no raw colour literals, no literal `font-size` /
  `border-radius` / `box-shadow`, no new one-off button class), and the
  icon's size/spacing sits with the toolbar's other chrome rather than
  looking like a transplanted corner control.
- e2e coverage asserts the new placement: the hosted tests that exercise
  this control (`E407`, `E408` in `tests/e2e/hosted.spec.ts`) are updated
  — not deleted — so at least one of them asserts the control is inside
  the top bar and ordered immediately before the workspace name
  (`docname-workspace`), and E406 in
  `tests/e2e/tabs-and-workspace.spec.ts` still proves the shim renders no
  share DOM at all.
- Touched citation comments still tell the truth: the `PRD 020 Req 16`
  comments in `src/App.tsx` (and any new one in `Toolbar.tsx`) describe
  the top-bar placement rather than the retired top-left cluster. If
  `SPEC<n>` citations or e2e E-numbers change, `docs/MAP.md` is
  regenerated with `npm run map` (never hand-edited).
- Iteration used `npm run typecheck` + `npm run test:unit` (or tests
  targeted at the changed code, e.g.
  `npx playwright test -g 'E407'`) after each change; the full gate
  `npm run validate:quick` was run ONCE, right before declaring the goal
  met — not after every small change and not as a start-of-attempt
  baseline — and prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #254.

## Context

`src/App.tsx` builds `workspaceShare` (grep `copy-link-workspace`, around
the `hostedWorkspace` gate) and today hangs it on `leftCluster`, which
mounts either as `.edge-cluster-left` or as the `FileTabStrip` `leading`
slot. The top bar is `src/components/Toolbar.tsx`: the hamburger button,
then the `.docname` span whose leading `.ws-name` / `.ws-sep` children are
the workspace name and the `/` separator (PRD 009 Req 11). The natural
shape is a new optional `ReactNode` (or equivalent) prop on `Toolbar`
rendered between the menu button and `.docname`, with App.tsx keeping
ownership of the hosted gate and the `getUrl` lambda — the control itself
stays `src/components/CopyLinkButton.tsx`.

The toolbar always renders on hosted (`nativeMenu` is Tauri-only —
`src/platform/hosted.ts` exposes no `setAppMenu`), so the placement is
always available there; it does ride the toolbar's auto-hide behaviour,
which is an accepted consequence of the move. Toolbar CSS lives around
`.toolbar` in `src/styles.css` (`.copy-link` rules are further down);
`docs/STYLE-GUIDE.md`'s Do/Don't list is lint-enforced in the quick tier.
PRD 020's requirement text (`prd/020-shareable-links.md` Req 16) still says
"top-left icon cluster" — this issue supersedes that placement; update the
requirement wording or note the amendment so the PRD and the code agree.
