# Theming `@marky-mark/editor` — the `--mm-*` variable contract

<!-- PRD 021 Req 9 (issue #238): the package documents the CSS-variable
     contract its stylesheet consumes, and ships a default theme. -->

Every color, font and size in the package stylesheet (`styles.css`) resolves
through a `--mm-*` CSS custom property. The host themes the editor, preview
and split view by defining these variables on any ancestor of the embed —
Marky Mark defines them on its `.theme-root` via runtime-injected theme
stylesheets; a bare embed can simply `import '@marky-mark/editor/default-theme.css'`,
which assigns a presentable default for **every** variable below on `:root`.

Most declarations carry a literal fallback matching the default (Crisp)
values, so a theme that sets only a few variables still renders sensibly.
Variables marked **no fallback** render unstyled (or inherit) when neither
the host nor the default theme defines them.

This list is exactly the set `styles.css` consumes — keep the two in
lock-step. Re-derive it with:

    grep -oE 'var\(--mm-[a-z0-9-]+' styles.css | sort -u

## Fonts and layout

| Variable | Meaning |
|---|---|
| `--mm-font-body` | Body font stack (rendered document text, UI captions inside the panes) |
| `--mm-font-heading` | Heading font stack for `.doc` h1–h6 |
| `--mm-font-mono` | Monospace stack: code blocks, inline code, the editor surface |
| `--mm-font-size` | Base document font size (e.g. `16px`); editor text is 0.875× |
| `--mm-content-width` | Max width of the document/editor text column (e.g. `46rem`) |

## Core colors

| Variable | Meaning |
|---|---|
| `--mm-bg` | Pane background (editor surface, gutters, copy-button face) |
| `--mm-bg-elevated` | Raised surfaces: table chips, confirmation captions |
| `--mm-fg` | Body text |
| `--mm-fg-muted` | Secondary text: gutters, diagram errors, idle copy buttons |
| `--mm-muted` | Muted UI glyphs (the Smart Edit submenu arrow) — **no fallback** |
| `--mm-heading` | Heading color, in the preview and the editor's `#` lines |
| `--mm-link` | Links, in the preview and the editor's link/URL tokens |
| `--mm-accent` | Accent: caret, cursor, chips, hover rings, the vim badge |
| `--mm-border` | Hairlines: gutter rules, chip borders, the split-divider seam |

## Markdown / document elements

| Variable | Meaning |
|---|---|
| `--mm-code-bg` | Code-block and inline-code background (both panes) |
| `--mm-code-fg` | Code foreground (both panes) |
| `--mm-blockquote-border` | Blockquote's left bar |
| `--mm-blockquote-fg` | Blockquote text |
| `--mm-table-border` | Table cell borders |
| `--mm-table-stripe` | Table zebra-row background |
| `--mm-hr` | Horizontal rules (and the editor's `---` token) |
| `--mm-selection` | Text-selection tint (editor selection layer, code-span repaint) |

## Syntax highlighting (fenced code, both panes)

| Variable | Colors |
|---|---|
| `--mm-syn-keyword` | keywords, tags |
| `--mm-syn-string` | strings, regex |
| `--mm-syn-comment` | comments, quotes |
| `--mm-syn-number` | numbers |
| `--mm-syn-title` | function/class names |
| `--mm-syn-attr` | attributes, properties |
| `--mm-syn-literal` | true/false/null, builtins |
| `--mm-syn-meta` | meta, annotations |

## Editor cues

| Variable | Meaning |
|---|---|
| `--mm-find` | Find-match background (editor `.cm-searchMatch`) — **no fallback** |
| `--mm-find-active` | The current find match's background — **no fallback** |
| `--mm-find-fg` | Foreground on find matches — **no fallback** |
| `--mm-active-word` | SPEC44 caret-word tint in the editor — **no fallback** |
| `--mm-diff-changed-bg` | SPEC16 changed-line tint — **no fallback** |
| `--mm-diff-removed` | SPEC16 deleted-run left edge — **no fallback** |
| `--mm-comment-tint` | The fixed comment tint (blue) — comment records' editor highlight (PRD 022 Req 12, issue #283); resolved ghosts mix it down (issue #285) |
| `--mm-comment-tint-active` | The stronger comment tint — the editor highlight's active/flash treatment (PRD 023 §18, issue #285) |
| `--mm-marker-yellow` / `--mm-marker-green` / `--mm-marker-orange` / `--mm-marker-pink` | PRD 022 Req 13 marker hues; editor highlights mix them at 42%, 60% active/flash (issue #285) |

## Scale and shadow tokens

| Variable | Meaning |
|---|---|
| `--mm-text-caption` | Caption size: confirmation captions, the vim badge — **no fallback** |
| `--mm-text-small` | Small UI size: table-chip glyphs — **no fallback** |
| `--mm-radius-small` | Small corner radius: caption pills, close glyphs — **no fallback** |
| `--mm-radius-pill` | Full-round radius: chips, the vim badge — **no fallback** |
| `--mm-card-shadow` | Resting lift on chips and the vim badge — **no fallback** |
| `--mm-fence-ring` | Hairline ring around editor fence cards — **no fallback** |
| `--mm-split-edge-shade` | The split divider's inset edge shade — **no fallback** |

## Host-layout variables (JS-driven)

These are layout state, not theme material: Marky Mark's app sets them
inline/per element as the user drags, zooms or changes settings. The
default theme still assigns their resting values so a bare embed lays out.

| Variable | Meaning |
|---|---|
| `--mm-split` | The split-editor pane width (default `50%`) |
| `--mm-pane-min` | Minimum useful content width per pane before sideways scroll |
| `--mm-zoom` | Text-only zoom factor multiplying `--mm-font-size` (default `1`) |
