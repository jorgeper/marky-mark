# Spec: Mermaid: preview pane renders ```mermaid fences as diagrams (#160)

## Goal

All acceptance criteria in issue-specs/issue-160.md are satisfied for issue
#160, with evidence visible in the session: a ```mermaid fence draws
automatically as a themed diagram in the rendered-HTML panes with no per-block
affordance, `getDocText()` over the preview root is byte-identical whether a
fence is drawn as a diagram or left as code (the comment-anchor coordinate
space of `src/lib/markdown.ts` is untouched, and its sanitize schema is
unchanged), a fence that fails to render keeps today's highlighted code block
plus an unobtrusive error message while the rest of the document renders, the
block shows the code (or an equal-height placeholder) while the diagram is
still loading, the graft code names no fence language (mermaid stays reachable
only through the #159 registry), `npm run validate:quick` passes in the
implementer's session, and a summary comment from the implementer exists on
issue #160.

## Acceptance criteria

- PRD 013 Req 2: in the preview pane (`data-testid="doc"`), a ```mermaid fence
  renders as its diagram automatically after the rendered HTML is injected —
  no button, toggle, or per-block affordance, the way tables and images
  already just render there. The split-edit reading pane
  (`data-testid="split-preview"`) behaves the same, since it injects the same
  HTML and already gets the same post-injection graft
  (`decorateCodeBlocks(el, …)`, `src/App.tsx:5710`). Fences in other languages
  and fences with no language render exactly as today.
- The drawing pass is a `src/lib/` module in the shape of `src/lib/codeCopy.ts`
  — it takes the live preview root plus injected collaborators (the renderer
  lookup, the theme side, a way to report completion), touches only the DOM it
  is handed, and obeys the `src/lib/` purity rule from
  `.sandcastle/CODING_STANDARDS.md` (no `react`, no `@tauri-apps/*`, no
  `src/components/` imports, no `console.*`). It is idempotent: re-running it
  over an already-decorated tree draws nothing twice.
- PRD 013 Req 1 stays structurally true: the drawing pass finds candidate
  blocks through the seam's `fenceLanguage` / `fenceRendererFor`
  (`src/lib/fenceRenderers.ts`) and contains no mermaid-specific branch —
  registering a second language would need no edit to it. The string
  `'mermaid'` still appears in `src/` only in `src/lib/mermaidRenderer.ts` and
  the one site that calls `registerMermaidRenderer()` (`rg -n "mermaid" src` is
  the evidence). Registration happens once per app session, and the mermaid
  library itself is still reached only through the adapter's dynamic
  `import('mermaid')` on first render — no `import 'mermaid'` at module scope
  anywhere (the packaging guarantees themselves are #161's, not this issue's).
- PRD 013 Req 3, the load-bearing constraint: drawing a diagram does not
  perturb the comment-anchor coordinate space. `getDocText(root)`
  (`src/lib/domtext.ts`) returns byte-identical text with diagrams drawn and
  with the same document left as code — which means the fence's own
  `<pre><code>` text nodes survive, in place and in tree order, and the
  injected SVG contributes **zero** text nodes to the tree walk (mermaid SVGs
  carry `<text>` label nodes, so plain `innerHTML` of the SVG next to the code
  would break this; a shadow-root host, an `<img>` carrying the SVG as a data
  URL, or an equivalent are all fine — pick one and say why in the module
  header). A unit test proves it with a fake renderer whose SVG contains
  `<text>` labels, and an e2e test proves existing sidecar comments in a
  document containing a mermaid fence still resolve to the same targets and
  still highlight.
- PRD 013 Req 4 is not weakened here: the `schema` const and the unified
  pipeline in `src/lib/markdown.ts` are unchanged (the diff over them is
  empty), and the SVG enters only the live preview DOM after injection — never
  the pipeline's HTML string. Export (`src/lib/exportDoc.ts`) and print keep
  emitting mermaid fences as code blocks, per the PRD's non-goal.
- PRD 013 Req 9: the diagram theme follows the app's *active* theme, i.e. the
  resolved theme's `variant` from `src/lib/themes.ts` (a user may sit on a dark
  theme in the light slot), not the OS `prefers-color-scheme` alone. Changing
  the theme redraws the diagrams already on screen with the new side, without
  a document edit or a mode switch. Wide diagrams never overflow the pane
  horizontally — they scale down or scroll inside their own block
  (`src/styles.css`, next to the `.doc .mm-codeblock` rules).
- PRD 013 Req 10: a fence whose source fails to parse or render shows the
  highlighted code block exactly as today, plus a visible, unobtrusive error
  indicator carrying the renderer's message (a `data-testid` so e2e can assert
  it). The failure never blanks the block, never rejects out to the app shell,
  and never stops the rest of the document — a valid fence later in the same
  document still draws.
- PRD 013 Req 11: while a fence is rendering — including the first-use lazy
  load of mermaid — the block shows its code, or a placeholder of equivalent
  height, rather than collapsing; the diagram arriving causes no layout jump
  that leaves the reader's scroll position elsewhere. Async completion is
  guarded against staleness: a render that resolves after the preview has been
  re-injected (a keystroke in split view, a document switch, a semantic-zoom
  return at `zoomLevel` 5) must not paint into the new DOM or throw.
- New behaviour carries a citation comment naming its contract (`// PRD 013
  Req 2: …`, `// PRD 013 Req 3: …`) per `.sandcastle/CODING_STANDARDS.md` and
  `docs/COMMENT-FORMAT.md`. `docs/MAP.md` is regenerated with `npm run map` if
  any `SPEC<n>` citation was added or moved (validate:quick fails on a stale
  map; PRD citations alone do not affect it).
- Unit tests live in `tests/unit/<kebab-case-module>.test.ts`, one file per new
  `src/lib/` module, titles starting at the next free `U<n>` (U735 is the
  highest today, so U736+) with `describe` blocks naming the contract
  (`PRD 013 Req 2`, `PRD 013 Req 3`, …). They cover, through a fake renderer:
  text-space invariance, the success graft, the failure fallback shape,
  the loading state, idempotent re-runs, and theme-side selection. A test that
  mutates the fence registry restores it — the suite runs `isolate: false`
  (`vitest.config.ts`).
- E2e coverage in the desktop-shim suite, titles starting at the next free
  `E<n>` (E308 is the highest today, so E309+), driving the real mermaid
  library through the vite dev server: a document with one valid and one
  invalid mermaid fence shows a diagram for the first and code-plus-error for
  the second in the preview pane, comments in that document still anchor, and
  a theme switch redraws the diagram. The edit pane is out of scope here
  (#162). Setup goes through `tests/e2e/fixtures.ts` / `helpers.ts`; the
  committed e2e count floor in `scripts/validate.mjs` is a minimum, so adding
  tests needs no edit there.
- Iteration used `npm run typecheck` and `npm run test:unit` (or a single
  targeted `npx vitest run <file>` / `npx playwright test -g '<title>'`) — not
  the full suite after every change, and no full-suite baseline at the start of
  the attempt.
- `npm run validate:quick` has been run ONCE, at the end, in the implementer's
  session and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #160 describing where
  the graft lives, how the text-space invariance (Req 3) is achieved, the
  theme/failure/loading behaviour, what deliberately did not change (sanitize
  schema, pipeline HTML, export/print, edit pane), and the verification
  evidence.

## Context

Second of four mermaid issues (#159 seam → **#160 preview** → #161 lazy chunk /
single-file web → #162 edit-pane widgets) under `prd/013-mermaid-support.md`,
parent #56 ("i want the simplest thing for now"). #159 already landed and is on
this branch: `src/lib/fenceRenderers.ts` (registry, `fenceRendererFor`,
`fenceLanguage`, the `FenceRenderResult` success/failure union, the
`{ theme: 'light' | 'dark' }` options) and `src/lib/mermaidRenderer.ts`
(`createMermaidRenderer`, `registerMermaidRenderer`, strict security posture,
lazy `import('mermaid')`, SVG scrub). `mermaid` is already in `package.json`
dependencies. Nothing calls the registry yet — this issue is what makes a
diagram appear.

The graft point is the preview injection effect in `src/App.tsx` (around
`doc.innerHTML = html`, ~line 5534, and its split-view twin, ~line 5697),
right where `decorateCodeBlocks(doc, copyToClipboard)` runs. Read
`src/lib/codeCopy.ts` first: its header states exactly why chrome is grafted
onto the live preview instead of entering the pipeline, and its "the wrapper
contributes no text nodes at all" trick is the same class of property Req 3
needs. `src/lib/domtext.ts` (`getDocText`, `offsetsToRange`, `highlightRange`)
is the coordinate space in question — a `TreeWalker` over `SHOW_TEXT`, which
ignores CSS, so hiding the code block visually keeps its text (good) and any
SVG `<text>` node injected into the same tree would be counted (bad).

Note that the injection effect re-runs on `html`, `mode` and `zoomLevel`
changes, and that the split pane rebuilds on every keystroke — cheap
re-entry and a stale-result guard matter more here than they did for the copy
buttons. The active theme is resolved in the effect at `src/App.tsx:2747`
(`themes.find(t => t.id === wanted)`), and each theme carries `variant:
'light' | 'dark'`.

Grep the citations rather than reading files whole: `rg 'PRD 013' src tests`,
`rg 'SPEC41' src` for the image-widget trust posture. Never read `src/App.tsx`
end-to-end.
