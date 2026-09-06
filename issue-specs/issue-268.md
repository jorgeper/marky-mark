# Spec: Preview: in-document #fragment links don't scroll to their section (#268)

## Goal

All acceptance criteria in issue-specs/issue-268.md are satisfied for issue
#268, with evidence visible in the session: clicking an in-document
`#fragment` link in the rendered preview — full preview and the preview half
of split view alike — smoothly lands that heading in the pane, resolving the
fragment through the SAME GitHub-style slugs `headingAnchors`
(`src/lib/shareLinks.ts`, PRD 020 Req 18) already derives rather than a second
slugifier, with a fragment matching no heading falling back to the existing
PRD 020 Req 19 graceful-miss notice and no click ever navigating or reloading
the page on hosted; `npm run validate:quick` passes in the implementer's
session; and a summary comment from the implementer exists on issue #268.

## Acceptance criteria

**The scroll — the load-bearing behaviour**

- Clicking a link whose href is an in-document fragment (`[Setup](#setup)`, a
  bare `#setup`) in the rendered preview scrolls that pane so the matching
  heading lands at the top of the viewport, the same landing the TOC jump and
  the PRD 020 Req 19 deep link already produce (SPEC16 §4's one preview
  scroll-to-line path, `scrollPreviewToLine` in `src/App.tsx`). Today the
  handler calls `document.getElementById(link.id)`, the pipeline stamps no
  heading `id`, and the click is a silent no-op — that is the bug.
- It works for headings **above** and **below** the click point, and for
  headings deep in a long document (the shape #260 exposed for the copy-link
  affordance), not just near the top.
- It works at every heading level h1–h6, and for a heading nested in a
  container (a blockquote, or indented under a list item) — the `data-mm-hline`
  case issue #226 added.
- Duplicate heading titles resolve to their OWN occurrence: `#setup` lands on
  the first, `#setup-1` on the second, per `headingAnchors`' GitHub-style
  dedupe (the E335 rule for the TOC).
- Fragment resolution goes through `headingAnchors(parseSections(src))` — the
  App's cached `getHeadingAnchors()` — so a hand-written `#fragment`, a copied
  heading share URL (Req 18) and a TOC jump all agree on what a slug means.
  **No second slugifier** is introduced and slugs are never scraped from the
  DOM. Percent-encoded fragments still decode through the existing
  `classifyManagedLink` rule (`#a%20b` → `a b`).
- A fragment matching no heading takes the existing graceful miss (PRD 020
  Req 19): the `fragmentMiss` `'heading'` notice appears, dismissible and
  self-clearing, and the pane stays where it is. It does not scroll to the
  top, does not navigate, and does not throw.

**Both preview surfaces**

- The full preview pane (read mode) and the preview half of split view both
  behave identically. Today the split half is the worse case: its `onDocClick`
  (`src/App.tsx`, the `SplitView` `preview.onDocClick` prop around line 8036)
  has **no** managed-link interception at all — no `preventDefault`, no
  `classifyManagedLink` — so a link click there falls through to the browser.
  Both surfaces route through the one shared handler after this change, so
  they cannot drift.
- Fixing the split half restores the rest of SPEC11 §4 there too: an
  `http(s)` link clicked in the split preview hands off through
  `platform.openExternal` and never navigates the webview; any other href is
  inert. That is a consequence of the shared handler, not a new rule.
- In split view the fragment click lands the heading in the **preview half**
  (`splitDocRef`), not only in the full-preview `docRef` that
  `scrollPreviewToLine` queries today.

**No navigation, on hosted or anywhere**

- On the hosted (cloud) build, clicking an in-document fragment link performs
  no page navigation and no reload: the document, its scroll state elsewhere,
  the open tab set and the unsaved buffer all survive the click.
- Updating the address bar with the `#fragment` is **optional**, not required.
  If the implementation does update it, it uses `history.replaceState`/`pushState`
  or an equivalent that triggers no reload, and it does not clobber a hash the
  build depends on (the dev/desktop shim's `#open=<path>` deep link in
  `src/platform/browser.ts`). The simplest passing implementation leaves the
  address bar alone; either choice must keep every existing test green.

**Parity with the editor hand-off**

- The editor-side hand-off keeps exact parity with the preview through the one
  shared classifier (SPEC43 §11, issue #270): `openEditorLink` in
  `src/App.tsx` — reached by modifier-click on a live-preview link, the
  openLink hotkey, and Link ▸ Open Link — resolves a `#fragment` the same way
  and scrolls the editor to the heading's source line
  (`editorSyncRef.current.scrollToLine`, the E337 path) instead of the current
  `getElementById` no-op.
- E481 in `tests/e2e/smart-edit.spec.ts` currently *asserts and documents* the
  no-op ("the rendered pane carries no element for a plain markdown heading id
  today … the jump resolves to a safe no-op — the deliberate parity
  contract"). It is updated to assert the new landing, keeping its ID and its
  two standing guarantees: the anchor is never handed to `openExternal`, and
  the app never navigates.
- The relative-file parity contract is unchanged: `./other.md`, `mailto:`,
  bare protocols and the empty href stay **inert** in both panes. This issue
  adds no file-opening behaviour to either surface (U1160 keeps passing
  unamended on that half of the rule).

**Scope and non-regression**

- Both builds — desktop (Tauri) and hosted (cloud) — per the issue's
  build-applicability note; the single-file web build inherits the same
  preview behaviour.
- The rendered HTML's **text content** is unchanged, so the comment-anchor
  coordinate space (`getDocText()` over the preview root) stays byte-identical
  and existing sidecars keep anchoring. If the implementation stamps heading
  `id` attributes in `editor/src/lib/markdown.ts` instead of resolving to a
  source line, it must (a) derive them from the same slug rule, (b) account
  for `rehype-sanitize`'s `clobberPrefix` (`user-content-`) rather than
  assuming the id survives verbatim, and (c) leave Export and print output
  valid. Resolving slug → source line → the existing scroll path is the lower
  blast-radius route and is the recommended one.
- Existing preview behaviour on a click that is not a link is untouched:
  `activateFromPreviewClick` and `placeFromPreviewClick` (PRD 023 §5/§18,
  SPEC44 §4.2) still run for non-link targets in both panes.
- No existing `data-testid` is renamed. Every existing unit and e2e test still
  passes; tests are adjusted only where the new contract genuinely requires it
  (E481 above), keeping their IDs — never weakened, skipped, deleted, or
  marked `.only`/`.fixme`.

**Tests**

- A fixture document exercises the shape the issue asks for: fragment links
  pointing at headings **above** and **below** the link, at least one heading
  far down a long document, a duplicate-title pair reached by `#x` and `#x-1`,
  and one fragment that matches nothing. It may be a new file under
  `fixtures/` or a document written through the e2e fs helper — whichever the
  suite it lands in already uses.
- New e2e coverage proves, at minimum: (1) a fragment click in the full
  preview lands a heading below the click point; (2) a fragment click lands a
  heading far down a long document; (3) the same works in the preview half of
  split view; (4) an unmatched fragment shows the Req 19 miss notice and does
  not move the pane; (5) no navigation — `page.url()` keeps its path (and, if
  the address bar is updated, only its hash changes) and no reload occurs.
  Assertions compare real scroll geometry (the heading's box against the
  scroller's, the E335/E337 pattern), never merely that a click happened.
- Any new pure logic lands in a `src/lib/` module (no React, no platform
  imports) with unit tests in the matching `tests/unit/<kebab-case>.test.ts` —
  e.g. an anchor-resolution helper covered against duplicate slugs, an
  unmatched slug, and a percent-encoded fragment.
- New IDs start above the current high-water marks: **E509** for desktop e2e,
  **U1206** for unit, **W19** for web e2e.

**Repo hygiene and verification**

- Every behavioural change carries a citation comment in the house format
  (`.sandcastle/CODING_STANDARDS.md`) naming the contract it implements — here
  `// SPEC11 §4 (issue #268): …` for the managed-link scroll and PRD 020
  Req 18/19 for the slug and miss reuse.
- Any CSS touched satisfies the style lint in `scripts/validate.mjs` and
  `docs/STYLE-GUIDE.md` (scale tokens for font-size / border-radius /
  box-shadow, no raw colour literals in chrome rules, no bare descendant
  element selectors, `ui/` primitives for buttons).
- `docs/MAP.md` is regenerated with `npm run map` only if a `SPEC<n>` citation
  set changed; the e2e count in `scripts/validate.mjs` is a floor, so added
  tests need no edit there.
- Iteration used `npm run typecheck` + `npm run test:unit` (plus targeted
  `npx playwright test -g '<title>'` runs for the tests being touched). The
  full gate was **not** run as a start-of-attempt baseline and not after every
  change — baseline with the quick pair only.
- `npm run validate:quick` has been run ONCE, at the end, in the implementer's
  session, and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #268, naming how the
  fragment now resolves, what changed in the split preview half, and the
  validate:quick evidence.

## Context

SPEC11 §4.1 already promises this ("In-document fragment anchors scroll
locally") — it was never actually wired. The full preview's click handler
(`src/App.tsx` around line 7960, `data-testid="doc"`) does
`e.preventDefault()`, classifies the href through `classifyManagedLink`
(`src/lib/managedLinks.ts`, 30 lines, already correct and unit-tested as
U1160), and for `kind: 'anchor'` calls
`document.getElementById(link.id)?.scrollIntoView(...)`. The markdown pipeline
(`editor/src/lib/markdown.ts`) stamps `data-mm-line` and `data-mm-hline` on
headings but **no `id`**, so that lookup is always null — a silent no-op. The
identical call sits in `openEditorLink` (`src/App.tsx:917`).

The machinery to fix it is all present. `getHeadingAnchors()`
(`src/App.tsx` ~4155) caches `headingAnchors(parseSections(buffer))` from
`src/lib/shareLinks.ts` — 1-based source line + deduped GitHub-style slug per
heading. `scrollPreviewToLine(line)` (`src/App.tsx:4139`, SPEC16 §4) finds
`[data-mm-line="…"], [data-mm-hline="…"]` and puts it at the viewport top,
returning false while the line has not rendered. `landOnFragment`
(`src/App.tsx` ~4202) already does exactly this composition for a *boot*
fragment, with the `showFragmentMiss('heading')` fallback and a per-frame
retry — read it first; the click path is a simpler version of it that can
reuse the same pieces rather than duplicating them. Note
`scrollPreviewToLine` only queries `docRef`, so the split preview half
(`splitDocRef`) needs the equivalent.

The split preview's click prop is at `src/App.tsx` ~8036 and today only calls
`activateFromPreviewClick` / `placeFromPreviewClick` — no link handling at
all. Hoisting the full preview's link branch into one shared callback used by
both `onClick` props is the natural shape.

Sequencing note from the issue owner: #268 was to follow #260 (the copy-link
anchor/line drift on deep headings), which is now **closed** — that fix has
landed, so the `headingAnchors`/line machinery this issue leans on is the
fixed version.

Related reading: `docs/specs/SPEC11.md` §4 (managed links),
`docs/specs/SPEC43.md` §11 (the shared classifier, issue #270),
`prd/020-shareable-links.md` Reqs 18–19, `tests/unit/managed-links.test.ts`,
`tests/e2e/smart-edit.spec.ts` E481, `tests/e2e/toc.spec.ts` E335/E337 (the
scroll-geometry assertion patterns), and `tests/e2e/split-view.spec.ts` for
split-mode setup helpers.
