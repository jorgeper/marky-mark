# Spec: Mermaid: lazy desktop chunk + inlined single-file web build (#161)

## Goal

All acceptance criteria in issue-specs/issue-161.md are satisfied for issue
#161, with evidence visible in the session: a freshly built `dist/` keeps
mermaid's weight out of the entry chunk and out of `dist/index.html`'s load
set, so a session that never meets a mermaid fence never fetches it;
`dist-web/` is still exactly one self-contained `index.html` with mermaid
inlined into it and a mermaid fence actually draws on that built page under
`connect-src 'none'`; both properties are locked by fast-tier guards rather
than by the Rust-gated full gate; the full gate's static bundle scan passes
over both mermaid-carrying bundles without widening its audited `fetch(`
allowlist; `npm run validate:quick` passes in the implementer's session; and a
summary comment from the implementer exists on issue #161.

## Acceptance criteria

- PRD 013 Req 7, desktop lazy chunk, proven over a freshly built `dist/`:
  mermaid's own code lives in chunks separate from the entry chunk
  (`dist/assets/index-*.js`); the entry chunk carries no mermaid library code
  (its only mermaid mention is the dynamic-import site rollup rewrote), and
  `dist/index.html` references only the entry script plus the stylesheet — no
  `<link rel="modulepreload">` or `<script src>` pointing at a mermaid chunk,
  so startup neither downloads nor evaluates it. Today's build already has
  this shape (`import('mermaid')` in `src/lib/mermaidRenderer.ts` is the only
  import site); this issue is what makes it a checked property instead of an
  accident, so if no source change is needed, say so and land the guard.
- That desktop property is enforced by a test that runs in the fast tier
  (`npm run test:unit`, and therefore `npm run validate:quick`), in the shape
  of `tests/unit/static-web-no-llm.test.ts`: it rebuilds the artifact in
  `beforeAll` when it is missing or older than its inputs rather than
  asserting against a stale or absent `dist/`, it first proves the file it
  read is a real Marky Mark bundle, and it derives its needles from the code
  that owns them where it can. New unit tests are numbered from U746 up.
- PRD 013 Req 7's runtime half stays true and stays covered: mermaid is
  reached only through the adapter's `import('mermaid')` on first render —
  no `import 'mermaid'` at module scope anywhere in `src/` (`rg -n
  "from 'mermaid'|import\('mermaid'\)" src` is the evidence), and U731
  (`tests/unit/mermaid-renderer.test.ts`) still passes unchanged.
- PRD 013 Req 8, web parity: after `npm run build:web`, `dist-web/` contains
  exactly `index.html`, that file references no external script or stylesheet,
  and mermaid's code is inlined *into* it — no async chunk left un-inlined,
  which under the web CSP (`connect-src 'none'`, SPEC11 §3.2, `WEB_CSP` in
  `vite.web.config.ts`) could never be fetched and would fail the feature
  silently. A fast-tier guard asserts the inlining, alongside the desktop one.
- Web parity is also proven end-to-end against the built artifact: a new
  `W17` in `tests/e2e/web.spec.ts` (run by `npm run test:e2e:web`, which
  serves `dist-web/index.html`) opens a document containing a valid mermaid
  fence and asserts the diagram is drawn — the same success shape E309
  asserts on desktop — with zero network requests beyond the initial page
  load, in the style W4/W5 already use.
- The full gate's static bundle scan (`scripts/validate.mjs`, "static bundle
  scan (network call sites)") passes over both freshly built,
  mermaid-carrying bundles. Note it does not pass today: mermaid pulls in
  katex, whose *parser method* is named `fetch`, so `\bfetch\s*\(` matches 27
  member calls plus one method definition per bundle and the count comes out
  62 against an allowlist of 6. Resolve that without weakening SPEC11 §6.6:
  the allowlist stays the count of real same-origin `fetch` wrappers that
  ship (3 sites × 2 bundles = 6, the audit in the comment above
  `FETCH_ALLOWLIST` stays accurate), a `foo.fetch(...)` member call or a
  `fetch(){…}` method definition is not counted as a network call site, and
  the scan still fails when a genuinely new call site ships — not by bumping
  the number until mermaid fits under it. Whatever discrimination the scan
  gains is itself unit-tested, so its sensitivity is checked in the fast tier
  rather than asserted in a comment.
- The audit behind that number is stated and true for mermaid: no mermaid
  chunk in either bundle contains a real network call site, and none contains
  `XMLHttpRequest(`, `new WebSocket`, `sendBeacon`, or `new EventSource` (the
  scan's `FORBIDDEN` list). Mermaid renders offline, per PRD 013 Req 12.
- `npm run validate` cannot complete in this environment — its `cargo check`
  step runs before the single-file check and bundle scan, and `cargo` is not
  on PATH. So the evidence for the two criteria above is: `npm run build` and
  `npm run build:web` succeed, and the single-file check and bundle-scan
  logic are shown passing over those artifacts (running the scan directly is
  fine) — plus the fast-tier guards, which are what keeps the property honest
  for anyone without Rust. Say plainly in the summary comment which parts of
  the full gate were and were not run.
- New or changed behaviour in `src/` and `tests/` carries a citation comment
  naming its contract (`docs/COMMENT-FORMAT.md`,
  `.sandcastle/CODING_STANDARDS.md`); build-config changes in
  `vite.config.ts` / `vite.web.config.ts` say *why* in a comment, as the
  existing `stubTauriPlatform` / `stubWebLlmProviders` plugins do. If SPEC
  citations in `src/` or `tests/e2e/` change, `docs/MAP.md` is regenerated
  with `npm run map` and committed — validate checks its freshness in the
  quick tier too.
- Nothing already shipped regresses: `src/lib/markdown.ts`'s pipeline and
  sanitize schema stay untouched, the preview graft
  (`src/lib/fenceDiagrams.ts`) and adapter (`src/lib/mermaidRenderer.ts`)
  keep their current behaviour, and the desktop-shim mermaid suite
  (E309–E311) still passes.
- Test economy: iterate with `npm run typecheck` and `npm run test:unit` (or
  a targeted `npx playwright test -g '<title>'` when debugging one e2e), and
  run the full quick gate `npm run validate:quick` ONCE, right before
  declaring the goal met — not after every change, and not as a baseline at
  the start. Baseline with the quick tier only if you need one.
- `npm run validate:quick` has been run in the implementer's session and
  printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #161, stating what
  changed, the evidence above (bundle shapes, the scan result, which gate
  steps ran), and anything left out.

## Context

The feature already works: #159 landed the fence-renderer seam, #160 the
preview graft. `src/lib/mermaidRenderer.ts` holds the only `import('mermaid')`
in the app; `src/lib/fenceDiagrams.ts` grafts diagrams onto the live preview
DOM; `src/App.tsx:209` registers the adapter. This issue is packaging only —
no user-visible behaviour change is expected.

Measured state of the tree before you start (re-measure; do not trust these
numbers blindly): `npm run build` already emits mermaid as ~80 separate
chunks (`mermaid.core-*.js` ~683 kB, `cytoscape.esm-*.js` ~444 kB,
`katex-*.js` ~261 kB, per-diagram chunks) with the entry chunk at ~949 kB and
`dist/index.html` referencing only that entry plus the CSS.
`npm run build:web` produces one 5.0 MB `dist-web/index.html` —
`vite-plugin-singlefile` inlines dynamic chunks, so mermaid is already inside
it and the single-file check passes. The one thing that is actually broken is
the bundle scan's `fetch(` count (62 vs 6), explained in the criteria above.

The desktop CSP (`src-tauri/tauri.conf.json`, `script-src 'self'`) allows
same-origin chunk loads, so lazy chunks are fine there; the web CSP is the
strict one. `scripts/validate.mjs` lines ~265–275 hold the step list (quick =
first three steps + the pre-steps), ~310 the single-file check, ~330 the
bundle scan. `tests/unit/static-web-no-llm.test.ts` (U556–U558) is the model
for a fast-tier guard that reads a built artifact. Next free numbers: unit
U746+, web e2e W17.
