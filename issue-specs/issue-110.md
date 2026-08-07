# Spec: Semantic zoom core model: section tree, level mapping, excerpt fallback, cache keys, cost math (#110)

## Goal

All acceptance criteria in issue-specs/issue-110.md are satisfied for issue #110,
with evidence visible in the session: `src/lib/` carries pure, unit-tested
functions for the source-level section tree (parsed from the markdown source with
the repo's existing remark parser, never scraped from rendered HTML), the L1–L5
level-to-content mapping of PRD 011 Req 17, the deterministic excerpt fallback,
summary cache keying plus invalidation, and token/cost estimation — no network,
no DOM, and nothing user-visible wired up — while the rendered line anchors and
their consumers (scroll sync, heading palette, comment anchoring) behave at L5
exactly as before; `npm run validate:quick` has been run once at the end and
passed, and a summary comment from the implementer exists on issue #110.

## Acceptance criteria

- **Section model (Req 24).** A new pure module in `src/lib/` (suggested
  `sectionModel.ts`; an adjacent name is fine) turns markdown source text into an
  ordered tree of sections. Each node carries at least: heading depth (1–6),
  heading text, the heading's source line, the section's source line range
  (1-based, inclusive, covering heading + body through the line before the next
  sibling-or-shallower heading), the body text, its children, and a stable
  within-document id/path that later siblings can key on. The tree is derived
  from the mdast the repo already parses with `remark-parse` (+ `remark-gfm`,
  `remark-frontmatter`) — no HTML parsing, no `DOMParser`, no `querySelectorAll`.
- **Section model edge cases are pinned by tests**, not assumed: an empty
  document; a document with no headings at all; preamble content before the first
  heading; skipped depths (`#` → `###`); two sections with identical heading text
  (their ids stay distinct); setext (`===` / `---` underline) headings; `#` lines
  inside fenced code blocks, which are *not* headings; YAML frontmatter excluded
  from every section body; and a final section that runs to end of document.
- **Nothing regresses at L5 (Req 24, second clause).** The rendered-HTML source
  anchors (`stampSourceLines` / `data-mm-line` in `src/lib/markdown.ts`) and their
  consumers — `src/lib/scrollSync.ts`, `src/lib/anchoring.ts`, the `⌘K` heading
  palette in `src/App.tsx` — keep their current behaviour; the section model is
  additive. If any shared parsing is factored out, the rendered HTML for the
  repo's fixtures is unchanged and the existing unit and e2e coverage passes
  untouched.
- **Level-to-content mapping (Req 17, Req 34).** A pure function takes (section
  tree, level 1–5) and returns an ordered view model saying what that level shows:
  - **L5** — the full document (a marker that the source is shown verbatim, not a
    re-serialization of it).
  - **L4** — every heading kept, each with a per-section summary slot.
  - **L3** — headings to depth 2 kept; each deeper section's summary slot folded
    into its nearest kept ancestor, with the folded descendants listed on that
    ancestor's entry so nothing is silently dropped.
  - **L2** — depth-1 headings only, one summary slot each.
  - **L1** — the document title (first depth-1 heading, falling back to a
    caller-supplied title, since the module reads no filesystem) plus a single
    whole-document summary slot.

  Levels outside 1–5 clamp rather than throw, and a document with no headings
  still yields a usable entry at every level.
- **Excerpt fallback (Req 22, Req 34).** A pure, deterministic function turns a
  section body into its excerpt: opening sentence(s) or first lines, truncated to
  a bounded length with an explicit ellipsis. Same input always yields the same
  output — no `Date`, no `Math.random`, no locale-dependent formatting. Markdown
  noise is handled (list and blockquote markers stripped, emphasis unwrapped,
  links reduced to their text, code fences and tables skipped rather than emitted
  raw); a body with nothing quotable yields a stable placeholder rather than an
  empty string; the result is tagged as an excerpt (not a summary) so the view in
  #117 can label it honestly.
- **Cache keying and invalidation (Req 28, Req 34).** A pure function produces a
  stable key from a hash of the section's content plus everything else that
  changes the answer: at least the requested summary shape/level, the provider id,
  the model id, and a prompt/format version constant. Tests pin the properties:
  identical content yields an identical key across runs and process restarts;
  editing one section changes that section's key and no other; moving an unchanged
  section elsewhere in the document does not change its key; and changing model,
  provider, level, or prompt version does change it. A companion helper answers,
  given a previous and a current section list, which keys remain valid and which
  are stale. Hashing is in-repo arithmetic (FNV-1a as in
  `sessionKeyForWorkspaceFile`, `src/lib/workspace.ts:295`) — no new dependency,
  no crypto/network call.
- **Cost math (Req 32, Req 33, Req 34).** Pure functions cover: token estimation
  from text (documented heuristic, always surfaced as an estimate); job estimation
  for a level — how many sections would actually be summarized given a set of
  already-cached keys, and the estimated input/output tokens and cost for a
  supplied per-million input/output price; and measured cost from provider-returned
  usage. When usage data is absent the function returns an explicit *unknown*
  rather than `0` or an invented number (Req 32). Prices are parameters: the
  curated per-provider table and its "as of <date>" caveat belong to #119, not
  here.
- **Purity is pinned by a test, not by convention.** A unit test scans the new
  modules and fails if they import React, `src/platform/*` or `src/components/*`,
  or reference `document` / `window` / `fetch` / `XMLHttpRequest` / `Date.now` /
  `Math.random` (precedent: the file-scanning guard tests already in
  `tests/unit/`). The unit suite runs under vitest's `environment: 'node'`
  (`vitest.config.ts`), so a DOM slip fails there too.
- **Nothing user-visible ships and no dependency is added.** No new UI, menu item,
  command, hotkey, settings key, provider call, or cache store lands in this issue
  — those are #111, #115, #116, #117, #119. The exported types and functions are
  shaped for those consumers (they are the reason this module exists), and
  `package.json` gains no runtime dependency.
- **Ids and citations.** Every new test carries the next unused stable `U<n>` id
  (the unit suite's highest today is U479); numbers are never reused or
  renumbered, and no existing test is weakened, deleted, or marked `.skip` /
  `.only` / `.fixme`. New code carries the repo's citation comments — `PRD 011
  Req <n>: <what and why>` per `docs/COMMENT-FORMAT.md` and
  `.sandcastle/CODING_STANDARDS.md` — and `docs/MAP.md` is regenerated with
  `npm run map` if the gate reports it stale.
- Iteration used `npm run typecheck` and `npm run test:unit` (or a targeted
  `npx vitest run tests/unit/<file>.test.ts`); the full gate was NOT run as a
  start-of-attempt baseline and was not re-run after every small change.
- `npm run validate:quick` has been run ONCE, at the end, in the implementer's
  session, and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #110, naming the modules
  added, the `U<n>` ids covering each of the five pieces (section tree, level
  mapping, excerpt fallback, cache keys, cost math), and the gate result.

## Context

This is the pure logic floor of PRD 011 (`prd/011-semantic-zoom-and-llm-providers.md`,
Req 17/22/24/28/32/33/34). It is deliberately headless: siblings #111 (provider
seam), #115 (cache store), #116 (settings), #117 (Experimental gate + zoom view),
#118 (real summaries) and #119 (cost UI) are the consumers, and several are marked
"Blocked by #110" — so exported shapes matter more than internals.

The parser is already in the tree: `src/lib/markdown.ts` runs
`remark-parse` → `remark-frontmatter` → `remark-gfm` → `remark-rehype` →
`stampSourceLines` → sanitize. Req 24's "not from scraping rendered HTML" is a
pointed contrast with today's heading palette, which reads
`h1[data-mm-line]…h6[data-mm-line]` out of the DOM in `src/App.tsx` (grep
`headingPalette`, ~line 3617). That palette keeps working as it is; this issue
adds a source-side model beside it rather than rewriting it. `stampSourceLines`
(`src/lib/markdown.ts:177`) shows how mdast positions become line numbers, and
`src/lib/frontmatter.ts` shows the frontmatter handling precedent.

Unit tests live in `tests/unit/*.test.ts`, one file per lib module, kebab-cased
(`folder-tree.test.ts` → `src/lib/folderTree.ts`); `describe` blocks name the
contract (`describe('PRD 011 Req 24 …')`). The suite is node-environment and
shares a worker, so keep the new tests pure and fast.

Costs, per CLAUDE.md: `npm run typecheck` + `npm run test:unit` are the
seconds-long inner loop; `npm run validate:quick` adds the minutes-long,
machine-serialized Playwright suite — run it once, at the end. This issue adds no
e2e tests, so `E2E_TEST_FLOOR` in `scripts/validate.mjs` (226 today) does not move.
