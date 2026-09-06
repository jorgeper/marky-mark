# Spec: better callout rendering (#318)

## Goal

All acceptance criteria in issue-specs/issue-318.md are satisfied for issue
#318, with evidence visible in the session: GitHub-alert callouts
(`> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]`) render in the preview as tinted
callout blocks — pastel, per-kind, theme-resolved — instead of literal
`[!IMPORTANT]` text; a persisted `calloutView` setting renders callouts in the
edit pane with a Smart Edit ▸ Callout raw/rendered toggle row and a Settings
checkbox; `npm run validate:quick` was run once at the end and printed
`QUICK VALIDATION: ALL PASSED`; and a summary comment from the implementer
exists on issue #318.

## Acceptance criteria

### Preview rendering

- In the preview pane, a blockquote whose first line is `> [!NOTE]`,
  `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]` or `> [!CAUTION]` (GitHub's
  five kinds, case-insensitive marker, the same set `CalloutKind` in
  `editor/src/lib/smartEdit.ts` already inserts) renders as a callout block:
  a kind-labelled title row ("Note", "Tip", "Important", "Warning",
  "Caution") above the quote's remaining content. The literal `[!IMPORTANT]`
  marker text no longer appears as body text — that is the defect the issue's
  screenshot shows.
- Each kind is visually distinct: a pastel tint background plus an accent
  border/title colour that differ per kind (the GitHub convention — note
  blue, tip green, important purple, warning amber, caution red — is a fine
  starting point, but the palette must read as pastel, not saturated).
- The tints resolve through `--mm-callout-*` CSS custom properties so they
  vary by theme: defaults are declared once in a DOCUMENT RENDERING block of
  `editor/styles.css` (the `--mm-marker-*` precedent), and at least the
  light/dark split is handled so a dark theme does not paint a light-theme
  pastel behind dark text. Any bundled theme in `themes/` may override the
  tokens; none is required to.
- A unit test reads the shipped CSS and asserts, for every bundled theme in
  `themes/` plus the package default, that callout body and title text clear
  the WCAG AA 4.5:1 floor against the kind's tint — reuse the arithmetic in
  `tests/unit/css-contrast.ts` (the `tests/unit/marker-tokens.test.ts`
  precedent). No hand-computed ratios in comments only.
- A blockquote that is not a callout (no `[!KIND]` first line, or an
  unrecognised kind such as `[!HINT]`) renders exactly as it does today —
  plain `.doc blockquote`, marker text intact.
- Exported and printed documents render callouts the same way: the standalone
  stylesheet in `src/lib/exportDoc.ts` carries the callout rules alongside its
  existing `.doc blockquote` rule, so an exported HTML file is not left with
  unstyled callout markup.

### Edit-pane view + the menu item

- A new boolean setting `calloutView` exists in `src/lib/settings.ts`,
  default **on**, User (`'U'`) scope, parsed with the `bool` fallback —
  following `codeBlockView` / `diagramView` / `linkView` exactly, comments
  included.
- With `calloutView` on, callout blocks render inline in the edit pane
  (tinted like the preview, marker line no longer shown raw); with it off the
  edit pane shows the raw `> [!NOTE]` markdown. The toggle takes effect live
  on the open document without a reload, like its four view kin, and — like
  `linkView` — the decoration stands down while live preview owns the pane.
- The Smart Edit menu's existing `Callout` submenu
  (`buildSmartMenu` in `editor/src/lib/smartEdit.ts`) gains a toggle row as
  its first entry, labelled `Show Raw Callouts` when the view is on and
  `Show Rendered Callouts` when it is off — the `toggle-grid` /
  `toggle-links` idiom. The five insert rows keep their ids, labels, order
  and their no-hotkey status.
- The toggle is wired end to end: `SmartMenuCtx` gains the view flag, the
  Editor gains `calloutView` / `onToggleCalloutView` props, and `src/App.tsx`
  persists the flip through `updateSettings` — the pattern `linkView` uses.
- `src/components/SettingsPanel.tsx` gains a Callouts section with a
  checkbox (`data-testid="settings-callout-view"`, e.g. "Show callouts in the
  editor") beside its view kin, carrying the same `scopeNote`.

### Tests, docs and process

- New unit tests cover the pure pieces: the callout detection/transform (a
  new `editor/tests/*.test.ts` for a new pure module, or added cases in the
  markdown/smart-edit tests), the menu row's label flip in both states, and
  the settings round trip (default, scope, hand-edited non-boolean falls back).
- At least one e2e test proves the visible behaviour: a document with all
  five kinds renders as callouts in the preview, and the Smart Edit toggle
  flips the edit pane between rendered and raw. Put it beside its kin
  (`tests/e2e/smart-edit.spec.ts` and/or `tests/e2e/styling.spec.ts`), driven
  by `data-testid` where the app owns the DOM.
- Every new test title starts with the next unused `U<n>` / `E<n>` id; no
  existing test is renumbered, weakened, skipped or deleted.
- Code carries citation comments naming this issue (`// Issue #318: …`) in
  the repo's house style; `.sandcastle/CODING_STANDARDS.md` and
  `docs/STYLE-GUIDE.md` rules hold (no colour literals outside token
  definitions and contract-var fallbacks, `SectionHeader` for the settings
  header).
- The `@marky-mark/editor` boundary holds: nothing under `editor/` imports
  from `src/`; the app passes the setting in as a prop.
- `editor/THEMING.md` documents the new `--mm-callout-*` variables in its
  table, and `docs/MAP.md` is regenerated with `npm run map` if the
  generator's output changes (the gate diffs it).
- The implementer iterated with `npm run typecheck` and `npm run test:unit`
  (or targeted runs, e.g. `npx playwright test -g '<title>'` for one e2e
  behaviour), and ran the full quick gate **once** at the end — not per change
  and not as a starting baseline.
- `npm run validate:quick` was run in the implementer's session and printed
  `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #318, naming what
  changed and the gate result.

## Context

Today nothing renders GitHub alerts: `editor/src/lib/markdown.ts` is
remark-parse → gfm → rehype → sanitize → stringify with no alert plugin, so
`> [!IMPORTANT]` reaches the preview as a plain blockquote containing the
literal marker. Prefer a small pure transform inside `editor/` over a new npm
dependency — a dependency drags `npm run licenses`, THIRD-PARTY-NOTICES and
the bundle-scan tests along with it.

Two gotchas in that pipeline. **Sanitize runs after your transform**:
`rehype-sanitize`'s schema in `markdown.ts` is explicit about which
attributes survive, so the callout container's `className` (and any
`data-mm-*`) must be added to the schema or it will be stripped. **Comment
anchors are offsets into the rendered plain text** (the module's header
comment says so, and SPEC15 §2.2's `data-mm-line` stamps drive scroll sync) —
keep the line stamps on the callout container and expect the anchoring and
comments suites to be the ones that catch a mistake here.

The edit-pane side has four worked precedents to copy rather than invent:
`tableGridView`, `inlineImages`, `codeBlockView`, `diagramView`, `linkView` —
trace `linkView` (issue #270) through `src/lib/settings.ts`, `src/App.tsx`,
`editor/src/components/Editor.tsx` (props, `smartPropsRef`, the
`Compartment` reconfigure), `editor/src/components/linkView.ts` +
`editor/src/lib/linkSpans.ts` (pure spans vs view wiring), and
`editor/src/lib/smartEdit.ts`. `rg 'SPEC43' src editor` and
`rg 'linkView' src editor` land on the whole chain; never read `src/App.tsx`
end to end.

Styling lives in `editor/styles.css` (`.doc blockquote` around line 105) for
both panes, with the export copy in `src/lib/exportDoc.ts`. Theme tokens are
`--mm-*` on `.theme-root`; 27 themes in `themes/` each declare ~35 of them,
and `tests/unit/theme-guard.test.ts` re-parses every one. Deriving tints with
`color-mix` against `--mm-bg`/`--mm-fg` from a per-kind hue token keeps all 27
themes working without touching each file — that is the mechanism the marker
tints already use.
