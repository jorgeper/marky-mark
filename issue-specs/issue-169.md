# Spec: Mermaid width token: fence info-string parse and surgical meta rewrite (#169)

## Goal

All acceptance criteria in issue-specs/issue-169.md are satisfied for issue
#169, with evidence visible in the session: a pure `src/lib/` module reads a
`width=N` token out of a fence's info string tolerantly (missing, non-numeric,
zero or negative ⇒ no width, no mutation) and rewrites the opening fence line
surgically (replace in place, append when absent, delete on removal, every
other token plus indentation and fence run preserved verbatim), the module is
unit-tested across the Req 2 matrix with no user-visible change and no `height`
support, `npm run validate:quick` passes in the implementer's session, and a
summary comment from the implementer exists on issue #169.

## Acceptance criteria

- **PRD 015 Req 1 — the token's shape.** A diagram's width is the token
  `width=N` (N a positive integer of CSS px) in the opening fence's info string
  *after* the language word, e.g. ` ```mermaid width=500 `. The language word
  stays first so `fenceLanguage()` (`src/lib/fenceRenderers.ts:112`, first word
  is the language, rest is meta) and every CommonMark/GitHub renderer still
  detect `mermaid`. Nothing in this issue adds a sidecar file, an HTML wrapper
  or a comment marker.
- **A pure module owns it.** The logic lives in a new `src/lib/` module (name it
  for the contract, e.g. `fenceWidth.ts`) obeying the purity rule in
  `.sandcastle/CODING_STANDARDS.md` — no `react`, no `@tauri-apps/*`, no
  `src/components/` and no CodeMirror imports; `src/lib/imageResize.ts` is the
  shape to copy (a reader over text, a rewriter returning replacement text).
  The module names no concrete language: `mermaid` does not appear in it. It may
  reuse `fenceLanguage` but must not import the renderer registry's async side.
- **PRD 015 Req 3 — tolerant reading.** The reader takes an info string (the
  same value `fenceLanguage` is handed: a `CodeInfo` slice or a hast `lang`+meta
  string) and returns the width as a number, or null. Null is the answer for:
  no meta at all, meta with no `width` token, a bare `width` with no `=`,
  `width=` with nothing after it, and any non-integer or non-positive value —
  `width=abc`, `width=500px`, `width=12.5`, `width=0`, `width=-40`. Only a plain
  run of digits qualifies. The token name matches case-insensitively
  (`Width=500` reads as 500); writing always emits lowercase `width=N`. Reading
  returns a value only — it never rewrites, never throws and never mutates the
  document. A `height=` token is never read and never written; if one is present
  in the meta it is preserved verbatim like any other unknown token.
- **PRD 015 Req 2 — surgical rewrite.** A second export takes the opening fence
  line (whole line, as it sits in the document) plus a target width (a positive
  integer, or null to remove) and returns the replacement line. It must:
  replace an existing `width=…` token **in place**, wherever it sits among the
  meta tokens (first, last, or between others); append ` width=N` at the end of
  the meta when none exists; on removal delete only that token and the single
  space before it; and preserve verbatim the leading indentation, the fence
  character (` ``` ` or `~~~`), the fence run length (4+ backticks included), the
  language word, every other meta token, its order and its internal spacing, and
  any trailing `\r` / line ending handling the caller relies on. Removing a
  width from a line that has none returns the line unchanged (an explicit
  no-op), and writing the width a line already carries returns it byte-identical
  — so a caller can compare and skip the buffer write.
- **No language word ⇒ no write.** An opening fence line with no language word
  (` ``` ` alone, or only whitespace after the run) is returned unchanged by the
  rewriter: appending would make `width=500` the fence's language. State this in
  the module's header comment and cover it in a test.
- **Round-trip.** `read(rewrite(line, N)) === N` for every line in the test
  matrix, and `read(rewrite(line, null)) === null`. If a hand-written document
  somehow carries two `width` tokens, reading takes the first and rewriting
  leaves exactly one — a repeated rewrite is idempotent, no token pile-up.
- **PRD 015 Req 2 — unit coverage.** `tests/unit/<kebab-case-module>.test.ts`
  (one file for the new module), test titles numbered from **U761** up
  (re-check `grep -rhoE '\bU[0-9]+\b' tests/unit | sort -u | tail` before
  writing), `describe` blocks naming the contract (`PRD 015 Req 1`,
  `PRD 015 Req 2`, `PRD 015 Req 3`). The matrix Req 2 names is covered
  explicitly: no meta, meta without width, width among other tokens, width
  first, width last, tilde fences, indented fences (up to three spaces) — plus
  the tolerant-read cases and the removal/no-op/round-trip cases above.
- **Logic layer only — nothing user-visible lands here.** No consumer is wired
  up in this issue: `src/lib/fenceDiagrams.ts`, `src/lib/diagramSpans.ts`,
  `src/components/diagramView.ts`, `src/lib/markdown.ts`, the sanitize schema,
  the settings surface and the menus are untouched. Rendering, export, print and
  comment anchoring behave exactly as before; the existing suites (E309–E313,
  the mermaid unit tests) pass unchanged. Issues #170–#172 consume this module.
- New code carries a citation comment naming its contract
  (`// PRD 015 Req 2: …`) per `.sandcastle/CODING_STANDARDS.md` and
  `docs/COMMENT-FORMAT.md`. No `SPEC<n>` citation is added or moved here, so
  `docs/MAP.md` needs no regeneration — but if one is, run `npm run map` and
  commit the result (validate:quick diffs it).
- Test economy: iteration used `npm run typecheck` and `npm run test:unit` (or a
  targeted `npx vitest run tests/unit/<file>.test.ts` while debugging one
  behaviour) — not the full gate after every change, and no full-suite baseline
  at the start of the attempt (baseline with the quick tier only if you need
  one).
- `npm run validate:quick` has been run ONCE, at the end, in the implementer's
  session and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #169, stating what
  changed (the module, its two exports, the test file and numbers), the
  verification evidence, and anything deliberately left out.

## Context

First of four issues under `prd/015-resizable-mermaid-diagrams.md` (parent
#166): #170 draws the persisted width in both panes, #171 adds click-select and
corner handles in the preview, #172 covers anchors, parity and the test matrix.
This one is the pure layer they all call, so keep its API small and total —
a reader and a rewriter over strings, no DOM, no editor state.

Where the pieces already are: `src/lib/fenceRenderers.ts` holds the registry and
`fenceLanguage()` (first word = language, rest = meta — read its comment before
writing the meta split); `src/lib/diagramSpans.ts:57` shows the editor side
slicing `CodeInfo` out of the syntax tree and `src/lib/fenceDiagrams.ts:83`
shows the preview side reading the rendered `<code>`'s class — note the class
shape (`language-mermaid`) carries no meta, so #170 will need the info string
from another route; that is its problem, not this issue's, but keep the reader
tolerant of being handed either string. `src/lib/imageResize.ts` is the closest
existing model for "surgical text rewrite + a splice helper"; an
`applyImageRewrite`-style splice (source, line bounds, width) is welcome here if
it keeps the callers in #170/#171 honest, but the two exports above are what the
criteria require.

Do not read `src/App.tsx` end-to-end — citation-grep into it, and use
`docs/MAP.md` for spec→file lookups. Coding rules live in
`.sandcastle/CODING_STANDARDS.md`. Next free unit test number as of this spec:
**U761** (re-check before you write).
