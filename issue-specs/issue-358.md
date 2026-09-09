# Spec: Editor: make the current-line highlight a setting, off by default (#358)

## Goal

All acceptance criteria in issue-specs/issue-358.md are satisfied for issue
#358, with evidence visible in the session: a new persisted boolean setting
`activeLine` (default `false`, user-scoped, `bool`-parsed) gates CodeMirror's
`highlightActiveLine()` through a Compartment in the editor package, so a
fresh profile shows no `.cm-activeLine` (and no `.cm-activeLineGutter`) on
the caret's line while turning it on restores exactly today's SPEC44 §2.1
tint, live via reconfigure and persisting across reload; Settings ▸ Editor
carries a "Highlight the current line" checkbox (`data-testid`
`editor-active-line`) that drives it; every existing e2e test that asserts
or locates `.cm-activeLine` enables the setting in its own boot (the shared
seed stays default-off) and no test is weakened; new `U<n>`/`E<n>` tests
pin the default, the parser, the toggle, and persistence; SPEC44 §2.1 is
amended and `docs/MAP.md` regenerated; `npm run validate:quick` passes in
the implementer's session; and a summary comment from the implementer
exists on issue #358.

## Acceptance criteria

### Setting (`src/lib/settings.ts`)

- **A new persisted key exists.** `Settings` gains `activeLine: boolean`;
  `DEFAULT_SETTINGS.activeLine` is `false`; the parser table entry is
  `bool` (a stored non-boolean or an absent key ⇒ `false`, which is the
  issue's "migration": an existing settings.json without the key parses as
  off); `SETTINGS_SCOPES.activeLine` is `'U'` (the `lineNumbers` /
  `editorHighlights` precedent — how a reader's editor pane looks is
  theirs). Each site carries a `// SPEC44 §2.1 (issue #358):` citation.
  The key therefore flows through every existing layer/round-trip path
  (`parseSettings`, `serializeSettings`, `resolveSettings`, the scope
  rail) with no further wiring — the repo has no separate settings
  export/import or reset-to-defaults feature beyond these, so requirement
  5 of the issue is met by the key living in `Settings` +
  `DEFAULT_SETTINGS` + the parser table.
- **Unit tests.** `tests/unit/settings.test.ts` gains a `describe('SPEC44
  §2.1 (issue #358) activeLine setting')` block with tests numbered from the
  next unused `U<n>` (U1379 as of this spec; re-check with
  `grep -rhoE "'U[0-9]+:" tests editor | sort -V | tail -1`): default
  `false`, `parseSettings('{}')` ⇒ `false`, a stored `true` round-trips
  through `serializeSettings`, malformed values (`"on"`, `1`, `null`) fall
  back to `false`, and the scope is `'U'` (the U1276 shape).

### Editor package (`editor/src/components/Editor.tsx`)

- **A new prop gates the extension.** `EditorProps` gains
  `activeLine?: boolean` (documented inline like `lineNumbers`; absent ⇒
  off, so other consumers of `@marky-mark/editor` are unchanged in code
  but get the new default). A new `Compartment` (the `gutterComp` pattern
  at ~1605 / ~2256 / ~2738) holds `activeLine ? highlightActiveLine() : []`
  in the extension list at the current `highlightActiveLine()` position
  (~2329), and a `useEffect` on the prop reconfigures it — no remount, undo
  history intact. The existing SPEC44 §2.1 citation there is extended with
  `(issue #358): opt-in`.
- **Gutter counterpart.** The app has never mounted
  `highlightActiveLineGutter` (E-test at `tests/e2e/settings-and-themes.spec.ts`
  ~448 documents it, and the issue #52 rule in `editor/styles.css` ~652
  neutralises the class). It stays unmounted in BOTH states — "on" is
  exactly today's behaviour — so no `.cm-activeLineGutter` ever appears.
- **CSS untouched in substance.** The `.editor-wrap .cm-editor
  .cm-activeLine` and `.cm-activeLine .mm-md-code` rules in
  `editor/styles.css` stay as they are (inert while the class is absent);
  their comments may gain one line noting the class is present only with
  the setting on. `--mm-active-line` keeps its definition and its
  `editor/THEMING.md` row (add "opt-in, issue #358" to that row's text).
  `editor/README.md`'s `Editor` feature-switch list gains `activeLine`.
- **No `console.*`, no app imports** in `editor/` (`editor/AGENTS.md`).

### App wiring (`src/App.tsx`, `src/components/SettingsPanel.tsx`)

- **The prop is passed.** The single `<Editor` mount (~8865) passes
  `activeLine={settings.activeLine}` beside `lineNumbers`, cited.
- **Settings UI.** The `editorTab` in `SettingsPanel.tsx` (~1083, the
  `Syntax` section holding `editor-syntax`, `code-syntax`,
  `editor-live-preview`) gains a `checkbox-row` — `id`/`data-testid`
  `editor-active-line`, label text exactly `Highlight the current line`,
  `checked={settings.activeLine}`, `onChange` patching the pending edit
  like its neighbours, followed by `scopeNote('activeLine')` — placed
  directly after the `editor-live-preview` row (or after `code-syntax`,
  before live preview; either is "with the other editor toggles"). It
  ships in desktop, hosted and static-web builds alike (it is plain
  settings UI; nothing is flavour-gated). No View-menu item or command is
  added (the issue asks for a Settings checkbox only). The style lint's
  rules hold (no raw colours, no bare `input` selectors, the existing
  inline `style={{ margin: 0, fontWeight: 400 }}` label idiom is allowed).
- **Live apply.** Saving the dialog with the box checked adds
  `.cm-activeLine` to the caret's line of the already-mounted editor
  without reload; saving with it unchecked removes it (settings are
  committed on Save per issue #246, so "live" means on Save, not per
  keystroke in the dialog).

### Observable behaviour (the issue's checklist, made concrete)

- **Fresh profile is off.** Booting with the seed settings (no `activeLine`
  key) into edit mode with the caret on a line: `.cm-activeLine` has count
  0 in `getByTestId('editor')`, and `.cm-activeLineGutter` has count 0.
- **Checked ⇒ on, unchecked ⇒ off, without reload.** Settings ▸ Editor
  (`openSettings(page, 'editor')`) shows `editor-active-line` unchecked;
  `.check()` + `saveSettings` ⇒ exactly one `.cm-line.cm-activeLine` holding
  the caret's text, with computed `background-color` equal to
  `--mm-active-line`'s resolved value (crisp: the accent at 10%, E625's
  reading) — i.e. today's tint, not CodeMirror's hardcoded pick; reopening
  and `.uncheck()` + save ⇒ count 0 again.
- **Persists across reload, both states.** After a reload with the key
  stored `true`, the class is present; with it stored `false` (or absent),
  it is absent. `fsRead` of `/config/settings.json` shows the key after a
  save.
- **Two-range selections.** With the setting on, multi-head selections
  behave as before (one `.cm-activeLine` per head line — CodeMirror's own
  semantics, untouched).

### Existing tests (no test weakened, renamed, skipped or deleted)

- **Tint-asserting tests enable the setting first.** E124, E125, E126,
  E127, E624, E625 (`tests/e2e/split-view.spec.ts`) and E626
  (`tests/e2e/editor.spec.ts`) patch `activeLine: true` into settings.json
  in their own boot (the `bootEditorOn` / `__mmfs` E261 pattern, or the
  `patchSettings`-style helper those files already use) before the
  assertions, then assert exactly what they assert today.
- **Locator-only tests either enable it or relocate.** The tests that use
  `.cm-activeLine` purely to find the caret's line — E317, E527
  (`editor.spec.ts`), E576, E642 (`hosted.spec.ts`: add `activeLine: true`
  to the per-user settings-blob PUT they already perform), E490
  (`smart-edit.spec.ts`), E355 (`split-view.spec.ts`), E638
  (`tables.spec.ts`), E337, E338, E533 (`toc.spec.ts`) — each EITHER
  enables the setting in its own boot OR locates the caret line by an
  equivalent means (`editorCaret(page)` / `__mmEdit` head offset → the
  `.cm-line` at that position) with the same assertion strength. A comment
  at the changed site names issue #358.
- **The shared seed stays default-off.** `SEED_SETTINGS` in
  `tests/e2e/helpers.ts` does NOT gain `activeLine: true` — the suite as a
  whole keeps running against the shipped default, which is what the new
  default-off test proves. (The E-test at `settings-and-themes.spec.ts`
  ~448 adds `cm-activeLineGutter` by hand and is unaffected.)
- **The full list to re-check** after edits:
  `grep -rn 'cm-activeLine' tests/e2e | grep -v activeLineGutter` — every
  remaining site is inside a test that turned the setting on or is a
  count-0 assertion.

### New e2e coverage

- **One or two new desktop e2e tests** in `tests/e2e/editor.spec.ts` (or
  `settings-and-themes.spec.ts`), IDs from the next unused `E<n>` (E645 as
  of this spec; re-check with `grep -rhoE "'E[0-9]+:" tests | sort -V |
  tail -1` after merges), titled `E<n>: issue #358 — …`, covering: the
  fresh-profile count-0 default (editor and gutter); the Settings ▸ Editor
  checkbox unchecked by default, check + save ⇒ the class appears on the
  caret line without reload with the token-bound colour, uncheck + save ⇒
  gone; persistence of both states across `page.reload()`. Driven by
  `getByTestId('editor-active-line')`, `openSettings`/`saveSettings`,
  `fsRead`, and the CodeMirror class locators the standards allow. The
  test would fail against the pre-change build (the class is present today
  by default).

### Docs

- **SPEC44 §2.1 amended.** `docs/specs/SPEC44.md` gains an `## Amended by
  issue #358 (2026-09-09): the caret-line tint is opt-in` section stating:
  the tint is gated by the `activeLine` setting (default off, user-scoped);
  off ⇒ `highlightActiveLine()` is not mounted (no `.cm-activeLine`, no
  gutter tint); on ⇒ the issue #345/#355 contract exactly; the Settings ▸
  Editor row; the new test IDs; which existing tests now enable it.
  `docs/ARCHITECTURE.md`'s placement paragraph (~522, "only CodeMirror's
  own `cm-activeLine` in the editor") gains "when the `activeLine` setting
  is on (issue #358, off by default)".
- **`docs/MAP.md` regenerated** with `npm run map` and committed if the
  citation set changed (the quick gate diffs it).

### Verification (test economy)

- Iterate with `npm run typecheck` and `npm run test:unit`, plus targeted
  e2e via `npx playwright test -g 'E<n>'` (the new tests, then `-g 'E124'`,
  `-g 'E626'`, `-g 'E576'`, `-g 'E337'` for the touched neighbours) — not
  the whole e2e suite per change, and no full-gate baseline at the start
  (baseline with the quick tier only).
- `npm run validate:quick` has been run ONCE in the implementer's session,
  right before declaring the goal met, and prints
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #358 (what
  changed, the new test IDs, which existing tests were re-pointed, the
  gate result).

## Context

- Today's mount: `editor/src/components/Editor.tsx` ~2329
  `highlightActiveLine()` (SPEC44 §2.1, issue #345); the reconfigurable
  precedent is `gutterComp` (`useRef(new Compartment())` ~1605, `.of(...)`
  in the extension list ~2256, `.reconfigure(...)` in a `useEffect`
  ~2738) driven by the `lineNumbers` prop; `src/App.tsx` ~8865 passes
  `lineNumbers={settings.lineNumbers}`.
- Setting precedents: `editorHighlights` (issue #308: interface ~80,
  default ~230, scope ~320, parser ~480 in `src/lib/settings.ts`; unit
  test U1276 in `tests/unit/settings.test.ts`), `showWordCount`,
  `fileTabs` (U913/U914 shape). `SETTINGS_SCOPES` is exhaustive by type,
  so a missing scope entry fails `npm run typecheck`.
- Settings UI: `src/components/SettingsPanel.tsx` `editorTab` ~1083
  (`checkbox-row` + `scopeNote(key)` idiom; `SectionHeader` for headers);
  tests reach it with `openSettings(page, 'editor')` + `saveSettings` from
  `tests/e2e/helpers.ts`; settings land on Save (issue #246).
- Styling: `editor/styles.css` ~890 (`.cm-activeLine` token rule) and ~907
  (issue #355's code-span layer), ~652 (issue #52 gutter neutraliser);
  token default `src/styles.css` ~180; `editor/THEMING.md` ~84.
- Test boot patterns: `bootEditorOn(page, path, doc, patch)` in
  `helpers.ts` ~618 (settings.json patch + reload + `#open=`), the
  `__mmfs` write in E261, the hosted settings-blob PUT in E576/E642
  (`hosted.spec.ts` ~7742), `SEED_SETTINGS` ~67.
- Rules: `.sandcastle/CODING_STANDARDS.md` (citations, no `console.*`,
  test-ID discipline, `getByTestId` for new UI), `editor/AGENTS.md` (the
  package never imports app code; new needs become props).
