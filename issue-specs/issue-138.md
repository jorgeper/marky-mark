# Spec: selecting code blocks (#138)

## Goal

All acceptance criteria in issue-specs/issue-138.md are satisfied for issue
#138, with evidence visible in the session: selecting text in or around a
fenced code block no longer paints or carries a selection over the prose
surrounding the block in either preview pane — the selection-mapping layer
(`src/lib/selectionMap.ts`) is fence-aware, so lines inside a fence map to
their verbatim rendered text and the fence delimiter lines contribute no
visible text, the widen-to-the-whole-covered-region fallback no longer fires
merely because the selection sits inside a fence, a pointer drag confined to
one code block in the preview selects only that block's text, unit and e2e
regression tests cover both halves, `npm run validate:quick` has been run once
at the end and passes, and a summary comment from the implementer exists on
issue #138.

## Acceptance criteria

### Reproduction and root cause

- The overselection is reproduced before it is fixed, and the reproduction is
  captured as a failing test (unit and/or e2e) that passes after the change.
  The issue text is vague ("sometimes… it overselects… text around the code
  blocks"), so the implementer's summary comment names the concrete mechanism
  actually found and demonstrated, not a guess.
- The primary suspect — documented in Context below — is that
  `src/lib/selectionMap.ts` has **no notion of fenced code blocks**: every
  entry point runs `stripInline()` over each source line as if it were prose.
  Confirm or refute this by test before fixing; if the real mechanism turns
  out to be different, fix that one instead and say so, but the fence-blindness
  criteria below still hold on their own merits because they are demonstrable
  defects.

### Fence-aware source↔rendered mapping (`src/lib/selectionMap.ts`)

- Lines **inside** a fenced code block map to their rendered text
  **verbatim**: no markdown markers are stripped. Concretely, for a fence whose
  body contains `- item`, `# not a heading`, `a * b * c`, `snake_case_name`,
  `x = *ptr;`, `[label](url)` or a backtick run, the visible text derived for
  those lines equals the source characters of those lines, and the
  source-offset map stays exact (round-tripping a range through
  `visibleTextForRange` → `findNormalized` over the rendered code text yields
  the same characters the user selected).
- The fence **delimiter** lines (```` ```js ````, ```` ``` ````, and `~~~`
  fences) contribute **no** visible characters, because the preview renders
  none. Today `stripInline('```js')` emits the literal backticks plus `js`,
  poisoning every haystack that spans a fence boundary.
- Indented (4-space) code blocks are handled at least as well as they are
  today; if the implementer extends fence-awareness to them, the leading four
  spaces are not treated as markdown prefix markers. Not extending to them is
  acceptable — say which was chosen.
- Fence detection is applied consistently across **all** the mapping entry
  points that currently call `stripInline()` per line, not just one:
  `visibleTextForRange`, `mapSelectionToSource`, `sourceOffsetForRendered`,
  `sourceRangeForVisibleMatch` (and `renderedOffsetForSource`, which composes
  `visibleTextForRange`). A shared helper that classifies a source's lines as
  fence-open / fence-body / fence-close / prose is the expected shape; a
  per-call-site copy of the scan is not.
- Because these functions take a line range rather than the whole document,
  fence state is derived from the **document start** (or from an explicitly
  passed fence map), so a range that begins in the middle of a fence is still
  recognised as being inside one. A range starting mid-fence must not be
  treated as prose just because the opening delimiter is above the range.
- New unit tests in `tests/unit/selection-map.test.ts` (numbered `U<n>`,
  continuing from the highest existing number) cover: fence body verbatim,
  fence delimiters invisible, a selection spanning prose→fence→prose, a fence
  containing text that looks like a list/heading, and a fence containing
  backticks.

### Selection behaviour in the preview panes

- **Split-edit mirror (SPEC23/SPEC24, `src/App.tsx` ~1225–1252):** selecting a
  substring inside a fenced code block in the editor paints
  `mark.mm-mirror-sel` over **that substring only** in the split preview. It
  does not tint the whole `<pre>`, the whitespace around it, the following
  paragraph, or — when the fence is the document's last block — the remainder
  of the document. The existing whole-region fallback stays as the last resort
  for genuinely unlocatable or ambiguous text; it must no longer be reached
  merely because the selection is inside a fence.
- **Selection carry across mode switches (SPEC25 §2, `src/App.tsx`
  ~5568–5610):** with a selection inside a fenced code block in the editor,
  switching to preview (Mod+E) restores a native preview selection covering the
  corresponding code text only — not the whole block region plus surrounding
  prose. This path writes a real `Selection`, so this is the most likely thing
  the reporter saw.
- **Preview → editor mirror (SPEC23 §1):** selecting text inside a code block
  in the split preview moves the editor selection to the corresponding source
  range inside the fence. The documented "fall back to the covering line range"
  behaviour still exists for unlocatable text but is not triggered by fence
  content that is locatable.
- **Native pointer drag:** a real mouse drag (`page.mouse.down/move/up`, not a
  programmatic `Range`) whose start and end points both lie on code text inside
  one fenced block in the read-only preview (`[data-testid="doc"]`) yields
  `window.getSelection().toString()` containing only characters from that
  block — no text from the paragraph, heading or list before or after it. The
  same holds in the split preview pane (`[data-testid="split-preview"]`).
- If the drag case above already passes before any change, say so in the
  summary comment rather than inventing a fix for it — the regression test is
  still added.
- A drag that starts in the `<pre>`'s padding gutter (the band of code-block
  background above/below/left of the code text, `.doc pre { padding: 14px 16px }`)
  anchors **inside** the code block rather than at the end of the preceding
  block, so dragging from there through the code selects code only. If this is
  not reproducible in the harness, note that and leave it — do not add
  speculative machinery for it.
- Copying such a selection puts exactly the selected code characters on the
  clipboard: no `Copy`/`Copied` button label (it is a `::after` pseudo-element
  and must stay that way), no stray leading/trailing newline pulled in from a
  neighbouring block.

### Non-regressions

- **Select All** (Mod+A) in a preview pane still selects the whole document,
  code blocks included — any clamping added must not truncate it.
- Keyboard selection extension (Shift+Arrow, Shift+Click) from inside a code
  block can still leave the block; the fix confines *mapping* and *drag*
  overselection, it does not lock the user inside a `<pre>`.
- `getDocText()` over the preview root is unchanged: the rendered HTML from
  `src/lib/markdown.ts` is the comment-anchor coordinate space and must not
  gain or lose a character. Existing comment anchors on documents containing
  code blocks still resolve. Do **not** solve this by changing the markdown
  pipeline's output or by injecting text nodes into the preview.
- Export (`src/lib/exportDoc.ts`) and print output are unaffected — the fix
  lives in the mapping/selection layer, not in rendered HTML.
- SPEC44 active-line/active-word cues, find marks (SPEC30 §1.3), comment
  highlights, the Issue #122 copy button, and scroll sync (SPEC15) all keep
  working over documents with code blocks. The existing suites stay green:
  `tests/e2e/live-preview.spec.ts`, `tests/e2e/editor.spec.ts`,
  `tests/e2e/comments.spec.ts`, `tests/e2e/reading-and-export.spec.ts`,
  `tests/unit/selection-map.test.ts`, `tests/unit/active-position.test.ts`.
- Behaviour changed or added carries a `SPEC<n> §x.y:` or `Issue #138:`
  citation comment per `.sandcastle/CODING_STANDARDS.md` and
  `docs/COMMENT-FORMAT.md`. If a `docs/specs/` contract is amended, `npm run map`
  is re-run so `docs/MAP.md` matches what the generator derives (the validation
  gate diffs it).

### Tests and verification

- New e2e coverage lives with the feature area it exercises —
  `tests/e2e/live-preview.spec.ts` for the mirror/carry cases and
  `tests/e2e/reading-and-export.spec.ts` (or `live-preview.spec.ts`) for the
  drag case — with titles numbered `E<n>` continuing from the highest existing
  number, following the shape of the helpers in `tests/e2e/helpers.ts`.
- The implementer iterates with `npm run typecheck` and `npm run test:unit`,
  or a targeted single e2e test (`npx playwright test -g '<title>'`), and
  baselines with the quick tier only. `npm run test:e2e` is not run after every
  small change.
- `npm run validate:quick` has been run **once**, right before declaring the
  goal met, in the implementer's session, and printed
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #138, naming the
  mechanism found, the files changed, the new test numbers, and the
  `validate:quick` result.

## Context

The whole preview↔source selection mapping layer is `src/lib/selectionMap.ts`,
and it is fence-blind: `stripInline()` (line ~30) is applied to every source
line independently, treating `-`/`#`/`*`/`_`/`~`/`[](…)`/backticks as markdown
markers even when the line is inside a fenced code block, whose content the
preview renders verbatim. Every consumer inherits this: `visibleTextForRange`
(~166), `mapSelectionToSource` (~110), `sourceOffsetForRendered` (~285),
`sourceRangeForVisibleMatch` (~330). Fence delimiter lines are the sharper
half of the bug — the preview emits no text for them at all, but `stripInline`
emits the backticks and the language tag.

The visible consequence is in `src/App.tsx`. Both the split mirror (~1225–1252)
and the SPEC25 selection carry (~5568–5610) build a *region* from the
`data-mm-line` stamps covering the selection's source lines, then search that
region's rendered text for the needle from `visibleTextForRange` — and on a
miss or an ambiguous match they fall back to **the whole region**
(`const [hs, he] = hit ? [rs + hit.start, rs + hit.end] : [rs, re]`). For code
blocks the needle reliably misses, so the fallback fires and the selection
widens to the entire block plus the whitespace up to the next stamped block —
and to `pane.lastChild` when the fence is the last block. That is "overselects
text around the code blocks", and "sometimes" fits: it depends on whether the
code happens to contain characters `stripInline` eats.

Rendering: `src/lib/markdown.ts` (remark/rehype + `rehype-highlight`) stamps
`data-mm-line` on direct root children only, so a fence's `<pre>` carries the
line of its opening delimiter. `src/lib/codeCopy.ts` (Issue #122) then grafts
a `<div class="mm-codeblock">` wrapper and a text-node-free copy button around
each `<pre>` in the live panes only — it deliberately contributes no text, and
must keep that property. `src/lib/domtext.ts` (`getDocText`, `rangeToOffsets`,
`offsetsToRange`, `highlightRange`) is the DOM↔offset layer; note
`offsetsToRange`'s boundary rule can place a range start at the tail of the
preceding inter-block whitespace text node, which is worth checking as a
secondary contributor.

Pane JSX and click delegates: `src/App.tsx` ~6820 (preview, `data-testid="doc"`)
and ~6918 (split preview). Preview code-block CSS: `src/styles.css` ~395
(`.doc pre`) and ~516–559 (`.mm-codeblock` / `.mm-copy-code`). Existing e2e
selection helpers build Ranges programmatically (`tests/e2e/helpers.ts`
`selectPhrase`/`selectSpanInPane`), so none simulate a mouse drag — use
`page.mouse.down/move/up` for the drag case (see `tests/e2e/folder-tree.spec.ts:138`
for the pattern). Highest existing test numbers at spec time: `E298`, `U712`.
Grep `SPEC23`, `SPEC24`, `SPEC25`, `SPEC44` for the cited sites before opening
`App.tsx`, and never read `App.tsx` end-to-end.
