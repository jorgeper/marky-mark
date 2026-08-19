# Spec: Add 'copy' button in code blocks, and option to show syntax coloring (#122)

## Goal

All acceptance criteria in issue-specs/issue-122.md are satisfied for issue
#122, with evidence visible in the session: every fenced code block in the
preview carries a copy control that puts the block's exact source text on the
clipboard, a persisted setting (default ON, in Settings ▸ Editor ▸ Syntax)
governs code-block syntax coloring in the preview and in the editor pane,
tests cover both halves, `npm run validate:quick` has been run and passes, and
a summary comment from the implementer exists on issue #122.

## Acceptance criteria

### The copy button

- Every fenced code block (`<pre>`) rendered in the preview pane carries a
  copy affordance — a button in the block's top-right corner, revealed on
  hover/focus of the block and reachable by keyboard (it is a real `<button>`
  with an accessible name, e.g. `aria-label="Copy code"`), with a stable
  `data-testid` so e2e can drive it.
- Clicking it places the code block's **exact source text** on the clipboard:
  the code characters only — no language label, no button label, no leading or
  trailing blank line beyond what the block itself contains, and no `hljs`
  markup. A block whose content is `const a = 1;\nconst b = 2;` copies exactly
  those two lines.
- The copy goes through the existing seam: `platform.copyText` when present,
  falling back to `navigator.clipboard.writeText` — the same two-step
  `copyToClipboard` shape already in `src/App.tsx` (SPEC43 §4.5). It works in
  the desktop shell, the web build and the hosted build; no new platform seam
  is required.
- The button gives brief confirmation after a successful copy (e.g. the label
  or icon changes to "Copied" for a second, then reverts). A failed copy does
  not throw or leave the button stuck in the confirming state.
- Inline code spans (`` `like this` ``) get **no** button — fenced blocks only.
- The button does not perturb comment anchoring: `getDocText(docRef)`
  (`src/lib/domtext.ts`) over the preview root returns the same string with the
  buttons present as without, so existing comment anchors on a document that
  contains code blocks still resolve to the same ranges (there is an existing
  unit/e2e surface for anchoring — keep it green, and cover this explicitly).
- The button is chrome, not content: it does not appear in exported HTML
  (`src/lib/exportDoc.ts` / the Export dialog output), in printed output
  (`@media print` in `src/styles.css` already hides app chrome), or in the
  plain-text/markdown copied by selecting document text.
- Preview code blocks keep their current appearance when the button is not
  shown — no layout shift, no reflow of the code, no horizontal-scroll
  regression on wide blocks (`.doc pre` has `overflow-x: auto`).
- The editor pane is out of scope for the copy button (see Context); it is not
  regressed — its existing chips, Smart Edit menu and selection behaviour are
  unchanged.

### The syntax-coloring option

- A new persisted boolean setting exists (suggested name `codeSyntax`),
  defaulting to **true**, added to `Settings` / `DEFAULT_SETTINGS`, to the
  parse validator, and to `SETTINGS_SCOPES` with a scope justified in a
  comment (`'U'`, matching its neighbour `editorSyntax`, is the expected
  answer). The resolver completeness test — `SETTINGS_SCOPES` keys must equal
  `DEFAULT_SETTINGS` keys (`tests/unit/settings-resolver.test.ts:71`) — stays
  green.
- The setting round-trips through `settings.json`: an explicit `false` is
  honored, a malformed value (`"off"`, `0`) falls back to the default `true`,
  and the key survives serialize→parse. A unit test in
  `tests/unit/settings.test.ts` covers this in the shape of U51 (the existing
  `editorSyntax` case).
- A labelled checkbox row for it exists in the Settings panel's **Editor** tab
  under the existing `Syntax` heading, next to "Markdown syntax highlighting"
  (`src/components/SettingsPanel.tsx`), with a `data-testid` and the usual
  `scopeNote`. Its label names what it does for a reader (e.g. "Code block
  syntax coloring"), distinct from the existing markdown-highlighting row.
- With the setting **on** (the default), fenced code blocks that declare a
  language are colored by language in the preview — the behaviour that exists
  today via `rehypeHighlight` in `src/lib/markdown.ts` — and are colored in the
  **editor pane** too, which today colors the whole fence body as one flat
  `mm-md-code` span.
- Editor coloring uses the theme's existing `--mm-syn-*` tokens (keyword,
  string, comment, number, title, attr, literal, meta — the same eight the
  preview's `.doc .hljs-*` rules consume), so all 27 bundled themes drive it
  with no theme file changes. State in the code comment which languages the
  editor colors; a fence in a language outside that set, an unlabelled fence,
  or a fence with a bogus info string renders as plain code text — no error, no
  console noise, no lost characters.
- With the setting **off**, no per-token coloring appears in either pane:
  preview code blocks and editor fences render in the plain code foreground
  colour. The code background, mono font, radius and the SPEC23 §3 selection
  tint over code are unchanged in both states.
- Toggling the setting applies live in an open document — no restart, no
  reopening the file, and (in the editor) no loss of undo history: the editor
  reconfigures through a compartment the way `editorSyntax` already does
  (`syntaxComp` in `src/components/Editor.tsx`).
- The existing `editorSyntax` setting keeps its current meaning and default —
  markdown syntax highlighting in the editor — and its E2E/unit coverage stays
  green. The two settings are independent: neither silently overrides the
  other, and the interaction with live preview (PRD 006 §12, where preview
  supersedes `editorSyntax`) is stated in a comment and behaves predictably.

### Process

- Any changed or added behaviour carries a citation comment in the repo's
  format (`// SPEC<n> §x.y: …`, `PRD <n> §x`, or `Issue #122: …` where the
  contract is this issue), per `.sandcastle/CODING_STANDARDS.md`.
- Tests exist for both halves and state their intent in a comment: a unit test
  for the new setting's parse/default/round-trip in `tests/unit/`, plus e2e
  coverage — the copy button putting the right text on the clipboard (the
  desktop shim records `platform.copyText` into `__mmClipboard`, so this is
  assertable) and the setting toggling coloring on and off in both panes.
  Place them in the suites that already cover these areas
  (`tests/e2e/reading-and-export.spec.ts`, `tests/e2e/editor.spec.ts`,
  `tests/e2e/settings-and-themes.spec.ts`) with new `E<n>` numbers.
- `npm run map` has been re-run if the generated spec→code table would
  otherwise drift (`docs/MAP.md` is generated, never hand-edited).
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (or tests targeted at the changed code, e.g.
  `npx playwright test -g 'E82'`), not the full gate. Baseline, if taken at
  all, was the quick tier only.
- `npm run validate:quick` has been run ONCE, at the end, right before
  declaring the goal met, and printed `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #122 describing what
  changed and the verification evidence.

## Context

The issue body is empty; the title plus the owner's one comment are the whole
brief: *"option to show syntax coloring: make this a setting turned on by
default, probably in editor"*. Read that as the **code block** syntax coloring
(colouring by language), with the setting living in the Settings panel's
Editor tab — not the already-existing `editorSyntax` row, which is markdown
syntax highlighting. There is no PRD and no parent issue.

Where things are today:

- Preview colouring already happens, unconditionally:
  `src/lib/markdown.ts:203` runs `rehypeHighlight` with `{ detect: false }`
  (explicitly-labelled fences only), and `src/styles.css:454–495` maps the
  `.doc .hljs-*` classes onto the theme's `--mm-syn-*` variables. Making it
  conditional does not require re-rendering the markdown — neutralizing the
  colours with a class on the `.doc` root is the cheap route; either way, keep
  the pipeline's text content untouched (the file header explains why:
  comment anchors are offsets into the rendered plain text).
- Editor colouring does not exist: `src/components/Editor.tsx:1057` calls
  `markdown()` with no `codeLanguages`, so a fence body is one flat
  `tags.monospace` → `mm-md-code` span (the `mmHighlight` style at
  `Editor.tsx:312`). `@codemirror/lang-javascript`, `lang-css` and `lang-html`
  are already in `node_modules` as transitive deps of `@codemirror/lang-markdown`
  — declaring what you import in `package.json` is required; keep any new
  dependency footprint small and justified in the commit message.
- The preview is `innerHTML` injected into `div.doc` (`src/App.tsx:6255`),
  which already has a click delegate for links, comment marks and caret
  placement — an overlay/DOM affordance added there is the natural home for the
  copy button, and it keeps the button out of the markdown pipeline (and hence
  out of exports, print and the anchor coordinate space). Split view mounts a
  second `.doc` at `src/App.tsx:6349`; both should behave the same.
- Clipboard: `copyToClipboard` in `src/App.tsx:3755` is the existing
  `platform.copyText` → `navigator.clipboard` fallback; `copyText` is declared
  at `src/platform/types.ts:135`.
- Settings plumbing for a new key touches four places in `src/lib/settings.ts`
  (interface, `DEFAULT_SETTINGS`, `SETTINGS_SCOPES`, the validator map) plus
  the panel row in `src/components/SettingsPanel.tsx:773+`.

Scope boundary: the copy button is a **preview** affordance. The editor pane
already lets the reader select and copy directly (and has the Smart Edit menu's
Copy row, SPEC43 §4.5), so no code-fence copy chip is required there; if one
falls out naturally, it must not disturb the existing chip layers (SPEC37
tables, SPEC41 images, SPEC43 smart-edit button).

Relevant specs to grep before opening files: SPEC23 (editor markdown
highlighting, §3 amended by issue #123 for the code selection tint), SPEC43
(Smart Edit menu / clipboard seams), SPEC17 (export), SPEC11 §4 (managed links
in the preview), PRD 006 (live preview). Use `rg 'SPEC23' src` rather than
reading `src/App.tsx` end-to-end.
