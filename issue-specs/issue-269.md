# Spec: Edit mode: fenced code blocks have no syntax coloring (#269)

## Goal

All acceptance criteria in issue-specs/issue-269.md are satisfied for issue
#269, with evidence visible in the session: in edit mode (plain and the edit
half of split) a fenced block is syntax-colored per its info string across the
common languages the preview already colors — python, bash/shell, json, yaml,
rust, go, java, sql, c/cpp among them, not just the three CodeMirror languages
wired today; the colors resolve through the existing `--mm-syn-*` theme tokens
with no hardcoded palette and unknown/absent language tags stay plain with no
errors; `npm run validate:quick` has been run in the implementer's session and
prints `QUICK VALIDATION: ALL PASSED`; and a summary comment from the
implementer exists on issue #269.

## Acceptance criteria

- In plain edit mode, a fenced block whose info string names a language shows
  colored tokens in the editor pane — not flat code-foreground text. Coverage
  is at parity with the preview pane: every language in the set the preview's
  highlighter ships (`lowlight`'s `common` set behind `rehype-highlight`:
  arduino, bash, c, cpp, csharp, css, diff, go, graphql, ini, java,
  javascript, json, kotlin, less, lua, makefile, markdown, objectivec, perl,
  php, plaintext, python, r, ruby, rust, scss, shell, sql, swift, typescript,
  vbnet, wasm, xml, yaml) colors in edit mode too. Today only
  `javascript`/`ts`/`jsx`/`tsx`, `css` and `html` do (`CODE_LANGUAGES` in
  `editor/src/components/Editor.tsx`), which is the whole bug.
- The same is true in the **edit half of split view** — coloring is a property
  of the editor pane, not of which mode hosts it.
- Colors come only from the eight existing `--mm-syn-*` theme tokens via the
  `.editor-wrap .mm-code-{keyword,string,comment,number,title,attr,literal,meta}`
  rules in `editor/styles.css`. No new hardcoded color literals, no per-theme
  additions: every bundled theme in `themes/` (light and dark) drives the new
  languages with no theme-file change. If new token classes are genuinely
  needed they are defined once against `--mm-syn-*` and documented in
  `editor/THEMING.md`.
- An unlabelled fence, a fence with an unknown or bogus info string (```` ```notalang ````),
  and an empty fence all render as plain code text — no thrown error, no
  console noise, no missing card chrome, no lost text.
- Existing fenced-code behaviour is preserved and demonstrably not regressed:
  the fence background/radius (`mm-md-code`) still paints over colored bodies
  including nested-parser ones, the selection tint (`mm-code-sel`) still nests
  inside it, the code-block card view and its copy button (issues #157/#163)
  still render, and turning the **Settings → Editor → code block syntax
  coloring** switch (`codeSyntax`) off still leaves zero `mm-code-*` spans in
  the editor and adds `mm-code-plain` in the preview. E265 in
  `tests/e2e/settings-and-themes.spec.ts` and the fence assertions in
  `tests/e2e/editor.spec.ts` pass unchanged.
- Typing stays responsive on a large fence: highlighting is computed over the
  editor's visible ranges (or otherwise incrementally), never by re-highlighting
  the whole document on every keystroke. The chosen shape is stated in a
  citation comment, and a several-hundred-line fenced block can be typed into
  without a visible stall.
- The work stays inside the `@marky-mark/editor` package boundary: no module
  under `editor/` imports from `src/`, `server/` or `src-tauri/` (the
  editor-boundary check in `scripts/validate.mjs` enforces this). App-side
  changes, if any, are limited to threading existing props/settings.
- New behaviour carries citation comments in the repo's format — this extends
  `SPEC23 §3` (editor syntax highlighting, as amended by issue #122), so cite
  `// SPEC23 §3 (issue #269): …`.
- Tests: unit coverage for whatever pure module the language/token mapping
  lands in, under `editor/tests/` (new `U<n>` ids continuing past U1161), and
  at least one e2e test (new `E<n>` id past E483) proving a non-JavaScript
  fence — e.g. a ```` ```python ```` block — shows colored tokens in edit mode
  and in split view's edit half. Test titles start with their stable id; no
  existing test is weakened, renumbered or skipped.
- If a dependency is added or updated, `THIRD-PARTY-NOTICES.md` is regenerated
  with `npm run licenses` and committed in the same change, and
  `package-lock.json` is committed too.
- `docs/MAP.md` matches what `npm run map` derives from the tree (the quick
  gate diffs it; regenerate and commit rather than hand-editing).
- Iteration used the cheap loop — `npm run typecheck` and `npm run test:unit`,
  or a single targeted e2e (`npx playwright test -g '<title>'`) — after each
  change. The full desktop-shim tier (`npm run validate:quick`) was run **once**
  at the end, right before declaring the goal met, and printed
  `QUICK VALIDATION: ALL PASSED`. It was not run as a baseline before work
  started, and `npm run validate` (the release tier) is not required here.
- A summary comment from the implementer exists on issue #269, naming the
  branch, the approach taken (which highlighter, which languages), the new
  U/E test ids, and the `QUICK VALIDATION: ALL PASSED` evidence.

## Context

The editor already has the machinery this bug needs — it is just wired to
three languages. `editor/src/components/Editor.tsx` holds `mmCodeHighlight`
(Lezer tags → the eight `mm-code-*` classes), `CODE_LANGUAGES` (the
`LanguageDescription` list handed to `markdown({ codeLanguages })` at ~line
1692), `codeSyntaxExt` (the compartment the `codeSyntax` setting reconfigures),
and `mountedCodeExt` (re-asserts `mm-md-code` over nested-parser bodies so the
fence keeps its background — issue #122's note explains why). The preview side
is `editor/src/lib/markdown.ts` (rehype-highlight after sanitize) styled by
`.doc .hljs-*` in `editor/styles.css`, which is where the `--mm-syn-*` mapping
is already spelled out — the editor rules follow it at ~line 448.

Two plausible shapes, implementer's choice: (a) add CodeMirror language
packages / `@codemirror/legacy-modes` `StreamLanguage` entries to
`CODE_LANGUAGES` (weigh the added bundle weight against the single-file web
build), or (b) reuse the highlighter the preview already ships — `lowlight` /
`highlight.js` are in the tree via `rehype-highlight` — from a CodeMirror
decoration layer over fence bodies, which buys exact preview parity and one
class mapping. Either way keep the existing `mm-code-*` class vocabulary so
themes and the `codeSyntax` toggle keep working untouched.

Fence-region plumbing that already exists and should be reused rather than
re-derived: `editor/src/lib/codeBlockSpans.ts` (pure fence-span core) and
`editor/src/components/codeBlockView.ts` (the card view). Adjacent open issues
touching the same widget — #263 (cursor-line icon intrusion), #264 (diff
overlay), #265 (persistent copy button) — so keep changes scoped to coloring.
Read `.sandcastle/CODING_STANDARDS.md` and `editor/AGENTS.md` before writing
code; `docs/MAP.md` locates the SPEC23 files.
