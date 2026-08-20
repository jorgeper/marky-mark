# Spec: Mermaid: fence-renderer seam in src/lib + mermaid renderer registration (internal, no UI) (#159)

## Goal

All acceptance criteria in issue-specs/issue-159.md are satisfied for issue
#159, with evidence visible in the session: a pure `src/lib/` fence-renderer
registry exists with mermaid as its only registration behind an async,
never-throwing renderer contract, the sanitize schema in `src/lib/markdown.ts`
is unchanged and no user-visible rendering moved (unregistered fences still
render as today's rehype-highlight code blocks), mermaid runs at its strictest
security posture with unit tests covering registry lookup, fence detection and
the error-fallback shape, `npm run validate:quick` passes in the implementer's
session, and a summary comment from the implementer exists on issue #159.

## Acceptance criteria

- A fence-renderer registry exists as a pure `src/lib/` module (e.g.
  `src/lib/fenceRenderers.ts`) exposing three things: registration of a
  renderer under a fence language tag, lookup by tag (normalized — trimmed,
  case-insensitive, so ```Mermaid and ```mermaid resolve alike) returning the
  renderer or nothing, and a fence-language reader that turns what the
  consumers actually hold (an mdast/hast code node's `lang`/info string and a
  `class="language-x"` value) into that normalized tag. It obeys the
  `src/lib/` purity rule from `.sandcastle/CODING_STANDARDS.md`: no `react`,
  no `@tauri-apps/*`, no imports from `src/components/`.
- Importing the seam does nothing: no mermaid load, no timer, no listener, no
  DOM touch, no network — the `src/lib/llmSeam.ts` "importing this module does
  nothing" property (PRD 011 Req 16), restated for this seam. Work starts only
  when a caller invokes a renderer.
- The renderer contract is asynchronous and failure-typed: a renderer is
  `(source, options) => Promise<Result>` where `Result` discriminates success
  (the rendered SVG markup) from failure (a human-readable message), and a
  renderer never rejects or throws for bad diagram source — malformed input
  resolves to the failure variant carrying the underlying message, so a
  consumer can keep showing the code block. The async entry point is what lets
  #161 load mermaid lazily; do not make it synchronous.
- Extensibility is structural, not documented-by-comment: a unit test registers
  a second, fake language against the registry and retrieves it through the
  same lookup with no change to any consuming-pipeline code, and the string
  `'mermaid'` appears in `src/` only in the mermaid adapter and its
  registration site — not in the registry module, not in any pipeline or
  component code (`rg -n "mermaid" src` is the evidence).
- Nothing user-visible changes in this issue. `src/lib/markdown.ts` keeps its
  unified pipeline and its sanitize `schema` byte-for-byte as-is (PRD 013
  Req 4 — the diff over that file's `schema` const is empty), neither the
  preview pipeline nor the edit pane consults the registry yet, and a
  ```mermaid fence still renders as today's rehype-highlight code block in
  both panes. The existing desktop-shim e2e suite passes unchanged and no new
  e2e test is added here (preview is #160, lazy chunk / web build is #161,
  edit-pane widgets are #162).
- A mermaid renderer adapter (e.g. `src/lib/mermaidRenderer.ts`) implements the
  contract and is mermaid's v1 registration. It loads mermaid through a dynamic
  `import('mermaid')` performed on the first render call — never at module
  scope — behind an injectable loader so unit tests exercise the adapter
  without pulling the real library into the vitest run.
- `mermaid` is added to `package.json` `dependencies` with the lockfile
  updated, and the regenerated `THIRD-PARTY-NOTICES.md` from `npm run licenses`
  is committed in the same diff (the dependency rule in
  `.sandcastle/CODING_STANDARDS.md`; mermaid is MIT, which the allowlist guard
  accepts).
- PRD 013 Req 4's security posture is enforced in the adapter and asserted by
  unit tests: mermaid is initialized with `startOnLoad: false` and its
  strictest security level (`securityLevel: 'strict'` at minimum — never
  `'loose'`/`'antiscript'`, HTML labels off), and the SVG the adapter returns
  carries no `<script>`, no external resource reference (`http://`, `https://`,
  protocol-relative `//`), and no externally clickable link — given a crafted
  SVG string containing those, the adapter's output has them removed or
  neutralized. The adapter performs no network access of its own.
- The seam module's header comment states the contract in prose: injection is a
  **post-sanitize** DOM enhancement, equivalent in trust posture to the
  existing image widgets (`src/components/imageView.ts`, SPEC41), which is why
  the sanitize schema does not widen; and diagram rendering must not perturb
  the comment-anchor coordinate space that `src/lib/markdown.ts` defines
  (PRD 013 Req 3), the same reason `src/lib/codeCopy.ts` grafts its button onto
  the live preview instead of into the pipeline.
- Unit tests live in `tests/unit/<kebab-case-module>.test.ts`, one file per new
  `src/lib/` module, titles starting with the next free `U<n>` numbers (U722 is
  the highest in `tests/unit/` today) and `describe` blocks naming the contract
  (`PRD 013 Req 1`, `PRD 013 Req 4`). They cover: lookup hit / miss /
  normalization, fence-language detection from both an info string and a
  `language-*` class, the error-fallback result shape, second-language
  registration, and the mermaid adapter's init config and SVG scrub through the
  injected loader. A test that mutates the registry restores it — the suite
  runs `isolate: false` (`vitest.config.ts`), so leaked registrations would
  poison other files.
- New behaviour carries a citation comment naming its contract (`// PRD 013
  Req 1: …`, `// PRD 013 Req 4: …`) per `.sandcastle/CODING_STANDARDS.md` and
  `docs/COMMENT-FORMAT.md`, and `docs/MAP.md` is regenerated with
  `npm run map` if any `SPEC<n>` citation was added or moved (validate:quick
  fails on a stale map).
- Iteration used `npm run typecheck` and `npm run test:unit` (or a single
  targeted `npx vitest run <file>` / `npx playwright test -g '<title>'`) — not
  the full suite after every change, and no full-suite baseline at the start of
  the attempt.
- `npm run validate:quick` has been run ONCE, at the end, in the implementer's
  session and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #159 describing the
  seam's shape (the renderer contract and how a second language registers), the
  mermaid adapter's security posture, what deliberately did *not* change
  (sanitize schema, preview pipeline, edit pane), and the verification evidence.

## Context

This is the first of four mermaid issues (#159 seam → #160 preview → #161 lazy
chunk / single-file web → #162 edit-pane widgets) under `prd/013-mermaid-support.md`
and parent #56 ("i want the simplest thing for now"). It lands groundwork only:
no diagram is drawn anywhere in the app when it is done.

Precedents worth reading before writing code. `src/lib/llmSeam.ts` is this
repo's model of a seam module — types and a dispatch entry point, no I/O, an
explicit "importing this does nothing" guarantee — and `src/lib/llmProviders.ts`
shows the implementations-behind-it half. `src/components/imageView.ts` (SPEC41)
is the trust posture Req 4 points at: widgets injected as pure decoration after
the sanitized HTML exists. `src/lib/codeCopy.ts` (issue #122) documents why
chrome is grafted onto the preview DOM rather than added to the pipeline —
anchor offsets are computed over the rendered plain text.

`src/lib/markdown.ts` holds the pipeline (`remark-parse → gfm → remark-rehype →
stampSourceLines/stampImageSpans/blockRemoteImages → rehype-sanitize(schema) →
rehype-highlight → rehype-stringify`) and the `schema` const that must not move.
Note `rehypeHighlight` runs with `{ detect: false }`, so an unregistered fence
tag is emitted as `<pre><code class="language-<tag>">` — that class is one of
the two inputs your fence-language reader should accept.

Newer work in this repo cites PRDs (`PRD 013 Req n`) rather than minting a new
`SPEC<n>` file; `src/lib/tocModel.ts` is the recent example. The full-gate-only
bundle scan (`FETCH_ALLOWLIST` in `scripts/validate.mjs`) is not in scope here —
nothing in `src/` imports the adapter yet, so mermaid should not reach the
shipped bundle at all; re-pinning anything there belongs to #161.
