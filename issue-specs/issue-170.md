# Spec: Preview and edit-pane diagrams draw the persisted width (#170)

## Goal

All acceptance criteria in issue-specs/issue-170.md are satisfied for issue
#170, with evidence visible in the session: a hand-authored ```` ```mermaid
width=500 ```` fence draws at 500 CSS px — aspect preserved, nothing cropped —
in the preview pane (`src/lib/fenceDiagrams.ts`) and in the edit-pane widget
(`src/components/diagramView.ts`); a fence with no width token or an
intolerable one renders at natural size exactly as today with no badge and no
rewrite; reading the width mutates no document and adds no mermaid render pass;
`npm run validate:quick` passes in the implementer's session; and a summary
comment from the implementer exists on issue #170.

## Acceptance criteria

- **PRD 015 Req 4 — the preview draws the width.** A fence whose info string
  carries `width=N` (read with `readFenceWidth` from `src/lib/fenceWidth.ts`,
  landed by #169) draws in the preview graft (`src/lib/fenceDiagrams.ts`) as an
  SVG whose rendered width is N CSS px, with height following the drawing's own
  aspect ratio (mermaid's `viewBox`) — the whole drawing scales down or up,
  nothing is cropped, clipped or letterboxed. An e2e assertion on the SVG's
  measured `boundingBox()`/`clientWidth` is the evidence, not a style-string
  match.
- **PRD 015 Req 4 — the edit-pane widget draws the same width.** With the
  `diagramView` setting on, the same fence draws at N CSS px inside the
  `mm-editor-diagram` widget. No handles, no selection, no click-behaviour
  change: clicking still reveals the fence source at the caret (PRD 013 Req 5),
  and the widget still changes no text, history or dirty state.
- **The info string reaches the preview without widening the sanitize schema.**
  Today it does not: `renderMarkdown` emits ```` ```mermaid width=500 ```` as
  `<pre data-mm-line="3"><code class="hljs language-mermaid">` — the meta is
  dropped, and `fenceLanguage(code.class)` can only ever see the language. Some
  route must carry it, and the `schema` constant in `src/lib/markdown.ts` stays
  byte-identical (PRD 015 Req 12: the sanitize schema does not widen). One route
  that satisfies both, verified while writing this spec: `mdast-util-to-hast`'s
  code handler puts the meta on the hast `<code>` node's `data.meta`, and
  `hast-util-sanitize` `structuredClone`s `data` through — so a small pass
  placed *after* `rehypeSanitize` (where `rehypeHighlight` already sits) can
  stamp the width as an inert data attribute. Whatever route is chosen: the
  stamped value is the already-parsed positive integer (never raw document
  text), the pass is attribute-only, and no new tag name, protocol or
  URL-bearing attribute is introduced anywhere.
- **The anchor coordinate space is untouched.** The rendered plain text of a
  document is byte-identical before and after this change — the stamping is
  attribute-only, the SVG stays inside the host's shadow root (PRD 013 Req 3),
  and E310 (sidecar comments around a mermaid fence) passes unchanged.
- **PRD 015 Req 3 — tolerant, and inert where it should be.** A fence with no
  meta, or with a `width` token the reader rejects (`width=abc`, `width=500px`,
  `width=12.5`, `width=0`, `width=-40`, bare `width`), draws at natural size
  exactly as today: no error badge, no failure state, no rewrite of the fence
  and no console noise. Reading never mutates the document — no buffer write,
  no dirty dot, no autosave is triggered by opening a document that carries
  width tokens. A `height=` token is neither read nor honoured.
- **No extra render pass.** Mermaid runs exactly as often as it does today:
  the width is applied to the SVG that was already rendered (CSS/attribute on
  the drawn output), not by re-invoking the renderer. In the edit pane the
  widget's `eq()` must account for the width so a width change redraws the
  block, while `cachedRender`'s (theme, tag, source) key means that redraw is a
  cache hit — a width change never re-runs mermaid. In the preview, changing
  only the width must not force a fresh `renderSafely` call for a block whose
  source and theme are unchanged.
- **PRD 013 Req 9 is unchanged.** A diagram whose persisted width exceeds the
  pane still scrolls inside its own block (`.doc .mm-diagram { overflow-x:
  auto }` and the edit-pane twin in `src/styles.css`) rather than widening the
  pane or the editor line; no horizontal page scroll appears. A width larger
  than the drawing's natural layout width is still honoured at draw time — the
  natural-width clamp is the drag gesture's (Req 6, issue #171), not the
  reader's.
- **PRD 013 Reqs 10–11 stay as they are.** A fence in the `pending` or `error`
  state is unaffected by a width token: the source/code block holds the space,
  the failure badge reads the same, and `data-mm-diagram` states still cycle
  `pending → done | error`.
- **Unit coverage.** Test titles numbered from **U776** up (re-check
  `grep -rhoE '\bU[0-9]+\b' tests/unit | sed 's/U//' | sort -n | tail -1`
  before writing), `describe` blocks naming the contract (`PRD 015 Req 4`).
  Cover, in the files that already own each module — `tests/unit/fence-diagrams.test.ts`,
  `tests/unit/diagram-spans.test.ts`, and the pipeline pass's own file: the
  drawn host/SVG carries the width for a width-bearing fence; a widthless and a
  malformed-width fence are drawn exactly as before; the span/widget input
  exposes the width and its identity check distinguishes two widths of the same
  source; and the rendered HTML of a width-bearing fence differs from today's
  by the new attribute only (rendered *text* identical). Keep to one test file
  per module per `.sandcastle/CODING_STANDARDS.md`.
- **E2e coverage.** One new desktop test in `tests/e2e/mermaid.spec.ts`
  numbered **E316** (next free — re-check `grep -rhoE '\bE[0-9]{3}\b' tests/e2e
  | sort -u | tail -1`): a document with a `width=N` fence, an unadorned fence
  and a malformed-width fence draws the first at N px in the preview and at N
  px in the edit-pane widget, and the other two at their natural width, with
  the document text unchanged and no dirty dot at any point. Existing E309–E313
  and W17 pass untouched; no existing test is weakened, renumbered or skipped.
- **Nothing else moves.** No selection, no handles, no badge, no drag, no
  double-click reset (those are #171); no new setting, menu item, command or
  platform seam; `src/lib/fenceWidth.ts` needs no new export (if it does, say so
  in the summary comment and keep it pure). Export and print behave exactly as
  today — mermaid fences still export as code, and the export/print tests
  (`tests/unit/export-doc.test.ts`, `tests/e2e/reading-and-export.spec.ts`)
  pass unchanged.
- New and changed code carries a citation comment naming its contract
  (`// PRD 015 Req 4: …`) per `.sandcastle/CODING_STANDARDS.md` and
  `docs/COMMENT-FORMAT.md`. No `SPEC<n>` citation is added or moved, so
  `docs/MAP.md` needs no regeneration — but if one is added or moved, run
  `npm run map` and commit the result (validate:quick diffs it).
- Test economy: iteration used `npm run typecheck` and `npm run test:unit` (or
  a targeted `npx vitest run tests/unit/<file>.test.ts`, and
  `npx playwright test -g 'E316'` while debugging the one e2e) — not the full
  gate after every change, and no full-suite baseline at the start of the
  attempt (baseline with the quick tier only if you need one).
- `npm run validate:quick` has been run ONCE, at the end, in the implementer's
  session and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #170, stating what
  changed (the route the info string takes to the preview, the two draw sites,
  the tests and their numbers), the verification evidence, and anything
  deliberately left out.

## Context

Second of four issues under `prd/015-resizable-mermaid-diagrams.md` (parent
#166); #169 landed the pure `src/lib/fenceWidth.ts` (`readFenceWidth`,
`rewriteFenceWidth`) with no consumer, and this issue is its first consumer.
#171 adds preview click-select and drag-to-persist on top; #172 covers anchors,
parity and the full test matrix — none of that belongs here.

The two draw sites share a painter: `paintDiagramResult` in
`src/lib/fenceDiagrams.ts` fills the host's shadow root (`:host { display:
block } svg { display: block }`) for both the preview graft and the edit-pane
widget, so it is the natural single home for the sizing rule. The preview side
finds blocks by `fenceLanguage(code.class)` — class only, no meta (see the
criterion above). The edit side already has the info string in hand:
`computeDiagramSpans` (`src/lib/diagramSpans.ts:57`) slices the `CodeInfo` node
out of the syntax tree and hands it to `fenceLanguage`; the same slice fed to
`readFenceWidth` is the whole edit-pane story, plus carrying the width on
`DiagramSpan` into `DiagramWidget`.

One gotcha worth knowing before you start: `readFenceWidth` takes a *full* info
string — first token is the language, the rest is meta — but a hast code node's
`data.meta` is the meta **only**, so handing `data.meta` straight in silently
drops its first token. Reconstitute (`lang + ' ' + meta`) or read the tokens
yourself; do not loosen `fenceWidth.ts`'s contract without saying why.

Mermaid's SVG carries a `viewBox` plus its own `width`/`style="max-width:…"`,
so height-follows-aspect comes for free once the width is set and the height
left to compute. Relevant CSS lives in `src/styles.css` under the
`PRD 013: fence diagrams` banner (the `overflow-x: auto` scroll fallback for
both hosts).

Do not read `src/App.tsx` end-to-end — citation-grep into it
(`rg 'renderFenceDiagrams' src`), and use `docs/MAP.md` for spec→file lookups.
Coding rules live in `.sandcastle/CODING_STANDARDS.md`. Next free test numbers
as of this spec: unit **U776**, desktop e2e **E316** (re-check before writing).
